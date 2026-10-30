import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { WebSocketServer } from "ws";
import { readConfig } from "../src/config.mjs";
import { backgroundRequest } from "../src/background-client.mjs";

async function until(read) {
  for (let i = 0; i < 800; i++) {
    const value = await read();
    if (value) return value;
    await delay(10);
  }
  assert.fail("后台桥接验证等待超时");
}

test(
  "真实 MCP 入口跨页面关闭和桥接重启继续执行，恢复原对话且只投递一次",
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "codex-web-background-bridge-"),
    );
    const backend = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(backend, "listening");
    const requests = [],
      children = [],
      sockets = [];
    let turnSequence = 0;
    const upstreamUrl = `ws://127.0.0.1:${backend.address().port}`;
    const config = readConfig({
      CODEX_HOME: directory,
      CODEX_APP_SERVER_URL: upstreamUrl,
    });
    const thread = {
      id: "background-bridge-fixture",
      name: "隔离后台任务",
      cwd: directory,
      status: { type: "idle" },
    };
    backend.on("connection", (socket) =>
      socket.on("message", (bytes) => {
        const request = JSON.parse(bytes);
        if (request.id === undefined) return;
        requests.push(request);
        let result = {};
        if (
          ["thread/read", "thread/resume", "thread/start"].includes(
            request.method,
          )
        )
          result = { thread };
        if (request.method === "thread/turns/list") result = { data: [] };
        if (request.method === "turn/start") {
          const turn = {
            id: "background-turn-" + ++turnSequence,
            status: "completed",
          };
          // 覆盖完成通知先于提交确认的时序，避免桥接残留活动轮次。
          socket.send(
            JSON.stringify({
              method: "turn/started",
              params: {
                threadId: thread.id,
                turn: { ...turn, status: "inProgress" },
              },
            }),
          );
          socket.send(
            JSON.stringify({
              method: "turn/completed",
              params: { threadId: thread.id, turn },
            }),
          );
          result = { turn: { ...turn, status: "inProgress" } };
        }
        socket.send(JSON.stringify({ id: request.id, result }));
      }),
    );
    t.after(async () => {
      for (const socket of sockets) socket.terminate();
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          const closed = once(child, "exit");
          child.kill();
          await closed;
        }
      try {
        const registry = JSON.parse(
          await readFile(join(config.backgroundDir, "service.json"), "utf8"),
        );
        process.kill(registry.pid, "SIGTERM");
        await until(async () => {
          try {
            await readFile(join(config.backgroundDir, "service.json"));
            return false;
          } catch {
            return true;
          }
        });
      } catch {}
      for (const socket of backend.clients) socket.terminate();
      await new Promise((resolve) => backend.close(resolve));
      await rm(directory, { recursive: true, force: true });
    });
    async function startBridge() {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("../src/server.mjs", import.meta.url))],
        {
          env: {
            ...process.env,
            CODEX_HOME: directory,
            CODEX_APP_SERVER_URL: upstreamUrl,
            HOST: "127.0.0.1",
            PORT: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      children.push(child);
      let stderr = "";
      child.stderr.on("data", (bytes) => (stderr += bytes));
      const url = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", () => reject(new Error(stderr)));
        child.stdout.on("data", (bytes) => {
          const match = bytes.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
          if (match) resolve(match[0]);
        });
      });
      await until(async () => (await fetch(url + "/healthz")).ok);
      const socket = new WebSocket(url.replace("http:", "ws:") + "/rpc");
      sockets.push(socket);
      await once(socket, "open");
      let sequence = 1;
      const pending = new Map();
      socket.on("message", (bytes) => {
        const message = JSON.parse(bytes);
        const request = pending.get(message.id);
        if (request && !message.method) {
          pending.delete(message.id);
          message.error
            ? request.reject(new Error(message.error.message))
            : request.resolve(message.result);
        }
      });
      const rpc = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = sequence++;
          pending.set(id, { resolve, reject });
          socket.send(JSON.stringify({ id, method, params }));
        });
      return { child, socket, rpc };
    }
    const first = await startBridge();
    await first.rpc("thread/resume", { threadId: thread.id });
    const definition = requests.find(
      (request) => request.method === "thread/resume",
    ).params.config.mcp_servers.codex_web_background;
    assert.equal(definition.command, process.execPath);
    const mcp = spawn(definition.command, definition.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(mcp);
    const mcpRequests = new Map();
    let sequence = 0;
    createInterface({ input: mcp.stdout }).on("line", (line) => {
      const message = JSON.parse(line);
      const resolve = mcpRequests.get(message.id);
      if (resolve) {
        mcpRequests.delete(message.id);
        resolve(message);
      }
    });
    const callMcp = async (method, params = {}) => {
      const id = ++sequence;
      const response = new Promise((resolve) => mcpRequests.set(id, resolve));
      mcp.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
      return response;
    };
    const initialized = await callMcp("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" },
    });
    assert.match(initialized.result.instructions, /可结束当前轮次/);
    assert.equal((await callMcp("tools/list")).result.tools.length, 4);
    const script =
      'setTimeout(()=>{console.log("后台任务完成：中文日志");},1400)';
    const command = `'${process.execPath}' -e '${script}'`;
    const called = await callMcp("tools/call", {
      name: "background_start",
      arguments: { command, title: "独立后台任务" },
      _meta: { threadId: thread.id, callId: "fixture-start" },
    });
    assert.equal(called.result.isError, false);
    const { job } = JSON.parse(called.result.content[0].text);
    assert.equal(job.cwd, directory);
    const duplicate = await callMcp("tools/call", {
      name: "background_start",
      arguments: { command, title: "重复通知" },
      _meta: { threadId: thread.id, callId: "fixture-start" },
    });
    assert.equal(JSON.parse(duplicate.result.content[0].text).job.id, job.id);
    const invalid = await callMcp("tools/call", {
      name: "background_start",
      arguments: { command, title: "缺少对话" },
    });
    assert.equal(invalid.result.isError, true);
    mcp.stdin.end();
    await once(mcp, "exit");
    first.socket.close();
    const closed = once(first.child, "exit");
    first.child.kill();
    await closed;
    await until(async () =>
      (await backgroundRequest(config.backgroundDir, "snapshot")).jobs.find(
        (value) => value.id === job.id && value.status === "succeeded",
      ),
    );
    assert.equal(
      requests.filter((request) => request.method === "turn/start").length,
      0,
    );
    const second = await startBridge();
    const wake = await until(() =>
      requests.find((request) => request.method === "turn/start"),
    );
    assert.equal(wake.params.threadId, thread.id);
    assert.deepEqual(wake.params.input, []);
    const result = JSON.parse(wake.params.toolOutput.output);
    assert.equal(result.results[0].job_id, job.id);
    assert.match(result.results[0].output_tail, /中文日志/);
    await until(
      async () =>
        (await backgroundRequest(config.backgroundDir, "snapshot")).jobs[0]
          .delivery === "accepted",
    );
    await until(() =>
      requests.some(
        (request) =>
          request.method === "thread/unsubscribe" &&
          request.params.threadId === thread.id,
      ),
    );
    const log = await second.rpc("lan/background/read", {
      threadId: thread.id,
      id: job.id,
    });
    assert.match(log.output, /后台任务完成/);
    await delay(1200);
    assert.equal(
      requests.filter((request) => request.method === "turn/start").length,
      1,
    );
    await assert.rejects(
      second.rpc("lan/background/read", {
        threadId: "other-thread",
        id: job.id,
      }),
      /该对话/,
    );
  },
);
