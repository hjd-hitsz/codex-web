import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testMessageNavigation(app) {
  const original = app.get();
  const originalObserver = globalThis.ResizeObserver;
  const originalFrame = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map();
  const scrollListeners = new Map();
  const documentListeners = new Map();
  let sequence = 0;
  let observers = 0;
  let disconnected = 0;
  let bottomCalls = 0;
  let position = 0;
  let focused;
  let view;
  const items = Array.from({ length: 18 }, (_, index) => ({
    id: `navigation-user-${index}`,
    type: "userMessage",
    turnId: `navigation-turn-${index}`,
    content: [{ type: "text", text: `第 ${index + 1} 条请求` }],
  }));
  const scroller = {
    scrollHeight: 18000,
    clientHeight: 600,
    get scrollTop() {
      return position;
    },
    set scrollTop(top) {
      position = Math.max(
        0,
        Math.min(top, this.scrollHeight - this.clientHeight),
      );
      bottomCalls++;
      scrollListeners.get("scroll")?.();
    },
    firstElementChild: {},
    getBoundingClientRect: () => ({ top: 50 }),
    querySelectorAll: () =>
      app
        .get()
        .items.filter((item) => item.type === "userMessage")
        .map((item, index) => ({
          dataset: { messageId: item.id },
          getBoundingClientRect: () => ({
            top: 70 + index * 1000 - scroller.scrollTop,
          }),
          focus: (options) => {
            focused = { id: item.id, options };
          },
        })),
    addEventListener: (name, callback) => scrollListeners.set(name, callback),
    removeEventListener: (name) => scrollListeners.delete(name),
    scrollTo: ({ top }) => {
      scroller.scrollTop = top;
      scrollListeners.get("scroll")?.();
    },
  };
  const root = {
    contains: (target) => target === "inside",
    ownerDocument: {
      addEventListener: (name, callback) =>
        documentListeners.set(name, callback),
      removeEventListener: (name) => documentListeners.delete(name),
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers++;
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  };
  const flush = () =>
    act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    });
  const trigger = () => view.root.findByProps({ "aria-label": "对话目录" });
  const open = () => act(async () => trigger().props.onClick());
  const entryButtons = () =>
    view.root
      .findByProps({ className: "conversation-navigation-entries" })
      .findAllByType("button");
  const currentEntry = () =>
    entryButtons().find(
      (button) => button.props["aria-current"] === "location",
    );
  try {
    app.set({
      current: { id: "navigation-fixture" },
      items,
      loading: false,
      active: {},
      questions: [],
      plans: {},
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation), {
        createNodeMock: ({ props }) => {
          if (props.className === "conversation") return scroller;
          if (props.className === "conversation-navigation") return root;
          if (props.className === "conversation-navigation-entries")
            return { querySelector: () => null };
          if (props["aria-label"] === "对话目录")
            return {
              focus: () => {
                focused = "trigger";
              },
            };
          return {};
        },
      });
    });
    await flush();
    await open();
    assert.equal(entryButtons().length, 18);
    assert.equal(currentEntry().props.title, "第 18 条请求");
    assert.equal(
      view.root.findByProps({ className: "conversation-navigation-marks" })
        .children.length,
      12,
    );
    await act(async () => entryButtons()[2].props.onClick());
    await flush();
    assert.equal(scroller.scrollTop, 2000);
    assert.deepEqual(focused, {
      id: "navigation-user-2",
      options: { preventScroll: true },
    });
    assert.equal(trigger().props["aria-expanded"], false);
    assert.equal(view.root.findAllByProps({ title: "回到最新消息" }).length, 1);
    const beforeStream = bottomCalls;
    const beforeObservers = observers;
    await act(async () =>
      app.set({
        items: [
          ...items,
          {
            id: "stream",
            type: "agentMessage",
            phase: "commentary",
            text: "继续处理",
            turnId: "navigation-turn-17",
          },
        ],
      }),
    );
    assert.equal(bottomCalls, beforeStream, "浏览旧消息时流式更新保持阅读位置");
    assert.equal(observers, beforeObservers, "流式正文更新复用滚动监听");
    await open();
    assert.equal(currentEntry().props.title, "第 3 条请求");
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "搜索对话消息" })
        .props.onChange({ target: { value: "18" } }),
    );
    assert.deepEqual(
      entryButtons().map((button) => button.props.title),
      ["第 18 条请求"],
    );
    await act(async () =>
      view.root
        .findByProps({ "aria-label": "搜索对话消息" })
        .props.onChange({ target: { value: "没有这个问题" } }),
    );
    assert.equal(entryButtons().length, 0);
    assert(JSON.stringify(view.toJSON()).includes("没有匹配的消息"));
    await act(async () =>
      view.root
        .findByType("nav")
        .props.onKeyDown({ key: "Escape", stopPropagation() {} }),
    );
    assert.equal(focused, "trigger");
    assert.equal(documentListeners.size, 0);
    await open();
    assert.equal(entryButtons().length, 18);
    await act(async () =>
      documentListeners.get("pointerdown")({ target: "outside" }),
    );
    assert.equal(trigger().props["aria-expanded"], false);
    scroller.scrollTop = 9000;
    await act(async () => {
      scrollListeners.get("scroll")();
      scrollListeners.get("scroll")();
      view.root.findByProps({ className: "conversation" }).props.onScroll();
    });
    assert.equal(frames.size, 1, "同一帧的滚动事件合并更新");
    await flush();
    await open();
    assert.equal(currentEntry().props.title, "第 10 条请求");
    await act(async () =>
      app.set({
        items: [
          ...items,
          {
            ...items[0],
            id: "new-message",
            content: [{ type: "text", text: "新增补充" }],
          },
        ],
      }),
    );
    assert.equal(entryButtons().length, 19);
    scrollListeners.get("scroll")();
    await act(async () =>
      app.set({ current: { id: "navigation-other" }, items: [items[0]] }),
    );
    assert.equal(trigger().props["aria-expanded"], false);
    assert.equal(documentListeners.size, 0);
    await flush();
    await act(async () => app.set({ items: [] }));
    assert.equal(view.root.findAllByType("nav").length, 0);
    assert.equal(scrollListeners.size, 0);
    assert.equal(frames.size, 0);
    await act(async () => view.unmount());
    view = null;
    assert.equal(disconnected, observers);
  } finally {
    if (view) await act(async () => view.unmount());
    app.set(original);
    globalThis.ResizeObserver = originalObserver;
    globalThis.requestAnimationFrame = originalFrame;
    globalThis.cancelAnimationFrame = originalCancel;
  }
  console.log(
    "PASS 消息目录跳转、搜索、滚动高亮、流式更新保持位置、目录长度受控、关闭焦点与对话隔离和清理",
  );
}
