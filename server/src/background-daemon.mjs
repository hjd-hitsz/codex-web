import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, link, readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createBackgroundJobs } from "./background-jobs.mjs";
import { readBackgroundThread } from "./background-rpc.mjs";

export async function startBackgroundDaemon(directory, upstreamUrl) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const ownerFile = join(directory, "owner.json");
  const candidate = `${ownerFile}.${process.pid}.tmp`;
  await writeFile(candidate, JSON.stringify({ pid: process.pid }), {
    mode: 0o600,
  });
  try {
    await link(candidate, ownerFile);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const prior = JSON.parse(await readFile(ownerFile, "utf8"));
    try {
      process.kill(prior.pid, 0);
      throw new Error("后台任务服务已经运行");
    } catch (status) {
      if (status.code !== "ESRCH") throw status;
      await rm(ownerFile);
      await link(candidate, ownerFile);
    }
  } finally {
    await rm(candidate, { force: true });
  }
  const token = randomBytes(32).toString("hex");
  const jobs = await createBackgroundJobs({
    directory,
    readThread: (id) => readBackgroundThread(upstreamUrl, id),
  });
  const server = http.createServer(async (request, response) => {
    const reply = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (
      request.method !== "POST" ||
      request.headers.authorization !== "Bearer " + token ||
      request.headers.origin
    ) {
      reply(403, { error: "后台任务服务拒绝请求" });
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const bytes of request) {
        size += bytes.length;
        if (size > 1024 * 1024) throw new Error("后台请求过大");
        chunks.push(bytes);
      }
      const { method, params = {} } = JSON.parse(Buffer.concat(chunks));
      let result;
      if (method === "health") result = { ready: true, pid: process.pid };
      else if (method === "snapshot") result = jobs.snapshot();
      else if (method === "tool") result = await jobs.tool(params);
      else if (method === "read")
        result = await jobs.read(params.threadId, params.id, params.offset);
      else if (method === "claim")
        result = await jobs.claim(params.threadId, params.owner);
      else if (method === "batch") result = await jobs.updateBatch(params);
      else if (method === "suppress")
        result = await jobs.suppressThread(
          params.threadId,
          params.cancelRunning,
        );
      else throw new Error("未知后台服务方法");
      reply(200, result);
    } catch (error) {
      reply(400, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const registry = join(directory, "service.json");
  await writeFile(
    registry + ".tmp",
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}`,
      token,
      pid: process.pid,
    }),
    { mode: 0o600 },
  );
  await rename(registry + ".tmp", registry);
  let closing;
  return {
    jobs,
    close() {
      if (closing) return closing;
      closing = (async () => {
        await jobs.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await rm(registry, { force: true });
        await rm(ownerFile, { force: true });
      })();
      return closing;
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [directory, upstreamUrl] = process.argv.slice(2);
  const daemon = await startBackgroundDaemon(directory, upstreamUrl);
  const stop = () => daemon.close().then(() => process.exit());
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
