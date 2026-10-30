import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 8766);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT 必须为 0 到 65535 之间的整数");
  const upstreamUrl = env.CODEX_APP_SERVER_URL || "ws://127.0.0.1:8765";
  if (!["ws:", "wss:"].includes(new URL(upstreamUrl).protocol))
    throw new Error("CODEX_APP_SERVER_URL 必须是 WebSocket 地址");
  const codexHome = resolve(env.CODEX_HOME || join(homedir(), ".codex"));
  return {
    host: env.HOST || "0.0.0.0",
    port,
    upstreamUrl,
    codexHome,
    backgroundDir: join(
      codexHome,
      "codex-web",
      "background",
      createHash("sha256").update(upstreamUrl).digest("hex").slice(0, 16),
    ),
    projectlessRoot: join(codexHome, "codex-web", "workspaces"),
    defaultCwd: resolve(env.DEFAULT_CWD || homedir()),
    staticDir: env.STATIC_DIR
      ? resolve(env.STATIC_DIR)
      : fileURLToPath(new URL("../../client/dist/", import.meta.url)),
  };
}
