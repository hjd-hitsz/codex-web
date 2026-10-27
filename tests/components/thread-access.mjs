import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testThreadAccess(app, requests, setResponse, emit) {
  const original = app.get();
  const thread = { id: "writer-fixture", cwd: "/writer-test", createdAt: 1 };
  const conflict = { message: "thread fixture already has an active writer" };
  let finishResume;
  let locked = true;
  let view;
  const start = requests.length;
  setResponse(({ method }) => {
    if (method === "thread/read") return { thread };
    if (method === "thread/resume")
      return new Promise((resolve) => (finishResume = resolve));
    if (method === "thread/items/list")
      return {
        data: [
          {
            turnId: "saved-turn",
            item: {
              id: "saved-answer",
              type: "agentMessage",
              text: "已经保存的回答",
            },
          },
        ],
        nextCursor: null,
      };
    if (method === "thread/turns/list")
      return { data: [{ id: "other-turn", status: "inProgress" }] };
    if (method === "turn/start")
      return locked
        ? { error: conflict }
        : { turn: { id: "web-turn", status: "inProgress" } };
    if (method === "thread/list") return { data: [thread] };
    return { data: [] };
  });
  try {
    app.newChat(thread.cwd);
    app.set({ connected: true, threads: [], active: {}, serviceTier: null });
    localStorage.setItem("cx-draft-" + thread.id, "保留待发送内容");
    let opened;
    await act(async () => {
      opened = app.openThread(thread.id);
      view = create(React.createElement(app.Conversation));
    });
    assert(finishResume);
    assert.equal(app.get().loading, false);
    assert.equal(app.get().current.id, thread.id);
    assert.equal(app.get().draft, "保留待发送内容");
    assert(JSON.stringify(view.toJSON()).includes("已经保存的回答"));
    assert.deepEqual(
      requests.slice(start, start + 1).map((request) => request.method),
      ["thread/read"],
    );
    await act(async () => {
      finishResume({ error: conflict });
      await opened;
    });
    assert.equal(app.get().error, "");
    assert.equal(app.get().active[thread.id], undefined);
    assert.equal(app.get().serviceTier, null);
    assert(JSON.stringify(view.toJSON()).includes("另一端持有写入权"));
    assert(JSON.stringify(view.toJSON()).includes("已经保存的回答"));
    const attachments = [
      {
        id: "fixture-image",
        input: { type: "image", url: "data:image/png;base64,AQ==" },
      },
    ];
    await act(async () => app.set({ attachments }));
    await act(async () => assert.equal(await app.sendMessage(), false));
    assert(app.get().error.includes("草稿已保留"));
    assert.equal(app.get().draft, "保留待发送内容");
    assert.equal(
      localStorage.getItem("cx-draft-" + thread.id),
      "保留待发送内容",
    );
    assert.equal(app.get().items.filter((item) => item.optimistic).length, 0);
    assert.deepEqual(app.get().attachments, attachments);
    assert.equal(
      requests.slice(start).filter((request) => request.method === "turn/steer")
        .length,
      0,
    );
    locked = false;
    await act(async () => assert.equal(await app.sendMessage(), true));
    assert.equal(app.get().threadWarning, "");
    assert.equal(app.get().draft, "");
    assert.deepEqual(app.get().attachments, []);
    assert.equal(app.get().active[thread.id], "web-turn");
    assert.equal(
      requests.slice(start).filter((request) => request.method === "turn/start")
        .length,
      2,
    );

    let refreshed;
    await act(async () => {
      refreshed = app.openThread(thread.id);
    });
    await act(async () => {
      app.set({
        model: "selected-model",
        effort: "ultra",
        serviceTier: "priority",
      });
      finishResume({
        thread,
        model: "saved-model",
        reasoningEffort: "low",
        serviceTier: null,
      });
      await refreshed;
    });
    assert.equal(app.get().model, "selected-model");
    assert.equal(app.get().effort, "ultra");
    assert.equal(app.get().serviceTier, "priority");

    await act(async () => {
      refreshed = app.openThread(thread.id);
    });
    await act(async () => {
      emit("turn/started", {
        threadId: thread.id,
        turn: { id: "new-live-turn", status: "inProgress" },
      });
      finishResume({ error: conflict });
      await refreshed;
    });
    assert.equal(app.get().active[thread.id], "new-live-turn");
    assert.equal(app.get().threadWarning, "");

    let stale;
    await act(async () => {
      stale = app.openThread(thread.id);
    });
    await act(async () => {
      app.newChat("/other");
      app.setDraft("新对话草稿");
      finishResume({ error: conflict });
      await stale;
    });
    assert.equal(app.get().current, null);
    assert.equal(app.get().threadWarning, "");
    assert.equal(app.get().draft, "新对话草稿");
    console.log(
      "PASS 写入占用期间先显示历史、保留草稿、发送重试与迟到响应隔离",
    );
  } finally {
    await act(async () => {
      view?.unmount();
      app.newChat();
      app.set(original);
    });
    localStorage.removeItem("cx-draft-" + thread.id);
  }
}
