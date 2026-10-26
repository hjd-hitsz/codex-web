import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

test(
  "桥接服务提供资源、健康状态并隔离不同客户端的请求 ID",
  { timeout: 15000 },
  async (t) => {
    const files = await mkdtemp(join(tmpdir(), "codex-web-test-"));
    await writeFile(join(files, "index.html"), "<h1>Codex Web test</h1>");
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    upstream.on("connection", (socket) =>
      socket.on("message", (bytes) => {
        const request = JSON.parse(bytes);
        if (request.id !== undefined)
          socket.send(
            JSON.stringify({
              id: request.id,
              result: request.method === "initialize" ? {} : request.params,
            }),
          );
      }),
    );
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../src/server.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "0",
          STATIC_DIR: files,
          DEFAULT_CWD: files,
          CODEX_APP_SERVER_URL: `ws://127.0.0.1:${upstream.address().port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const sockets = [];
    t.after(async () => {
      for (const socket of sockets) socket.terminate();
      const exit = once(child, "exit");
      child.kill();
      await exit;
      for (const socket of upstream.clients) socket.terminate();
      await new Promise((resolve) => upstream.close(resolve));
      await rm(files, { recursive: true, force: true });
    });
    const url = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout.on("data", (bytes) => {
        const match = bytes.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    async function connect() {
      const socket = new WebSocket(url.replace("http:", "ws:") + "/rpc");
      sockets.push(socket);
      await new Promise((resolve) =>
        socket.on("message", (bytes) => {
          const message = JSON.parse(bytes);
          if (message.method === "lan/state" && message.params.ready) {
            assert.equal(message.params.defaultCwd, files);
            resolve();
          }
        }),
      );
      return socket;
    }
    const [first, second] = await Promise.all([connect(), connect()]);
    function echo(socket, label) {
      return new Promise((resolve) => {
        socket.on("message", (bytes) => {
          const message = JSON.parse(bytes);
          if (message.id === 1) resolve(message.result.label);
        });
        socket.send(
          JSON.stringify({ id: 1, method: "test/echo", params: { label } }),
        );
      });
    }
    assert.deepEqual(
      await Promise.all([echo(first, "first"), echo(second, "second")]),
      ["first", "second"],
    );
    assert.equal((await fetch(url + "/healthz")).status, 200);
    assert.equal(await (await fetch(url)).text(), "<h1>Codex Web test</h1>");
    await writeFile(join(files, "index.html"), "<h1>Updated build</h1>");
    assert.equal(await (await fetch(url)).text(), "<h1>Updated build</h1>");
    assert.equal((await fetch(url + "/missing")).status, 404);
  },
);
