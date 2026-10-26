import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import WebSocket, { WebSocketServer } from "ws";
import { readConfig } from "./config.mjs";
import { readVersion } from "./version.mjs";
import {
  prepareProjectlessDirectory,
  readProjectlessDirectories,
} from "./thread-projects.mjs";

const config = readConfig();
const version = readVersion();
const clients = new WebSocketServer({ noServer: true });
const pending = new Map();
const questions = new Map();
const activeTurns = new Map();
const terminals = new Map();
const subscriptions = new Map();
const releasing = new Map();
const activeThreads = new Set();
const threadMethods = new Set(["thread/start", "thread/resume", "thread/fork"]);
let upstream;
let ready = false;
let sequence = 1;

function send(client, message) {
  if (client.readyState === WebSocket.OPEN)
    client.send(JSON.stringify(message));
}
function broadcast(message) {
  for (const client of clients.clients) send(client, message);
}
function releaseUnusedThreads() {
  for (const [threadId, owners] of subscriptions) {
    if (
      !ready ||
      owners.size ||
      activeTurns.has(threadId) ||
      activeThreads.has(threadId) ||
      releasing.has(threadId) ||
      [...pending.values()].some((request) => request.threadId === threadId)
    )
      continue;
    const id = sequence++;
    const release = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("取消对话订阅超时"));
      }, 120000);
      pending.set(id, { resolve, reject, timer });
      send(upstream, {
        id,
        method: "thread/unsubscribe",
        params: { threadId },
      });
    })
      .then((result) => {
        if (!owners.size && subscriptions.get(threadId) === owners)
          subscriptions.delete(threadId);
        return result;
      })
      .catch((error) => console.error("Thread unsubscribe:", error.message))
      .finally(() => {
        if (releasing.get(threadId) === release) releasing.delete(threadId);
      });
    releasing.set(threadId, release);
  }
}
function state() {
  return {
    method: "lan/state",
    params: {
      ready,
      version,
      defaultCwd: config.defaultCwd,
      projectlessRoot: config.projectlessRoot,
      questions: [...questions.values()],
      activeTurns: Object.fromEntries(activeTurns),
      terminals: Object.fromEntries(terminals),
    },
  };
}
function connect() {
  upstream = new WebSocket(config.upstreamUrl);
  upstream.on("open", () =>
    send(upstream, {
      id: 0,
      method: "initialize",
      params: {
        clientInfo: {
          name: "codex_lan_web",
          title: "Codex LAN Web",
          version: version.displayVersion,
        },
        capabilities: { experimentalApi: true },
      },
    }),
  );
  upstream.on("message", (bytes) => {
    const message = JSON.parse(bytes.toString());
    if (message.id === 0 && !message.method) {
      if (message.error) {
        console.error("Initialization failed:", message.error.message);
        upstream.close();
        return;
      }
      send(upstream, { method: "initialized" });
      ready = true;
      broadcast(state());
      return;
    }
    if (message.method) {
      if (message.id !== undefined) questions.set(String(message.id), message);
      const p = message.params || {};
      if (message.method === "turn/started") {
        activeTurns.set(p.threadId, p.turn.id);
        activeThreads.add(p.threadId);
      }
      if (
        message.method === "turn/completed" &&
        (!activeTurns.has(p.threadId) ||
          activeTurns.get(p.threadId) === p.turn.id)
      ) {
        activeTurns.delete(p.threadId);
        activeThreads.delete(p.threadId);
      }
      if (message.method === "thread/status/changed") {
        if (p.status.type === "active") activeThreads.add(p.threadId);
        else activeThreads.delete(p.threadId);
      }
      if (
        ["thread/closed", "thread/deleted", "thread/archived"].includes(
          message.method,
        )
      ) {
        subscriptions.delete(p.threadId);
        activeThreads.delete(p.threadId);
        activeTurns.delete(p.threadId);
      }
      if (
        message.method === "command/exec/outputDelta" &&
        terminals.has(p.processId)
      ) {
        const terminal = terminals.get(p.processId);
        terminal.buffer = (
          terminal.buffer +
          Buffer.from(p.deltaBase64, "base64").toString("utf8")
        ).slice(-200000);
      }
      if (message.method === "serverRequest/resolved") {
        questions.delete(String(p.requestId));
        broadcast(state());
      }
      broadcast(message);
      releaseUnusedThreads();
      return;
    }
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (request.resolve) {
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
        return;
      }
      if (
        !message.error &&
        threadMethods.has(request.method) &&
        message.result?.thread?.id
      ) {
        const thread = message.result.thread;
        if (!subscriptions.has(thread.id))
          subscriptions.set(thread.id, new Set());
        if (!request.timedOut && request.client.readyState === WebSocket.OPEN)
          subscriptions.get(thread.id).add(request.client);
        if (thread.status?.type === "active") activeThreads.add(thread.id);
      }
      if (request.threadId && message.result?.turn?.status === "inProgress") {
        activeTurns.set(request.threadId, message.result.turn.id);
        activeThreads.add(request.threadId);
      }
      if (request.processId && terminals.has(request.processId)) {
        terminals.get(request.processId).running = false;
        broadcast({
          method: "lan/terminalExit",
          params: {
            processId: request.processId,
            exitCode: message.result?.exitCode,
          },
        });
      }
      if (!request.timedOut)
        send(request.client, { ...message, id: request.id });
      releaseUnusedThreads();
    }
  });
  upstream.on("error", (error) =>
    console.error("App-server connection:", error.message),
  );
  upstream.on("close", () => {
    ready = false;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      if (request.reject) request.reject(new Error("Codex 后端连接中断"));
      else
        send(request.client, {
          id: request.id,
          error: { code: -32000, message: "Codex 后端连接中断，请重试。" },
        });
    }
    pending.clear();
    questions.clear();
    activeTurns.clear();
    activeThreads.clear();
    subscriptions.clear();
    releasing.clear();
    for (const terminal of terminals.values()) terminal.running = false;
    broadcast(state());
    setTimeout(connect, 2000);
  });
}

const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);
const staticCache = new Map();
const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/healthz") {
    response.writeHead(ready ? 200 : 503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ ready, version }));
    return;
  }
  const file = files.get(path);
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  try {
    const metadata = await stat(join(config.staticDir, file[0]));
    if (staticCache.get(path)?.modified !== metadata.mtimeMs) {
      const raw = await readFile(join(config.staticDir, file[0]));
      staticCache.set(path, {
        raw,
        gzip: gzipSync(raw),
        modified: metadata.mtimeMs,
      });
    }
    const content = staticCache.get(path);
    const compressed = /\bgzip\b/.test(
      request.headers["accept-encoding"] || "",
    );
    response.writeHead(200, {
      "Content-Type": file[1],
      "Cache-Control": "no-store",
      Vary: "Accept-Encoding",
      ...(compressed ? { "Content-Encoding": "gzip" } : {}),
    });
    response.end(compressed ? content.gzip : content.raw);
  } catch (error) {
    console.error("Static file:", error.message);
    response.writeHead(500);
    response.end("Unable to load page");
  }
});
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url, "http://localhost").pathname !== "/rpc") {
    socket.destroy();
    return;
  }
  clients.handleUpgrade(request, socket, head, (client) =>
    clients.emit("connection", client),
  );
});
clients.on("connection", (client) => {
  client.alive = true;
  client.on("pong", () => {
    client.alive = true;
  });
  client.on("close", () => {
    for (const owners of subscriptions.values()) owners.delete(client);
    releaseUnusedThreads();
  });
  send(client, state());
  client.on("message", async (bytes) => {
    let message;
    try {
      message = JSON.parse(bytes.toString());
    } catch {
      return;
    }
    if (message.method === "lan/projectless/read") {
      send(client, {
        id: message.id,
        result: {
          directories: await readProjectlessDirectories(config.codexHome),
        },
      });
      return;
    }
    const threadId = message.params?.threadId;
    if (threadId && releasing.has(threadId)) await releasing.get(threadId);
    if (!ready) {
      send(client, {
        id: message.id,
        error: { code: -32000, message: "正在连接 Codex，请稍后重试。" },
      });
      return;
    }
    if (message.method) {
      if (message.method === "lan/projectless/prepare") {
        try {
          send(client, {
            id: message.id,
            result: {
              cwd: await prepareProjectlessDirectory(config.projectlessRoot),
              root: config.projectlessRoot,
            },
          });
        } catch (error) {
          send(client, {
            id: message.id,
            error: {
              code: -32000,
              message: "创建对话工作目录失败：" + error.message,
            },
          });
        }
        return;
      }
      if (message.method === "thread/unsubscribe") {
        subscriptions.get(threadId)?.delete(client);
        releaseUnusedThreads();
        const result = await releasing.get(threadId);
        send(client, {
          id: message.id,
          result: result || { status: "unsubscribed" },
        });
        return;
      }
      if (threadMethods.has(message.method))
        message.params = {
          ...message.params,
          config: { ...message.params?.config, thread_unload_delay_secs: 0 },
        };
      const id = sequence++;
      const processId =
        message.method === "command/exec" && message.params?.processId;
      if (processId) {
        terminals.set(processId, { buffer: "", running: true });
        broadcast({ method: "lan/terminalStarted", params: { processId } });
      }
      const timer = processId
        ? null
        : setTimeout(() => {
            if (threadMethods.has(message.method))
              pending.get(id).timedOut = true;
            else {
              pending.delete(id);
              releaseUnusedThreads();
            }
            send(client, {
              id: message.id,
              error: {
                code: -32000,
                message: "请求等待超时；任务可能仍在继续，请刷新会话查看。",
              },
            });
          }, 120000);
      pending.set(id, {
        client,
        id: message.id,
        timer,
        processId,
        method: message.method,
        threadId,
      });
      send(upstream, { ...message, id });
    } else if (message.id !== undefined && questions.has(String(message.id))) {
      send(upstream, message);
      questions.delete(String(message.id));
      broadcast({ method: "lan/questionResolved", params: { id: message.id } });
    }
  });
});
const heartbeat = setInterval(() => {
  for (const client of clients.clients) {
    if (!client.alive) client.terminate();
    else {
      client.alive = false;
      client.ping();
    }
  }
  releaseUnusedThreads();
}, 30000);
heartbeat.unref();
connect();
server.listen(config.port, config.host, () =>
  console.log(
    `Codex web listening on http://${config.host}:${server.address().port}`,
  ),
);
