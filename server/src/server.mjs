import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import WebSocket, { WebSocketServer } from "ws";
import { readConfig } from "./config.mjs";

const config = readConfig();
const clients = new WebSocketServer({ noServer: true });
const pending = new Map();
const questions = new Map();
const activeTurns = new Map();
const terminals = new Map();
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
function state() {
  return {
    method: "lan/state",
    params: {
      ready,
      defaultCwd: config.defaultCwd,
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
          version: "2.0.0",
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
      if (message.method === "turn/started")
        activeTurns.set(p.threadId, p.turn.id);
      if (message.method === "turn/completed") activeTurns.delete(p.threadId);
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
      return;
    }
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
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
      send(request.client, { ...message, id: request.id });
    }
  });
  upstream.on("error", (error) =>
    console.error("App-server connection:", error.message),
  );
  upstream.on("close", () => {
    ready = false;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      send(request.client, {
        id: request.id,
        error: { code: -32000, message: "Codex 后端连接中断，请重试。" },
      });
    }
    pending.clear();
    questions.clear();
    activeTurns.clear();
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
    });
    response.end(JSON.stringify({ ready }));
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
  send(client, state());
  client.on("message", (bytes) => {
    let message;
    try {
      message = JSON.parse(bytes.toString());
    } catch {
      return;
    }
    if (!ready) {
      send(client, {
        id: message.id,
        error: { code: -32000, message: "正在连接 Codex，请稍后重试。" },
      });
      return;
    }
    if (message.method) {
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
            pending.delete(id);
            send(client, {
              id: message.id,
              error: {
                code: -32000,
                message: "请求等待超时；任务可能仍在继续，请刷新会话查看。",
              },
            });
          }, 120000);
      pending.set(id, { client, id: message.id, timer, processId });
      send(upstream, { ...message, id });
    } else if (message.id !== undefined && questions.has(String(message.id))) {
      send(upstream, message);
      questions.delete(String(message.id));
      broadcast({ method: "lan/questionResolved", params: { id: message.id } });
    }
  });
});
connect();
server.listen(config.port, config.host, () =>
  console.log(
    `Codex web listening on http://${config.host}:${server.address().port}`,
  ),
);
