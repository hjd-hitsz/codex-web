import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { WebSocketServer } from "ws";

async function waitFor(read) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = read();
    if (value) return value;
    await delay(10);
  }
  assert.fail("未收到预期的桥接请求");
}

async function bridge(t, handle = () => undefined) {
  const backend = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(backend, "listening");
  const requests = [],
    sockets = [];
  let upstream,
    sequence = 1;
  const respond = (request, result) =>
    upstream.send(JSON.stringify({ id: request.id, result }));
  backend.on("connection", (socket) => {
    upstream = socket;
    socket.on("message", (bytes) => {
      const request = JSON.parse(bytes);
      if (request.id === undefined) return;
      requests.push(request);
      if (handle(request, socket)) return;
      respond(
        request,
        ["thread/start", "thread/resume", "thread/fork"].includes(
          request.method,
        )
          ? {
              thread: {
                id:
                  request.method === "thread/resume"
                    ? request.params.threadId
                    : `${request.method}-${request.id}`,
                status: { type: "idle" },
              },
            }
          : request.method === "thread/unsubscribe"
            ? { status: "unsubscribed" }
            : {},
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
        CODEX_APP_SERVER_URL: `ws://127.0.0.1:${backend.address().port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    const exit = once(child, "exit");
    child.kill();
    await exit;
    for (const socket of backend.clients) socket.terminate();
    await new Promise((resolve) => backend.close(resolve));
  });
  const url = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (bytes) => {
      const match = bytes.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0].replace("http:", "ws:") + "/rpc");
    });
  });
  return {
    requests,
    respond,
    unsubscribed: () =>
      requests.filter((request) => request.method === "thread/unsubscribe"),
    notify(method, params) {
      upstream.send(JSON.stringify({ method, params }));
    },
    async connect() {
      const socket = new WebSocket(url);
      sockets.push(socket);
      await new Promise((resolve) =>
        socket.on("message", (bytes) => {
          const message = JSON.parse(bytes);
          if (message.method === "lan/state" && message.params.ready) resolve();
        }),
      );
      return socket;
    },
    rpc(socket, method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = sequence++;
        function receive(bytes) {
          const message = JSON.parse(bytes);
          if (message.id !== id || message.method) return;
          socket.off("message", receive);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        }
        socket.on("message", receive);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function close(socket) {
  const closed = once(socket, "close");
  socket.close();
  await closed;
}

for (const method of ["thread/start", "thread/resume", "thread/fork"]) {
  test(
    `${method} 在关闭页面后释放实际返回的对话`,
    { timeout: 10000 },
    async (t) => {
      const app = await bridge(t);
      const client = await app.connect();
      const { thread } = await app.rpc(client, method, {
        threadId: "source",
        config: { model: "fixture-model", thread_unload_delay_secs: 1800 },
      });
      assert.deepEqual(
        app.requests.find((request) => request.method === method).params.config,
        { model: "fixture-model", thread_unload_delay_secs: 0 },
      );
      await close(client);
      const [request] = await waitFor(
        () => app.unsubscribed().length && app.unsubscribed(),
      );
      assert.deepEqual(request.params, { threadId: thread.id });
    },
  );

  test(
    `${method} 响应晚于页面关闭时仍释放对话`,
    { timeout: 10000 },
    async (t) => {
      const app = await bridge(t, (request) => request.method === method);
      const client = await app.connect();
      client.send(
        JSON.stringify({ id: 1, method, params: { threadId: "source" } }),
      );
      const request = await waitFor(() =>
        app.requests.find((request) => request.method === method),
      );
      await close(client);
      app.respond(request, {
        thread: { id: "late-thread", status: { type: "idle" } },
      });
      await waitFor(() => app.unsubscribed().length);
      assert.deepEqual(app.unsubscribed()[0].params, {
        threadId: "late-thread",
      });
    },
  );
}

test(
  "多个页面共享对话，最后一个订阅退出后才释放",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t);
    const first = await app.connect(),
      second = await app.connect();
    await app.rpc(first, "thread/resume", { threadId: "shared" });
    await app.rpc(second, "thread/resume", { threadId: "shared" });
    await app.rpc(first, "thread/unsubscribe", { threadId: "shared" });
    assert.equal(app.unsubscribed().length, 0);
    await close(first);
    await app.rpc(second, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    await app.rpc(second, "thread/unsubscribe", { threadId: "shared" });
    assert.equal(app.unsubscribed().length, 1);
    await close(second);
    assert.equal(app.unsubscribed().length, 1);
  },
);

test(
  "页面关闭后任务继续，轮次完成时自动释放",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t);
    const client = await app.connect(),
      observer = await app.connect();
    await app.rpc(client, "thread/resume", { threadId: "running" });
    app.notify("turn/started", { threadId: "running", turn: { id: "turn" } });
    await app.rpc(client, "test/barrier");
    await close(client);
    app.notify("thread/status/changed", {
      threadId: "running",
      status: { type: "idle" },
    });
    await app.rpc(observer, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.notify("turn/completed", {
      threadId: "running",
      turn: { id: "turn", status: "completed" },
    });
    await waitFor(() => app.unsubscribed().length);
    assert.deepEqual(app.unsubscribed()[0].params, { threadId: "running" });
  },
);

test(
  "取消订阅期间重新打开对话，等待释放响应后恢复",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(
      t,
      (request) => request.method === "thread/unsubscribe",
    );
    const first = await app.connect(),
      second = await app.connect();
    await app.rpc(first, "thread/resume", { threadId: "reopen" });
    await close(first);
    const request = await waitFor(() => app.unsubscribed()[0]);
    const reopened = app.rpc(second, "thread/resume", { threadId: "reopen" });
    await delay(30);
    assert.equal(
      app.requests.filter((request) => request.method === "thread/resume")
        .length,
      1,
    );
    app.respond(request, { status: "unsubscribed" });
    await reopened;
    await close(second);
    await waitFor(() => app.unsubscribed().length === 2);
  },
);

test(
  "发送请求尚未返回时关闭页面，保留任务直到完成",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t, (request) => request.method === "turn/start");
    const client = await app.connect(),
      observer = await app.connect();
    await app.rpc(client, "thread/resume", { threadId: "starting" });
    client.send(
      JSON.stringify({
        id: 99,
        method: "turn/start",
        params: { threadId: "starting", input: [] },
      }),
    );
    const request = await waitFor(() =>
      app.requests.find((request) => request.method === "turn/start"),
    );
    await close(client);
    await app.rpc(observer, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.respond(request, { turn: { id: "new-turn", status: "inProgress" } });
    await app.rpc(observer, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.notify("turn/completed", {
      threadId: "starting",
      turn: { id: "new-turn", status: "completed" },
    });
    await waitFor(() => app.unsubscribed().length);
  },
);

test(
  "恢复已运行的对话后断连，等待空闲状态再释放",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t, (request, upstream) => {
      if (request.method !== "thread/resume") return false;
      upstream.send(
        JSON.stringify({
          id: request.id,
          result: {
            thread: {
              id: "resumed-active",
              status: { type: "active", activeFlags: [] },
            },
          },
        }),
      );
      return true;
    });
    const client = await app.connect(),
      observer = await app.connect();
    await app.rpc(client, "thread/resume", { threadId: "resumed-active" });
    await close(client);
    await app.rpc(observer, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.notify("thread/status/changed", {
      threadId: "resumed-active",
      status: { type: "idle" },
    });
    await waitFor(() => app.unsubscribed().length);
  },
);

test("恢复失败的对话保持原订阅状态", { timeout: 10000 }, async (t) => {
  const app = await bridge(t, (request, upstream) => {
    if (request.method !== "thread/resume") return false;
    upstream.send(
      JSON.stringify({
        id: request.id,
        error: { code: -32000, message: "fixture conflict" },
      }),
    );
    return true;
  });
  const client = await app.connect(),
    observer = await app.connect();
  await assert.rejects(
    app.rpc(client, "thread/resume", { threadId: "failed" }),
    /fixture conflict/,
  );
  await close(client);
  await app.rpc(observer, "test/barrier");
  assert.equal(app.unsubscribed().length, 0);
});

test("后端重连后重建订阅并在页面断连时释放", { timeout: 10000 }, async (t) => {
  let upstream;
  const app = await bridge(t, (request, socket) => {
    upstream = socket;
    return false;
  });
  const client = await app.connect();
  await app.rpc(client, "thread/resume", { threadId: "reconnected" });
  const reconnected = new Promise((resolve) =>
    client.on("message", (bytes) => {
      const message = JSON.parse(bytes);
      if (message.method === "lan/state" && message.params.ready) resolve();
    }),
  );
  upstream.close();
  await reconnected;
  await app.rpc(client, "thread/resume", { threadId: "reconnected" });
  await close(client);
  await waitFor(() => app.unsubscribed().length);
  assert.equal(app.unsubscribed().length, 1);
});

test("断网由 WebSocket 心跳识别并释放订阅", { timeout: 75000 }, async (t) => {
  const app = await bridge(t);
  const client = await app.connect();
  await app.rpc(client, "thread/resume", { threadId: "offline" });
  client.pong = () => {};
  await waitForHeartbeat();
  assert.deepEqual(app.unsubscribed()[0].params, { threadId: "offline" });
  async function waitForHeartbeat() {
    for (let attempt = 0; attempt < 65; attempt++) {
      if (app.unsubscribed().length) return;
      await delay(1000);
    }
    assert.fail("心跳超时后未释放对话");
  }
});
