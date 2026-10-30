import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createBackgroundJobs } from "../src/background-jobs.mjs";
import { createBackgroundWake } from "../src/background-wake.mjs";
import { backgroundConfig } from "../src/background-client.mjs";

const command = (script) =>
  `'${process.execPath.replaceAll("'", "'\\''")}' -e '${script.replaceAll("'", "'\\''")}'`;
async function until(read) {
  for (let i = 0; i < 500; i++) {
    const value = await read();
    if (value) return value;
    await delay(10);
  }
  assert.fail("等待后台任务超时");
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-jobs-"));
  const config = {
    directory,
    shell: "/bin/sh",
    readThread: async (id) => ({ id, cwd: directory }),
  };
  const jobs = await createBackgroundJobs(config);
  t.after(async () => {
    await jobs.close();
    await rm(directory, { recursive: true, force: true });
  });
  const start = (id, script, extra = {}) =>
    jobs.tool({
      name: "background_start",
      threadId: "thread-a",
      callId: id,
      args: { command: command(script), title: "隔离测试任务", ...extra },
    });
  return {
    directory,
    config,
    jobs,
    start,
    done: (id) =>
      until(() => jobs.list().find((job) => job.id === id && job.completedAt)),
  };
}

test("后台任务按调用去重、按对话隔离，并完整读取 UTF-8 分页日志", async (t) => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([
    f.start("same-call", 'process.stdout.write("😀".repeat(12000))'),
    f.start("same-call", 'process.stdout.write("duplicate")'),
  ]);
  assert.equal(a.job.id, b.job.id);
  await f.done(a.job.id);
  assert.equal(f.jobs.list().length, 1);
  await assert.rejects(f.jobs.read("other-thread", a.job.id), /该对话/);
  let offset = 0,
    text = "";
  do {
    const page = await f.jobs.read("thread-a", a.job.id, offset);
    text += page.output;
    offset = page.nextOffset;
    if (offset === page.bytes) break;
  } while (true);
  assert.equal(text, "😀".repeat(12000));
  assert.equal(f.jobs.list()[0].status, "succeeded");
});

test("失败、超时、取消和服务停止均持久保存，并取消指定任务的自动续跑", async (t) => {
  const f = await fixture(t);
  const failed = await f.start(
    "failed",
    'console.error("失败日志");process.exit(7)',
  );
  assert.equal((await f.done(failed.job.id)).exitCode, 7);
  const timeout = await f.start("timeout", "setInterval(()=>{},1000)", {
    timeout_ms: 100,
  });
  assert.equal((await f.done(timeout.job.id)).status, "timed_out");
  const cancelled = await f.start("cancelled", "setInterval(()=>{},1000)");
  await f.jobs.tool({
    name: "background_cancel",
    threadId: "thread-a",
    args: { job_id: cancelled.job.id },
  });
  const result = await f.done(cancelled.job.id);
  assert.equal(result.status, "cancelled");
  assert.equal(result.delivery, "suppressed");
  const alive = await f.start("alive", "setInterval(()=>{},1000)");
  await f.jobs.close();
  const restored = await createBackgroundJobs(f.config);
  t.after(() => restored.close());
  assert.equal(
    restored.list().find((job) => job.id === alive.job.id).status,
    "interrupted",
  );
  assert.equal(
    restored.list().find((job) => job.id === cancelled.job.id).delivery,
    "suppressed",
  );
});

test("进程树取消会清理已脱离根进程的同组子进程", async (t) => {
  const f = await fixture(t);
  const target = join(f.directory, "descendant-completed");
  const childScript = `process.on("SIGTERM",()=>{});setTimeout(()=>require("fs").writeFileSync(${JSON.stringify(target)},"bad"),3000)`;
  const started = await f.start(
    "tree",
    `require("child_process").spawn(process.execPath,["-e",${JSON.stringify(childScript)}],{stdio:"ignore"});console.log("ready");setInterval(()=>{},1000)`,
  );
  await until(async () =>
    (await f.jobs.read("thread-a", started.job.id)).output.includes("ready"),
  );
  await delay(100);
  await f.jobs.tool({
    name: "background_cancel",
    threadId: "thread-a",
    args: { job_id: started.job.id },
  });
  await delay(3200);
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

test("恢复时把未结束进程标记为中断、把发送中的完成通知标记为待核对", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.directory, "job-crash.json"),
    JSON.stringify({
      id: "crash",
      threadId: "thread-a",
      status: "running",
      delivery: "batched",
    }),
  );
  await writeFile(
    join(f.directory, "batch-crash.json"),
    JSON.stringify({
      id: "crash",
      threadId: "thread-a",
      jobIds: ["crash"],
      status: "sending",
    }),
  );
  const restored = await createBackgroundJobs(f.config);
  t.after(() => restored.close());
  assert.equal(restored.snapshot().jobs[0].status, "interrupted");
  assert.equal(restored.snapshot().batches[0].status, "uncertain");
});

test("MCP 配置保留调用方设置，固定工具入口且不添加 Dynamic Tools", () => {
  const config = backgroundConfig(
    { backgroundDir: "/fixture/tasks", upstreamUrl: "ws://127.0.0.1:1" },
    { features: { apps: false }, mcp_servers: { other: { command: "other" } } },
  );
  assert.deepEqual(config.features, { apps: false });
  assert.equal(config.mcp_servers.other.command, "other");
  assert.equal(
    config.mcp_servers.codex_web_background.command,
    process.execPath,
  );
  assert.equal(config.thread_unload_delay_secs, 0);
  assert.equal(Object.hasOwn(config, "dynamicTools"), false);
});

test("模型读完结果与取消任务均能阻止准备中的通知重新投递", async (t) => {
  const f = await fixture(t);
  const first = await f.start("consumed", 'console.log("result")');
  await f.done(first.job.id);
  const batch = await f.jobs.claim("thread-a", "owner-a");
  assert.equal(await f.jobs.claim("thread-a", "owner-b"), null);
  await assert.rejects(
    f.jobs.updateBatch({ id: batch.id, status: "sending", owner: "owner-b" }),
    /另一服务/,
  );
  await f.jobs.tool({
    name: "background_read",
    threadId: "thread-a",
    args: { job_id: first.job.id },
  });
  const ignored = await f.jobs.updateBatch({
    id: batch.id,
    status: "sending",
    owner: "owner-a",
  });
  assert.equal(ignored.status, "suppressed");
  assert.equal(f.jobs.list()[0].delivery, "consumed");
  const second = await f.start("suppressed", 'console.log("result")');
  await f.done(second.job.id);
  const next = await f.jobs.claim("thread-a", "owner-a");
  await f.jobs.tool({
    name: "background_cancel",
    threadId: "thread-a",
    args: { job_id: second.job.id },
  });
  const stopped = await f.jobs.updateBatch({
    id: next.id,
    status: "sending",
    owner: "owner-a",
  });
  assert.equal(stopped.status, "suppressed");
});

async function wakeFixture(t) {
  const f = await fixture(t);
  const calls = [];
  let occupied = false,
    disconnected = false,
    rejectResume = false,
    receipt = false,
    dispatch;
  const request = async (method, params = {}) => {
    if (method === "snapshot") return structuredClone(f.jobs.snapshot());
    if (method === "claim") return f.jobs.claim(params.threadId, params.owner);
    if (method === "batch") return f.jobs.updateBatch(params);
    if (method === "read")
      return f.jobs.read(params.threadId, params.id, params.offset);
    if (method === "suppress")
      return f.jobs.suppressThread(params.threadId, params.cancelRunning);
  };
  const wake = createBackgroundWake({
    request,
    ready: () => !disconnected,
    busy: () => occupied,
    changed() {},
    released() {},
    resume: async () => {
      if (rejectResume) throw new Error("写入占用");
    },
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/read")
        return { thread: { status: { type: "idle" } } };
      if (method === "turn/start") {
        if (dispatch) return dispatch(params);
        return { turn: { id: "continuation" } };
      }
      if (method === "thread/turns/list")
        return {
          data: receipt
            ? [
                {
                  items: [
                    {
                      type: "functionCallOutput",
                      name: "background_completed",
                      output: JSON.stringify({
                        notification_id: f.jobs.snapshot().batches[0].id,
                      }),
                    },
                  ],
                },
              ]
            : [],
        };
    },
  });
  t.after(() => wake.close());
  const settled = async () => {
    await wake.poll();
    await wake.wait("thread-a");
    await wake.poll();
  };
  return {
    ...f,
    wake,
    calls,
    settled,
    occupied: (v) => (occupied = v),
    disconnected: (v) => (disconnected = v),
    rejectResume: (v) => (rejectResume = v),
    receipt: (v) => (receipt = v),
    dispatch: (v) => (dispatch = v),
  };
}

test("后台结果在空闲时合并提交，包含退出码和日志，重复轮询只唤醒一次", async (t) => {
  const f = await wakeFixture(t);
  const a = await f.start("a", 'console.log("first")');
  const b = await f.start("b", 'console.log("second");process.exit(1)');
  await f.done(a.job.id);
  await f.done(b.job.id);
  f.occupied(true);
  await f.settled();
  assert.equal(f.calls.length, 0);
  f.occupied(false);
  await f.settled();
  await f.settled();
  const starts = f.calls.filter((call) => call.method === "turn/start");
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].params.input, []);
  const output = JSON.parse(starts[0].params.toolOutput.output);
  assert.equal(output.results.length, 2);
  assert.ok(
    output.results.some(
      (result) =>
        result.exit_code === 1 && result.output_tail.includes("second"),
    ),
  );
  assert.ok(f.jobs.list().every((job) => job.delivery === "accepted"));
});

test("断线期间保留结果；发送结果不明时先查历史，已受理后不重复提交", async (t) => {
  const f = await wakeFixture(t);
  const a = await f.start("network", 'console.log("done")');
  await f.done(a.job.id);
  f.disconnected(true);
  await f.settled();
  assert.equal(f.calls.length, 0);
  f.disconnected(false);
  f.dispatch(async () => {
    throw new Error("连接中断");
  });
  await f.settled();
  assert.equal(f.jobs.list()[0].delivery, "uncertain");
  f.receipt(true);
  await f.wake.action("retry", { threadId: "thread-a", id: a.job.id });
  await f.settled();
  assert.equal(f.jobs.list()[0].delivery, "accepted");
  assert.equal(
    f.calls.filter((call) => call.method === "turn/start").length,
    1,
  );
});

test("取消已完成任务会阻止投递；恢复写入失败保留可重试结果", async (t) => {
  const f = await wakeFixture(t);
  const a = await f.start("cancel-before-wake", 'console.log("done")');
  await f.done(a.job.id);
  await f.jobs.tool({
    name: "background_cancel",
    threadId: "thread-a",
    args: { job_id: a.job.id },
  });
  await f.settled();
  assert.equal(f.calls.length, 0);
  const b = await f.start("busy", 'console.log("retry")');
  await f.done(b.job.id);
  f.rejectResume(true);
  await f.settled();
  assert.equal(
    f.calls.filter((call) => call.method === "turn/start").length,
    0,
  );
  assert.equal(
    f.jobs.list().find((job) => job.id === b.job.id).delivery,
    "pending",
  );
  f.rejectResume(false);
  await f.wake.action("retry", { threadId: "thread-a", id: b.job.id });
  await f.settled();
  assert.equal(
    f.calls.filter((call) => call.method === "turn/start").length,
    1,
  );
});

test("显式重试后迟到的历史记录在再次发送前核对，避免重复轮次", async (t) => {
  const f = await wakeFixture(t);
  const started = await f.start("late-receipt", 'console.log("result")');
  await f.done(started.job.id);
  f.dispatch(() => {
    throw new Error("连接已断开");
  });
  await f.settled();
  assert.equal(f.jobs.list()[0].delivery, "uncertain");
  await f.wake.action("retry", { threadId: "thread-a", id: started.job.id });
  f.receipt(true);
  await f.settled();
  assert.equal(f.jobs.list()[0].delivery, "accepted");
  assert.equal(
    f.calls.filter((call) => call.method === "turn/start").length,
    1,
  );
});
