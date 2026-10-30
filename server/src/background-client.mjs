import { spawn } from "node:child_process";
import { open, readFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { BACKGROUND_SERVER } from "./background-protocol.mjs";

export async function backgroundRequest(directory, method, params = {}) {
  const registry = JSON.parse(
    await readFile(join(directory, "service.json"), "utf8"),
  );
  const url = new URL(registry.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("后台任务服务地址无效");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + registry.token,
    },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result?.error)
    throw new Error(result?.error || "后台任务服务请求失败");
  return result;
}

export async function ensureBackgroundService(directory, upstreamUrl) {
  try {
    await backgroundRequest(directory, "health");
    return;
  } catch {}
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(join(directory, "launch.lock"), "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // 锁仅覆盖启动窗口；上次启动者退出后，下一次调用可以重新启动服务。
    if (
      Date.now() - (await stat(join(directory, "launch.lock"))).mtimeMs >
      30000
    )
      await rm(join(directory, "launch.lock"), { force: true });
  }
  if (lock) {
    const log = await open(join(directory, "service.log"), "a", 0o600);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./background-daemon.mjs", import.meta.url)),
        directory,
        upstreamUrl,
      ],
      {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    child.on("error", () => {});
    child.unref();
    await log.close();
    await lock.close();
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await backgroundRequest(directory, "health");
      await rm(join(directory, "launch.lock"), { force: true });
      return;
    } catch {
      await delay(100);
    }
  }
  await rm(join(directory, "launch.lock"), { force: true });
  throw new Error("后台任务服务启动失败，请检查任务目录中的 service.log");
}

export function backgroundConfig(config, overrides = {}) {
  return {
    ...overrides,
    thread_unload_delay_secs: 0,
    mcp_servers: {
      ...overrides.mcp_servers,
      [BACKGROUND_SERVER]: {
        command: process.execPath,
        args: [
          fileURLToPath(new URL("./background-mcp.mjs", import.meta.url)),
          config.backgroundDir,
          config.upstreamUrl,
        ],
        enabled: true,
      },
    },
  };
}
