import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testHistory(app, requests, setResponse, emit) {
  const original = app.get();
  const thread = { id: "history-fixture", cwd: "/history-test", createdAt: 1 };
  const entries = Array.from({ length: 75 }, (_, index) => {
    const turnId = `history-turn-${index}`;
    return [
      {
        turnId,
        item: {
          id: `history-user-${index}`,
          type: "userMessage",
          content: [{ type: "text", text: `第 ${index + 1} 轮请求` }],
        },
      },
      {
        turnId,
        item: {
          id: `history-command-${index}`,
          type: "commandExecution",
          command: "pwd",
          status: "completed",
        },
      },
      {
        turnId,
        item: {
          id: `history-answer-${index}`,
          type: "agentMessage",
          phase: "final_answer",
          text: `第 ${index + 1} 轮回答`,
        },
      },
    ];
  }).flat();
  const descending = entries.slice().reverse();
  let finishPage;
  let holdPage = false;
  let view;
  let loading;
  let scrolls = 0;
  const start = requests.length;
  const historyRequests = () =>
    requests
      .slice(start)
      .filter((request) => request.method === "thread/items/list");
  setResponse(({ method, params }) => {
    if (method === "thread/read" || method === "thread/resume")
      return { thread };
    if (method === "thread/items/list") {
      const offset = Number(params.cursor || 0);
      const page = {
        data: descending.slice(offset, offset + params.limit),
        nextCursor:
          offset + params.limit < descending.length
            ? String(offset + params.limit)
            : null,
      };
      if (holdPage)
        return new Promise((resolve) => (finishPage = () => resolve(page)));
      return page;
    }
    return { data: [] };
  });
  try {
    app.newChat(thread.cwd);
    app.set({ connected: true, active: {}, questions: [], plans: {} });
    await act(async () => {
      await app.openThread(thread.id);
      view = create(React.createElement(app.Conversation), {
        createNodeMock: () => ({
          set scrollTop(value) {
            scrolls++;
          },
          querySelectorAll: () => [],
          getBoundingClientRect: () => ({ top: 0 }),
          addEventListener() {},
          removeEventListener() {},
        }),
      });
    });
    assert.deepEqual(
      historyRequests().map((request) => request.params.cursor),
      [undefined, "100", "200"],
    );
    assert.deepEqual(
      app.get().items.map((item) => item.id),
      entries.map(({ item }) => item.id),
    );
    assert.equal(
      view.root.findAllByProps({ className: "user-bubble" }).length,
      75,
    );
    assert.equal(
      view.root.findAllByProps({ className: "message assistant-message" })
        .length,
      75,
    );
    const text = JSON.stringify(view.toJSON());
    assert(text.includes("第 1 轮请求") && text.includes("第 75 轮回答"));
    assert(!text.includes("加载更早的消息"));
    await act(async () => app.set({ loading: true }));
    const beforeLoaded = scrolls;
    await act(async () => app.set({ loading: false }));
    assert(scrolls > beforeLoaded, "历史显示完成后应重新定位到最新消息");
    await act(async () => view.unmount());
    view = null;

    holdPage = true;
    app.set({ items: [] });
    loading = app.loadHistory();
    assert(finishPage);
    await emit("item/completed", {
      threadId: thread.id,
      turnId: "history-turn-74",
      item: { ...entries.at(-1).item, text: "读取历史期间更新的回答" },
    });
    await emit("item/completed", {
      threadId: thread.id,
      turnId: "history-live-turn",
      item: {
        id: "history-live-answer",
        type: "agentMessage",
        text: "实时新增回答",
      },
    });
    holdPage = false;
    finishPage();
    await loading;
    assert.equal(app.get().items.length, entries.length + 1);
    assert.equal(app.get().items.at(-2).text, "读取历史期间更新的回答");
    assert.equal(app.get().items.at(-1).text, "实时新增回答");

    holdPage = true;
    finishPage = null;
    loading = app.loadHistory();
    const beforeSwitch = historyRequests().length;
    assert(finishPage);
    app.newChat("/another-history-test");
    finishPage();
    await loading;
    assert.equal(historyRequests().length, beforeSwitch);
    assert.equal(app.get().current, null);
    assert.deepEqual(app.get().items, []);

    const legacyTurns = Array.from({ length: 75 }, (_, index) => ({
      id: `history-turn-${index}`,
      status: "completed",
      items: entries
        .filter((entry) => entry.turnId === `history-turn-${index}`)
        .map((entry) => entry.item),
    })).reverse();
    setResponse(({ method, params }) => {
      if (method === "thread/read") return { thread };
      if (method === "thread/items/list")
        return {
          error: { message: "thread/items/list is not supported yet" },
        };
      if (method === "thread/resume")
        return {
          error: { message: "thread fixture already has an active writer" },
        };
      if (method === "thread/turns/list") {
        if (params.itemsView !== "full") return { data: [] };
        const offset = Number(params.cursor || 0);
        return {
          data: legacyTurns.slice(offset, offset + 40),
          nextCursor: offset === 0 ? "40" : null,
        };
      }
      return { data: [] };
    });
    await act(async () => {
      await app.openThread(thread.id);
      view = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(app.Conversation),
          React.createElement(app.Composer),
        ),
      );
    });
    assert.equal(app.get().threadAccess.status, "blocked");
    assert.equal(app.get().loading, false);
    assert.deepEqual(
      app.get().items.map((item) => item.id),
      entries.map(({ item }) => item.id),
    );
    const legacyText = JSON.stringify(view.toJSON());
    assert(legacyText.includes("第 1 轮请求"));
    assert(legacyText.includes("第 75 轮回答"));
    assert(legacyText.includes("此对话由另一端使用"));
    assert(!legacyText.includes("暂时无法连接此对话"));
  } finally {
    holdPage = false;
    if (finishPage) finishPage();
    if (loading) await loading;
    if (view) await act(async () => view.unmount());
    app.newChat();
    app.set(original);
  }
  console.log(
    "PASS 全部历史分页、实时更新与切换隔离、旧对话接口回退及写入占用时查看历史",
  );
}
