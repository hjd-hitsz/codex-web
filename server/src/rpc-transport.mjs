import WebSocket from "ws";

export const MAX_RPC_MESSAGE_BYTES = 64 * 1024 * 1024;
export const RPC_FRAME_BYTES = 1024 * 1024;

// Codex 的 WebSocket 接口分别限制单帧与完整消息的大小。
export function sendRpcText(socket, text) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (Buffer.byteLength(text) <= RPC_FRAME_BYTES) {
    socket.send(text);
    return;
  }
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += RPC_FRAME_BYTES)
    socket.send(bytes.subarray(offset, offset + RPC_FRAME_BYTES), {
      binary: false,
      fin: offset + RPC_FRAME_BYTES >= bytes.length,
    });
}
