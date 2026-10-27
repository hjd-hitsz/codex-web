import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import {
  annotationMessage,
  parseAnnotations,
} from "../../client/src/annotations.js";

export async function testAnnotations(app, requests, setResponse) {
  const original = app.get();
  const previousWindow = globalThis.window;
  const entries = [
    { text: "原文第一段", annotation: "请补充条件" },
    { text: "原文第二段", annotation: "请修正" },
  ];
  const thread = { id: "annotation-fixture", cwd: "/annotation-fixture" };
  let view,
    fail = true;
  setResponse(({ method }) => {
    if (method === "turn/start" && fail)
      return { error: { message: "模拟发送失败" } };
    if (method === "thread/list") return { data: [thread], nextCursor: null };
    return { data: [], directories: {} };
  });
  const text =
    '已处理。:codex-annotation{index="1"} 也已修正。:codex-annotation{index="2"}';
  const items = [
    {
      id: "annotation-user",
      type: "userMessage",
      turnId: "annotation-turn",
      content: [{ type: "text", text: annotationMessage(entries) }],
    },
    {
      id: "annotation-reply",
      type: "agentMessage",
      turnId: "annotation-turn",
      phase: "final_answer",
      text,
    },
  ];
  const node = {};
  const listeners = new Map();
  const ownerDocument = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  const renderOptions = {
    createNodeMock: () => ({
      contains: (entry) => entry === node,
      innerText: "回复全文",
      ownerDocument,
      scrollIntoView() {},
    }),
  };
  let selection = { rangeCount: 0 };
  globalThis.window = {
    ...previousWindow,
    innerWidth: 1000,
    innerHeight: 700,
    getSelection: () => selection,
  };
  try {
    app.set({
      connected: true,
      current: thread,
      items,
      turns: { [thread.id]: [{ id: "annotation-turn", status: "completed" }] },
      active: {},
      questions: [],
      plans: {},
      loading: false,
      busy: false,
      threadAccess: null,
      draft: "保留消息草稿",
      attachments: [{ id: "kept" }],
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation), renderOptions);
    });
    const marker = () =>
      view.root.findAllByProps({ className: "annotation-marker" });
    assert.equal(
      view.root.findAllByProps({ className: "annotation-add" }).length,
      0,
    );
    assert.equal(marker().length, 2);
    assert.equal(
      view.root.findAllByProps({ className: "annotation-card" }).length,
      2,
    );
    await act(async () => marker()[0].props.onClick());
    assert(JSON.stringify(view.toJSON()).includes("请补充条件"));
    assert.equal(
      view.root.findByProps({ role: "note" }).findAllByType("strong").length,
      2,
    );
    await act(async () =>
      app.set({ items: [items[0], { ...items[1], text: text + " 流式更新" }] }),
    );
    assert.equal(marker()[0].props["aria-expanded"], true);

    selection = {
      rangeCount: 1,
      isCollapsed: false,
      toString: () => "选中原文😀",
      getRangeAt: () => ({
        startContainer: node,
        endContainer: node,
        startOffset: 2,
        getBoundingClientRect: () => ({ left: 950, bottom: 680 }),
        cloneRange: () => ({
          selectNodeContents() {},
          setEnd() {},
          toString: () => "前缀",
        }),
      }),
    };
    const selectedText = selection;
    async function addSelectedAnnotation() {
      selection = selectedText;
      await act(async () => listeners.get("selectionchange")());
      await act(async () =>
        view.root.findByProps({ className: "annotation-add" }).props.onClick(),
      );
    }
    await act(async () => listeners.get("selectionchange")());
    assert.deepEqual(
      view.root.findByProps({ className: "annotation-add" }).props.style,
      { position: "fixed", zIndex: 40, left: 840, top: 656 },
    );
    await act(async () =>
      view.root.findByProps({ className: "annotation-add" }).props.onClick(),
    );
    const field = () => view.root.findByProps({ "aria-label": "注释内容" });
    await act(async () =>
      field().props.onChange({ target: { value: "请改进这段\n保留条件" } }),
    );
    await act(async () =>
      view.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    assert.equal(field().props.value, "请改进这段\n保留条件");
    assert(view.root.findByProps({ role: "alert" }));
    await act(async () => view.unmount());
    assert.equal(listeners.size, 0);
    await act(async () => {
      view = create(React.createElement(app.Conversation), renderOptions);
    });
    assert.equal(field().props.value, "请改进这段\n保留条件");
    await act(async () => app.set({ connected: false }));
    assert(view.root.findByProps({ type: "submit" }).props.disabled);
    await act(async () => app.set({ connected: true }));
    fail = false;
    await act(async () => {
      app.set({ active: { [thread.id]: "running-fixture" } });
    });
    await act(async () =>
      view.root.findByType("form").props.onSubmit({ preventDefault() {} }),
    );
    const sent = requests
      .filter((request) => request.method === "turn/steer")
      .at(-1);
    assert.equal(sent.params.expectedTurnId, "running-fixture");
    assert.deepEqual(parseAnnotations(sent.params.input[0].text).annotations, [
      {
        text: "选中原文😀",
        annotation: "请改进这段\n保留条件",
        source: { messageId: "annotation-reply", startOffset: 2, endOffset: 8 },
      },
    ]);
    assert.equal(app.get().draft, "保留消息草稿");
    assert.deepEqual(app.get().attachments, [{ id: "kept" }]);
    assert.equal(
      view.root.findAllByProps({ "aria-label": "注释内容" }).length,
      0,
    );
    assert.equal(
      localStorage.getItem(`cx-annotation-${thread.id}-annotation-reply`),
      null,
    );

    selection = { rangeCount: 0 };
    await act(async () => {
      app.set({ active: {}, items });
    });
    await act(async () => listeners.get("selectionchange")());
    assert.equal(
      view.root.findAllByProps({ className: "annotation-add" }).length,
      0,
    );
    await addSelectedAnnotation();
    await act(async () =>
      field().props.onChange({ target: { value: "空闲任务的批注" } }),
    );
    const count = requests.filter(
      (request) => request.method === "turn/start",
    ).length;
    await act(async () =>
      view.root.findByType("form").props.onKeyDown({
        key: "Enter",
        ctrlKey: true,
        nativeEvent: { isComposing: true },
      }),
    );
    assert.equal(
      requests.filter((request) => request.method === "turn/start").length,
      count,
    );
    await act(async () =>
      view.root.findByType("form").props.onKeyDown({
        key: "Enter",
        ctrlKey: true,
        nativeEvent: { isComposing: false },
        preventDefault() {},
      }),
    );
    const idle = requests
      .filter((request) => request.method === "turn/start")
      .at(-1);
    assert.deepEqual(parseAnnotations(idle.params.input[0].text).annotations, [
      {
        text: "选中原文😀",
        annotation: "空闲任务的批注",
        source: { messageId: "annotation-reply", startOffset: 2, endOffset: 8 },
      },
    ]);
    assert.equal(app.get().draft, "保留消息草稿");
    assert.deepEqual(app.get().attachments, [{ id: "kept" }]);
    await addSelectedAnnotation();
    await act(async () =>
      field().props.onChange({ target: { value: "切换对话时保留" } }),
    );
    await act(async () =>
      app.set({ current: { id: "other-annotation-fixture" }, items: [] }),
    );
    assert.equal(
      view.root.findAllByProps({ "aria-label": "注释内容" }).length,
      0,
    );
    await act(async () => app.set({ current: thread, items }));
    assert.equal(field().props.value, "切换对话时保留");
    await act(async () =>
      view.root.findByProps({ "aria-label": "取消注释" }).props.onClick(),
    );
    assert.equal(
      localStorage.getItem(`cx-annotation-${thread.id}-annotation-reply`),
      null,
    );

    let finish, pendingSend;
    setResponse(({ method }) =>
      method === "turn/start"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { data: [], directories: {} },
    );
    await addSelectedAnnotation();
    await act(async () =>
      field().props.onChange({ target: { value: "发送中的批注" } }),
    );
    await act(async () => {
      pendingSend = view.root
        .findByType("form")
        .props.onSubmit({ preventDefault() {} });
    });
    await act(async () =>
      app.set({ current: { id: "pending-annotation-fixture" }, items: [] }),
    );
    await act(async () => app.set({ current: thread, items }));
    await act(async () =>
      field().props.onChange({ target: { value: "等待期间继续编辑的批注" } }),
    );
    await act(async () => {
      finish({});
      await pendingSend;
    });
    assert.equal(field().props.value, "等待期间继续编辑的批注");
    assert.equal(
      JSON.parse(
        localStorage.getItem(`cx-annotation-${thread.id}-annotation-reply`),
      ).annotation,
      "等待期间继续编辑的批注",
    );
    await act(async () =>
      view.root.findByProps({ "aria-label": "取消注释" }).props.onClick(),
    );

    await act(async () =>
      view.update(
        React.createElement(app.RichText, {
          text: "`" + text + "`\n\n```text\n" + text + "\n```\n\n" + text,
        }),
      ),
    );
    assert.equal(marker().length, 2);
    assert(
      JSON.stringify(view.root.findAllByType("code")[0].children).includes(
        ":codex-annotation",
      ),
    );
    await act(async () => marker()[1].props.onClick());
    assert(JSON.stringify(view.toJSON()).includes("加载包含此注释"));
    console.log(
      "PASS 批注格式、历史卡片、行内引用、流式更新、选区来源、草稿恢复、失败重试、运行中补充和消息草稿保留",
    );
  } finally {
    await act(async () => view?.unmount());
    globalThis.window = previousWindow;
    app.set(original);
  }
}
