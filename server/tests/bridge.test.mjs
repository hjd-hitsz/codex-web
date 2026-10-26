import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { readVersion } from "../src/version.mjs";

function messageFrom(socket, matches) {
  return new Promise((resolve) => {
    function receive(bytes) {
      const message = JSON.parse(bytes);
      if (!matches(message)) return;
      socket.off("message", receive);
      resolve(message);
    }
    socket.on("message", receive);
  });
}

test(
  "桥接服务提供资源、隔离请求 ID，并恢复和同步提问状态",
  { timeout: 15000 },
  async (t) => {
    const files = await mkdtemp(join(tmpdir(), "codex-web-test-"));
    const version = readVersion();
    await writeFile(join(files, "index.html"), "<h1>Codex Web test</h1>");
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    let clientVersion, backend;
    const answers = [];
    upstream.on("connection", (socket) => {
      backend = socket;
      socket.on("message", (bytes) => {
        const request = JSON.parse(bytes);
        if (!request.method) {
          answers.push(request);
          return;
        }
        if (request.method === "initialize")
          clientVersion = request.params.clientInfo.version;
        if (request.id !== undefined)
          socket.send(
            JSON.stringify({
              id: request.id,
              result: request.method === "initialize" ? {} : request.params,
            }),
          );
      });
    });
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
    async function connect(onState = () => {}) {
      const socket = new WebSocket(url.replace("http:", "ws:") + "/rpc");
      sockets.push(socket);
      await new Promise((resolve) =>
        socket.on("message", (bytes) => {
          const message = JSON.parse(bytes);
          if (message.method === "lan/state" && message.params.ready) {
            assert.equal(message.params.defaultCwd, files);
            assert.deepEqual(message.params.version, version);
            onState(message.params);
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
    const health = await fetch(url + "/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual(await health.json(), { ready: true, version });
    assert.equal(clientVersion, version.displayVersion);
    assert.equal(await (await fetch(url)).text(), "<h1>Codex Web test</h1>");
    await writeFile(join(files, "index.html"), "<h1>Updated build</h1>");
    assert.equal(await (await fetch(url)).text(), "<h1>Updated build</h1>");
    assert.equal((await fetch(url + "/missing")).status, 404);

    const question = {
      id: "pending-question",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "fixture-thread",
        turnId: "fixture-turn",
        itemId: "fixture-item",
        isBlocking: false,
        autoResolutionMs: null,
        questions: [
          {
            id: "deployment",
            header: "部署方式",
            question: "如何部署？",
            isOther: true,
            isSecret: false,
            options: [{ label: "npm", description: "安装预构建包" }],
          },
        ],
      },
    };
    const firstQuestion = messageFrom(first, (m) => m.id === question.id);
    const secondQuestion = messageFrom(second, (m) => m.id === question.id);
    backend.send(JSON.stringify(question));
    assert.deepEqual(await firstQuestion, question);
    assert.deepEqual(await secondQuestion, question);
    let restored;
    const reconnected = await connect((state) => (restored = state.questions));
    assert.deepEqual(restored, [question]);

    const result = { answers: { deployment: { answers: ["容器部署"] } } };
    const answer = messageFrom(
      backend,
      (m) => m.id === question.id && !m.method,
    );
    const resolved = [first, second, reconnected].map((socket) =>
      messageFrom(socket, (m) => m.method === "lan/questionResolved"),
    );
    first.send(JSON.stringify({ id: question.id, result }));
    assert.deepEqual(await answer, { id: question.id, result });
    for (const message of await Promise.all(resolved))
      assert.deepEqual(message.params, { id: question.id });
    second.send(JSON.stringify({ id: question.id, result }));
    await echo(second, "barrier");
    assert.equal(answers.length, 1);
    await connect((state) => assert.deepEqual(state.questions, []));

    const expired = { ...question, id: 37 };
    const pending = messageFrom(first, (m) => m.id === expired.id);
    backend.send(JSON.stringify(expired));
    await pending;
    const cleared = messageFrom(
      first,
      (m) => m.method === "serverRequest/resolved",
    );
    backend.send(
      JSON.stringify({
        method: "serverRequest/resolved",
        params: { threadId: "fixture-thread", requestId: "37" },
      }),
    );
    await cleared;
    await connect((state) => assert.deepEqual(state.questions, []));
  },
);
