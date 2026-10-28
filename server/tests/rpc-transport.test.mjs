import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { RPC_FRAME_BYTES, sendRpcText } from "../src/rpc-transport.mjs";

test("大图片请求按小文本帧传输，保留完整图片与 Unicode 正文", async (t) => {
  const server = http.createServer();
  const backend = new WebSocketServer({ noServer: true });
  const frames = [];
  server.on("upgrade", (request, socket, head) => {
    let buffered = Buffer.alloc(0);
    // 在 WebSocket 接收器解码之前读取原始帧头，核对实际线上帧大小。
    socket.on("data", (bytes) => {
      buffered = Buffer.concat([buffered, bytes]);
      while (buffered.length >= 2) {
        const length = buffered[1] & 127;
        const extended = length === 127 ? 8 : length === 126 ? 2 : 0;
        const header = 2 + extended + (buffered[1] & 128 ? 4 : 0);
        if (buffered.length < header) break;
        const size =
          length === 127
            ? Number(buffered.readBigUInt64BE(2))
            : length === 126
              ? buffered.readUInt16BE(2)
              : length;
        if (buffered.length < header + size) break;
        frames.push({
          opcode: buffered[0] & 15,
          fin: Boolean(buffered[0] & 128),
          size,
        });
        buffered = buffered.subarray(header + size);
      }
    });
    backend.handleUpgrade(request, socket, head, (client) =>
      backend.emit("connection", client),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const connection = once(backend, "connection");
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  t.after(async () => {
    client.terminate();
    for (const socket of backend.clients) socket.terminate();
    await new Promise((resolve) => backend.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  await once(client, "open");
  const [receiver] = await connection;
  const image =
    "data:image/png;base64," +
    Buffer.alloc(13 * 1024 * 1024, 7).toString("base64");
  const request = {
    id: 1,
    method: "turn/start",
    params: {
      input: [
        { type: "text", text: "保留原图 📷，裁剪白边。" },
        { type: "image", url: image },
      ],
    },
  };
  const received = once(receiver, "message");
  sendRpcText(client, JSON.stringify(request));
  const [bytes, binary] = await received;
  assert.equal(binary, false);
  assert.deepEqual(JSON.parse(bytes), request);
  assert(frames.length > 16);
  assert(frames.every((frame) => frame.size <= RPC_FRAME_BYTES));
  assert.equal(frames[0].opcode, 1);
  assert(frames.slice(1).every((frame) => frame.opcode === 0));
  assert(frames.slice(0, -1).every((frame) => !frame.fin));
  assert.equal(frames.at(-1).fin, true);

  const next = once(receiver, "message");
  sendRpcText(client, JSON.stringify({ id: 2, method: "model/list" }));
  assert.deepEqual(JSON.parse((await next)[0]), {
    id: 2,
    method: "model/list",
  });
  assert.deepEqual(frames.at(-1), {
    opcode: 1,
    fin: true,
    size: Buffer.byteLength(JSON.stringify({ id: 2, method: "model/list" })),
  });
});
