import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testBackgroundJobs(app, requests, setResponse, emit) {
  const original = app.get();
  const job = (id, threadId = "background-a") => ({
    id,
    threadId,
    title: "任务 " + id,
    command: "npm test",
    cwd: "/fixture/project",
    status: "succeeded",
    exitCode: 0,
    delivery: "uncertain",
  });
  let jobs = [job("first"), job("second"), job("private", "background-b")];
  let fail = false,
    hold = false,
    release;
  const log = (id, offset = 0) => ({
    job: jobs.find((entry) => entry.id === id),
    output: `${id} 日志 ${offset}`,
    offset,
    nextOffset: offset + 10,
    bytes: 100,
  });
  setResponse(({ method, params }) => {
    if (method === "lan/background/read") {
      if (fail) return { error: { message: "隔离日志读取失败" } };
      if (hold)
        return new Promise((resolve) => {
          release = () => resolve(log(params.id, params.offset));
        });
      return log(params.id, params.offset);
    }
    if (method === "lan/background/list") return { jobs, error: "" };
    if (
      method === "lan/background/cancel" ||
      method === "lan/background/retry"
    ) {
      jobs = jobs.map((entry) =>
        entry.id === params.id
          ? {
              ...entry,
              delivery: method.endsWith("cancel") ? "suppressed" : "pending",
            }
          : entry,
      );
      return {};
    }
    return { data: [] };
  });
  let view, status;
  const text = () => JSON.stringify(view.toJSON());
  const click = async (title) =>
    act(async () => view.root.findByProps({ title }).props.onClick());
  try {
    await act(async () => {
      app.set({
        current: { id: "background-a" },
        backgroundJobs: jobs,
        backgroundError: "",
        connected: true,
        draft: "继续保留的草稿",
        attachments: [{ id: "draft-attachment" }],
        panel: null,
        contextOpen: false,
      });
      view = create(
        React.createElement(app.BackgroundJobsPanel, { key: "background-a" }),
      );
      status = create(React.createElement(app.BackgroundStatus));
    });
    assert(text().includes("first 日志 0"));
    assert(!text().includes("任务 private"));
    assert.equal(
      view.root.findAllByProps({ title: "检查并重试继续" }).length,
      2,
    );
    await act(async () => status.root.findByType("button").props.onClick());
    assert.equal(app.get().panel, "background");
    assert.equal(app.get().contextOpen, true);
    await act(async () =>
      view.root.findAllByProps({ title: "检查并重试继续" })[0].props.onClick(),
    );
    assert(
      requests.some(
        (entry) =>
          entry.method === "lan/background/retry" &&
          entry.params.id === "first",
      ),
    );
    await act(async () =>
      view.root.findAllByProps({ title: "取消自动继续" })[0].props.onClick(),
    );
    assert(text().includes("自动继续已关闭"));
    assert.equal(app.get().draft, "继续保留的草稿");
    assert.deepEqual(app.get().attachments, [{ id: "draft-attachment" }]);

    hold = true;
    await act(async () =>
      view.root
        .findAllByType("button")
        .find((node) => node.props.children === "继续读取")
        .props.onClick(),
    );
    const finishOld = release;
    hold = false;
    await act(async () =>
      view.root
        .findAllByProps({ className: "background-job-select" })[1]
        .props.onClick(),
    );
    assert(text().includes("second 日志 0"));
    await act(async () => finishOld());
    assert(text().includes("second 日志 0"));
    assert(!text().includes("first 日志 10"));

    fail = true;
    await click("刷新后台任务");
    assert(text().includes("隔离日志读取失败"));
    fail = false;
    await act(async () =>
      view.root
        .findAllByType("button")
        .find((node) => node.props.children === "重试读取")
        .props.onClick(),
    );
    assert(text().includes("second 日志 0"));
    await act(async () =>
      emit("lan/backgroundJobs", {
        jobs: jobs.map((entry) => ({ ...entry, delivery: "accepted" })),
        error: "",
      }),
    );
    assert.equal(status.toJSON(), null);
    assert.equal(app.get().draft, "继续保留的草稿");

    await act(async () => {
      app.set({ current: { id: "background-b" }, backgroundJobs: jobs });
      view.update(
        React.createElement(app.BackgroundJobsPanel, { key: "background-b" }),
      );
    });
    assert(text().includes("private 日志 0"));
    assert(!text().includes("任务 first"));
    await act(async () => {
      view.update(
        React.createElement(app.BackgroundCompletion, {
          output: JSON.stringify({
            notification_id: "internal-id",
            results: [
              {
                job_id: "result",
                title: "检查构建",
                status: "failed",
                exit_code: 7,
                output_tail: "构建失败日志",
              },
            ],
          }),
        }),
      );
    });
    assert(
      text().includes("检查构建") &&
        text().includes("执行失败") &&
        text().includes("退出码 7"),
    );
    assert(!text().includes("internal-id"));
    console.log(
      "PASS 后台任务状态、取消与重试、日志迟到隔离、切换对话及草稿附件保留",
    );
  } finally {
    await act(async () => {
      view?.unmount();
      status?.unmount();
      app.set(original);
    });
  }
}
