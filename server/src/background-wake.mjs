import { randomUUID } from "node:crypto";
import { backgroundRequest } from "./background-client.mjs";

function hasReceipt(items, id) {
  return (items || []).some((item) => {
    if (
      item.type !== "functionCallOutput" ||
      item.name !== "background_completed"
    )
      return false;
    const text =
      typeof item.output === "string"
        ? item.output
        : item.output?.map((entry) => entry.text || "").join("");
    try {
      return JSON.parse(text).notification_id === id;
    } catch {
      return false;
    }
  });
}

export function createBackgroundWake({
  directory,
  call,
  resume,
  ready,
  busy,
  changed,
  released,
  request: suppliedRequest,
}) {
  const owner = randomUUID(),
    active = new Map(),
    retryAt = new Map();
  let jobs = [],
    batches = [],
    error = "",
    polling = false,
    stopped = false;
  const request =
    suppliedRequest ||
    ((method, params) => backgroundRequest(directory, method, params));
  const publish = () => changed({ jobs, error });
  async function receipt(batch) {
    let cursor;
    do {
      const page = await call("thread/turns/list", {
        threadId: batch.threadId,
        limit: 100,
        itemsView: "full",
        ...(cursor ? { cursor } : {}),
      });
      if ((page.data || []).some((turn) => hasReceipt(turn.items, batch.id)))
        return true;
      cursor = page.nextCursor;
    } while (cursor);
    return false;
  }
  async function reconcile(batch) {
    if (await receipt(batch)) {
      await request("batch", { id: batch.id, status: "accepted" });
      return true;
    }
    if (batch.status === "sending")
      await request("batch", {
        id: batch.id,
        status: "uncertain",
        error: "继续请求的结果需要核对，可点击检查并重试",
      });
    return false;
  }
  async function wake(threadId) {
    let batch,
      sending = false,
      renewal;
    try {
      const { thread } = await call("thread/read", {
        threadId,
        includeTurns: false,
      });
      if (
        thread?.archived ||
        thread?.path?.replaceAll("\\", "/").includes("/archived_sessions/")
      ) {
        await request("suppress", { threadId });
        return;
      }
      if (thread?.status?.type === "active" || busy(threadId) || stopped)
        return;
      batch = await request("claim", { threadId, owner });
      if (!batch) return;
      if (batch.attemptedAt && (await reconcile(batch))) return;
      renewal = setInterval(
        () => request("claim", { threadId, owner }).catch(() => {}),
        30000,
      );
      renewal.unref();
      await resume(threadId);
      if (busy(threadId) || stopped) {
        await request("batch", { id: batch.id, status: "pending", owner });
        return;
      }
      const current = await request("snapshot");
      const selected = current.jobs.filter(
        (job) =>
          batch.jobIds.includes(job.id) &&
          !["suppressed", "consumed"].includes(job.delivery),
      );
      if (!selected.length) {
        await request("batch", { id: batch.id, status: "suppressed", owner });
        return;
      }
      const results = [];
      let remainingOutput = 24000;
      for (const job of selected) {
        const log = await request("read", { threadId, id: job.id });
        const limit = Math.max(0, Math.min(8000, remainingOutput));
        const tail = limit ? [...log.output].slice(-limit).join("") : "";
        remainingOutput -= [...tail].length;
        results.push({
          job_id: job.id,
          title: job.title,
          command: job.command.slice(0, 2000),
          cwd: job.cwd,
          status: job.status,
          exit_code: job.exitCode,
          error: job.error,
          duration_ms: job.completedAt - job.startedAt,
          output_tail: tail,
          log_truncated: job.logTruncated,
        });
      }
      const delivery = await request("batch", {
        id: batch.id,
        status: "sending",
        owner,
      });
      if (delivery.status !== "sending") return;
      sending = true;
      const result = await call("turn/start", {
        threadId,
        input: [],
        turnTrigger: "background_task",
        toolOutput: {
          name: "background_completed",
          output: JSON.stringify({
            notification_id: batch.id,
            results: results.filter((result) =>
              delivery.deliveryJobIds.includes(result.job_id),
            ),
            instruction:
              "后台任务已结束。请结合原任务检查结果，按需使用 background_read 读取日志并继续后续工作。",
          }),
        },
      });
      await request("batch", {
        id: batch.id,
        status: "accepted",
        turnId: result.turn?.id,
        owner,
      });
      retryAt.delete(threadId);
    } catch (failure) {
      const archived = /^(?:session|thread)\s+(\S+)\s+is archived\b/i.exec(
        failure.message,
      );
      if (archived?.[1] === threadId) {
        await request("suppress", { threadId }).catch(() => {});
        return;
      }
      retryAt.set(threadId, Date.now() + 10000);
      if (batch)
        await request("batch", {
          id: batch.id,
          status: sending && !failure.rpcRejected ? "uncertain" : "pending",
          error:
            sending && !failure.rpcRejected
              ? "继续请求的结果需要核对，可点击检查并重试"
              : failure.message,
          owner,
        }).catch(() => {});
    } finally {
      clearInterval(renewal);
    }
  }
  function launch(threadId, work) {
    if (active.has(threadId)) return active.get(threadId);
    const promise = work()
      .catch((failure) => {
        error = failure.message;
        publish();
      })
      .finally(() => {
        active.delete(threadId);
        released();
      });
    active.set(threadId, promise);
    return promise;
  }
  return {
    snapshot: () => ({ jobs, error }),
    busy: (threadId) => active.has(threadId),
    wait: (threadId) => active.get(threadId),
    async poll() {
      if (polling || stopped) return;
      polling = true;
      try {
        const state = await request("snapshot");
        const previous = JSON.stringify({ jobs, error });
        jobs = state.jobs;
        batches = state.batches;
        error = "";
        if (JSON.stringify({ jobs, error }) !== previous) publish();
        if (!ready()) return;
        for (const batch of batches)
          if (
            ["sending", "uncertain"].includes(batch.status) &&
            !active.has(batch.threadId) &&
            !busy(batch.threadId) &&
            Date.now() >= (retryAt.get(batch.threadId) || 0)
          ) {
            retryAt.set(batch.threadId, Date.now() + 30000);
            launch(batch.threadId, () => reconcile(batch));
          }
        const threads = new Set([
          ...jobs
            .filter(
              (job) => job.status !== "running" && job.delivery === "pending",
            )
            .map((job) => job.threadId),
          ...batches
            .filter((batch) => ["pending", "preparing"].includes(batch.status))
            .map((batch) => batch.threadId),
        ]);
        for (const threadId of threads)
          if (
            !active.has(threadId) &&
            !busy(threadId) &&
            Date.now() >= (retryAt.get(threadId) || 0)
          )
            launch(threadId, () => wake(threadId));
      } catch (failure) {
        if (failure.code !== "ENOENT" && error !== failure.message) {
          error = "后台任务服务连接失败：" + failure.message;
          publish();
        }
      } finally {
        polling = false;
      }
    },
    async action(method, params) {
      if (method === "read") return request("read", params);
      if (method === "cancel") {
        return request("tool", {
          name: "background_cancel",
          threadId: params.threadId,
          args: { job_id: params.id },
        });
      }
      if (method === "retry") {
        await active.get(params.threadId);
        const state = await request("snapshot");
        const batch = state.batches.find(
          (entry) =>
            entry.threadId === params.threadId &&
            entry.jobIds.includes(params.id),
        );
        retryAt.delete(params.threadId);
        if (
          !batch ||
          batch.status === "accepted" ||
          batch.status === "suppressed"
        )
          return {};
        if (!(await reconcile(batch)))
          await request("batch", { id: batch.id, status: "pending" });
        return {};
      }
      throw new Error("未知后台任务操作");
    },
    async suppress(threadId, cancelRunning) {
      try {
        await request("suppress", { threadId, cancelRunning });
      } catch (failure) {
        if (failure.code !== "ENOENT")
          console.error("后台任务归属更新：", failure.message);
      }
    },
    async close() {
      stopped = true;
      await Promise.all(active.values());
    },
  };
}
