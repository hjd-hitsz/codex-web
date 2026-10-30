import WebSocket from "ws";

// 任务启动只读取所属对话的真实工作目录，不取得其订阅和写入占用。
export async function readBackgroundThread(url, threadId) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 1;
  const fail = (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("读取后台任务所属对话时连接中断")));
  socket.on("message", (bytes) => {
    const message = JSON.parse(bytes);
    if (message.method) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const timer = setTimeout(() => {
    fail(new Error("读取后台任务所属对话超时"));
    socket.terminate();
  }, 30000);
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = sequence++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
      socket.once("close", () => reject(new Error("后台连接已关闭")));
    });
    await call("initialize", {
      clientInfo: { name: "codex_web_background", version: "1" },
      capabilities: { experimentalApi: true },
    });
    socket.send(JSON.stringify({ method: "initialized" }));
    return (await call("thread/read", { threadId, includeTurns: false }))
      .thread;
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}
