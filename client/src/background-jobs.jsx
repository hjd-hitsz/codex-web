import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Square,
  Timer,
} from "lucide-react";
import { rpc, set, useStore } from "./store";

const statusLabels = {
  running: "运行中",
  succeeded: "已完成",
  failed: "执行失败",
  timed_out: "已超时",
  cancelled: "已停止",
  interrupted: "已中断",
};
const deliveryLabels = {
  pending: "等待继续",
  batched: "等待继续",
  preparing: "准备继续",
  sending: "正在继续",
  accepted: "已提交继续",
  uncertain: "继续结果待核对",
  suppressed: "自动继续已关闭",
  consumed: "结果已读取",
};

export function BackgroundCompletion({ output }) {
  const text =
    typeof output === "string"
      ? output
      : output?.map((entry) => entry.text || "").join("");
  let results;
  try {
    results = JSON.parse(text).results;
  } catch {
    /* 旧记录保留原始输出。 */
  }
  if (!Array.isArray(results)) return <pre>{text}</pre>;
  return results.map((result) => (
    <div key={result.job_id}>
      <b>{result.title}</b>
      <small>
        {" "}
        · {statusLabels[result.status] || result.status}
        {result.exit_code != null ? ` · 退出码 ${result.exit_code}` : ""}
      </small>
      {result.error && <p>{result.error}</p>}
      <pre>{result.output_tail || "暂无输出"}</pre>
    </div>
  ));
}

export function BackgroundStatus() {
  const s = useStore();
  const jobs = (s.backgroundJobs || []).filter(
    (job) => job.threadId === s.current?.id,
  );
  const running = jobs.filter((job) => job.status === "running").length;
  const pending = jobs.filter(
    (job) =>
      job.status !== "running" &&
      !["accepted", "suppressed", "consumed"].includes(job.delivery),
  ).length;
  if (!running && !pending) return null;
  return (
    <button
      className="background-status"
      onClick={() => set({ panel: "background", contextOpen: true })}
    >
      <Timer size={14} />
      <span>
        后台任务 · {running ? `${running} 项运行中` : `${pending} 项等待继续`}
      </span>
      <ChevronRight size={13} />
    </button>
  );
}

export function BackgroundJobsPanel() {
  const s = useStore();
  const threadId = s.current?.id;
  const jobs = (s.backgroundJobs || []).filter(
    (job) => job.threadId === threadId,
  );
  const [selected, select] = useState(null);
  const [limit, showMore] = useState(10);
  const [log, updateLog] = useState(null);
  const [error, showError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, retry] = useState(0);
  const [offset, setOffset] = useState();
  const mounted = useRef(true);
  const current = jobs.find((job) => job.id === selected);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!selected && jobs.length) select(jobs[0].id);
  }, [selected, jobs.length]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false,
      reading = false;
    updateLog(null);
    showError("");
    async function read() {
      if (reading) return;
      reading = true;
      try {
        const value = await rpc("lan/background/read", {
          threadId,
          id: selected,
          offset,
        });
        if (!cancelled) {
          updateLog(value);
          showError("");
        }
      } catch (failure) {
        if (!cancelled) showError(failure.message);
      } finally {
        reading = false;
      }
    }
    read();
    const timer =
      current?.status === "running" ? setInterval(read, 1000) : null;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [threadId, selected, current?.status, attempt, offset]);
  async function refresh() {
    const state = await rpc("lan/background/list");
    set({ backgroundJobs: state.jobs, backgroundError: state.error });
    if (mounted.current) retry((value) => value + 1);
  }
  async function action(method, id) {
    setBusy(true);
    showError("");
    try {
      await rpc("lan/background/" + method, { threadId, id });
      await refresh();
    } catch (failure) {
      if (mounted.current) showError(failure.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function page(nextOffset) {
    setOffset(nextOffset);
    retry((value) => value + 1);
  }
  return (
    <section className="background-panel context-panel" aria-label="后台任务">
      <div className="panel-heading">
        <span>
          <Timer size={16} />
          <strong>后台任务</strong>
        </span>
        <button
          title="刷新后台任务"
          disabled={busy}
          onClick={() =>
            refresh().catch((failure) => showError(failure.message))
          }
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {(error || s.backgroundError) && (
        <div className="background-notice" role="alert">
          {error || s.backgroundError}
          <button onClick={() => retry((v) => v + 1)}>重试读取</button>
        </div>
      )}
      {!jobs.length && (
        <p className="background-notice">当前对话没有后台任务。</p>
      )}
      <div className="background-job-list">
        {jobs.slice(0, limit).map((job) => (
          <div
            className="background-job"
            key={job.id}
            data-selected={selected === job.id}
          >
            <button
              className="background-job-select"
              aria-pressed={selected === job.id}
              onClick={() => {
                setOffset(undefined);
                select(job.id);
              }}
            >
              {job.status === "running" ? (
                <LoaderCircle size={15} className="spin" />
              ) : job.status === "succeeded" ? (
                <CheckCircle2 size={15} />
              ) : (
                <Timer size={15} />
              )}
              <span>
                <b>{job.title}</b>
                <small>
                  {statusLabels[job.status] || job.status}
                  {job.status !== "running" && job.delivery
                    ? " · " + (deliveryLabels[job.delivery] || "等待继续")
                    : ""}
                </small>
              </span>
            </button>
            {(job.status === "running" ||
              ["pending", "batched", "preparing", "uncertain"].includes(
                job.delivery,
              )) && (
              <button
                title={
                  job.status === "running" ? "停止后台任务" : "取消自动继续"
                }
                disabled={busy}
                onClick={() => action("cancel", job.id)}
              >
                <Square size={13} />
              </button>
            )}
            {job.status !== "running" &&
              ["uncertain", "pending"].includes(job.delivery) && (
                <button
                  title="检查并重试继续"
                  disabled={busy}
                  onClick={() => action("retry", job.id)}
                >
                  <RefreshCw size={13} />
                </button>
              )}
          </div>
        ))}
        {jobs.length > limit && (
          <button
            className="background-more"
            onClick={() => showMore((value) => value + 10)}
          >
            显示更多任务
          </button>
        )}
      </div>
      {current && (
        <div className="background-job-log">
          <code className="background-command">{current.command}</code>
          <small>
            {current.cwd}
            {current.exitCode != null ? ` · 退出码 ${current.exitCode}` : ""}
          </small>
          {current.deliveryError && (
            <p className="background-notice">{current.deliveryError}</p>
          )}
          {current.error && (
            <p className="background-notice">{current.error}</p>
          )}
          {log ? (
            <>
              <div className="background-log-actions">
                <button onClick={() => page(0)}>从头读取</button>
                {log.nextOffset < log.bytes && (
                  <button onClick={() => page(log.nextOffset)}>继续读取</button>
                )}
                <span>
                  {log.offset}–{log.nextOffset} / {log.bytes} 字节
                </span>
              </div>
              <pre tabIndex={0} aria-label="后台任务日志">
                {log.output || "暂无输出"}
              </pre>
            </>
          ) : (
            !error && <p className="background-notice">正在读取日志…</p>
          )}
          {current.logTruncated && <small>日志已达到保存上限。</small>}
        </div>
      )}
    </section>
  );
}
