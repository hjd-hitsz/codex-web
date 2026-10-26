import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
globalThis.location = { protocol: "http:", host: "component-test" };
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.testTerminals = [];
const requests = [];
let socket;
let responseFor = (m) =>
  m.method === "thread/list" ? { data: [], nextCursor: null } : {};
globalThis.WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  constructor() {
    socket = this;
  }
  send(raw) {
    const m = JSON.parse(raw);
    requests.push(m);
    if (m.method === "command/exec") return;
    const result = responseFor(m);
    queueMicrotask(() =>
      this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
    );
  }
  emit(method, params) {
    this.onmessage({ data: JSON.stringify({ method, params }) });
  }
};
localStorage.setItem(
  "cx-summary-zh-v1",
  JSON.stringify([["Identifying Git Branches", "识别 Git 分支"]]),
);
const app = await import(
  pathToFileURL(process.env.CODEX_COMPONENT_BUNDLE).href
);
let versionView;
await act(async () => {
  versionView = create(React.createElement(app.VersionDetails));
});
assert(
  JSON.stringify(versionView.toJSON()).includes("1.2.3+dev.gabc1234.dirty"),
);
assert(JSON.stringify(versionView.toJSON()).includes("等待连接"));
await act(async () => {
  app.set({
    serverVersion: {
      version: "1.2.2",
      displayVersion: "1.2.2",
      revision: "def123456789",
      dirty: false,
      channel: "release",
      builtAt: null,
    },
  });
});
const versionText = JSON.stringify(versionView.toJSON());
assert(versionText.includes("正式发布"));
assert(versionText.includes("def123456789"));
assert(versionText.includes("含未提交修改"));
assert(versionText.includes("1.2.3+dev.gabc1234.dirty"));
await act(async () => versionView.unmount());
console.log("PASS 网页和桥接独立版本、构建来源与未连接状态");
app.set({
  connected: true,
  current: { id: "fixture" },
  items: [
    { id: "empty", type: "reasoning", summary: [] },
    {
      id: "title",
      type: "reasoning",
      summary: ["**Identifying Git Branches**"],
    },
    {
      id: "body",
      type: "reasoning",
      summary: ["**验证修改结果**\n\n这里是摘要正文。"],
    },
    {
      id: "progress",
      type: "agentMessage",
      phase: "commentary",
      text: "这是进度内容，默认折叠。",
    },
    {
      id: "answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "最终回答保持展开。",
    },
  ],
});
let view;
await act(async () => {
  view = create(React.createElement(app.Conversation));
});
const tree = view.root;
const group = tree.findByProps({ className: "process-group" });
assert.equal(group.props.open, undefined);
assert.equal(
  tree.findAll((n) => n.props.className === "activity reasoning-summary")
    .length,
  0,
);
assert(!JSON.stringify(view.toJSON()).includes("这是进度内容"));
assert(JSON.stringify(view.toJSON()).includes("最终回答保持展开"));
await act(async () => group.props.onToggle({ currentTarget: { open: true } }));
assert.equal(
  tree.findAll((n) => n.props.className === "activity reasoning-summary")
    .length,
  2,
);
assert.equal(
  tree
    .findByProps({ className: "activity-summary reasoning-title" })
    .findAllByType("button").length,
  0,
);
assert(JSON.stringify(view.toJSON()).includes("识别 Git 分支"));
const detail = tree
  .findAllByType("details")
  .find((n) => n.props.className === "activity reasoning-summary");
assert.equal(detail.props.open, undefined);
assert.equal(detail.findByType("summary").props.title, "验证修改结果");
assert(JSON.stringify(view.toJSON()).includes("这是进度内容"));
await act(async () => group.props.onToggle({ currentTarget: { open: false } }));
assert(!JSON.stringify(view.toJSON()).includes("这是进度内容"));
assert(JSON.stringify(view.toJSON()).includes("最终回答保持展开"));
await act(async () => view.unmount());
console.log(
  "PASS 工作过程整体折叠及展开、最终回答独立、中文摘要标题、空摘要隐藏、标题无展开",
);
app.set({ draft: "键盘发送验证", items: [] });
await act(async () => {
  view = create(React.createElement(app.Composer));
});
const event = (extra) => ({
  key: "Enter",
  nativeEvent: { isComposing: false },
  preventDefault() {
    this.prevented = true;
  },
  ...extra,
});
assert.equal(
  view.root.findAll((n) => n.props["aria-label"] === "执行权限").length,
  0,
);
const input = view.root.findByType("textarea");
const enter = event({});
await act(async () => input.props.onKeyDown(enter));
assert(!enter.prevented);
assert(!requests.some((r) => r.method === "turn/start"));
const composing = event({ ctrlKey: true, nativeEvent: { isComposing: true } });
await act(async () => input.props.onKeyDown(composing));
assert(!requests.some((r) => r.method === "turn/start"));
await act(async () => input.props.onKeyDown(event({ ctrlKey: true })));
assert.equal(requests.filter((r) => r.method === "turn/start").length, 1);
assert.equal(
  requests.find((r) => r.method === "turn/start").params.approvalPolicy,
  "never",
);
assert.deepEqual(
  requests.find((r) => r.method === "turn/start").params.sandboxPolicy,
  { type: "dangerFullAccess" },
);
await act(async () => view.unmount());
console.log("PASS Enter 保留换行、中文输入确认不发送、Ctrl+Enter 发送一次");
app.set({ terminalOpen: true });
await act(async () => {
  view = create(React.createElement(app.TerminalPanel), {
    createNodeMock: () => ({}),
  });
});
const first = localStorage.getItem("cx-terminal");
assert(first);
assert.deepEqual(
  requests.find((r) => r.method === "command/exec").params.sandboxPolicy,
  { type: "dangerFullAccess" },
);
assert.equal(testTerminals.at(-1).options.theme.background, "#ffffff");
await act(async () => testTerminals.at(-1).input("\x04"));
assert.equal(
  Buffer.from(
    requests.findLast((r) => r.method === "command/exec/write").params
      .deltaBase64,
    "base64",
  ).toString(),
  "\x04",
);
await act(async () =>
  socket.emit("lan/terminalExit", { processId: first, exitCode: 0 }),
);
assert.equal(app.get().terminalOpen, false);
assert.equal(localStorage.getItem("cx-terminal"), null);
await act(async () => view.unmount());
app.set({ terminalOpen: true });
await act(async () => {
  view = create(React.createElement(app.TerminalPanel), {
    createNodeMock: () => ({}),
  });
});
assert.notEqual(localStorage.getItem("cx-terminal"), first);
await act(async () => view.unmount());
console.log(
  "PASS 白底终端、Ctrl+D 传递、退出自动折叠及清理、重新打开创建新终端",
);

const history = Array.from({ length: 65 }, (_, i) => ({
  id: `sort-${i}`,
  cwd: `/project-${i % 2}`,
  createdAt: 100 - i,
  updatedAt: 100 - i,
}));
const completions = new Map(history.map((thread, i) => [thread.id, i + 200]));
responseFor = ({ method, params }) => {
  if (method === "thread/list")
    return {
      data: params.cursor ? history.slice(60) : history.slice(0, 60),
      nextCursor: params.cursor ? null : "page-two",
    };
  if (method === "thread/turns/list")
    return {
      data: [
        {
          id: "turn",
          status: "completed",
          completedAt: completions.get(params.threadId),
        },
      ],
      nextCursor: null,
    };
  if (method === "thread/resume") {
    const thread = history.find((t) => t.id === params.threadId);
    thread.updatedAt = 9999;
    return { thread: { ...thread }, cwd: thread.cwd };
  }
  if (method === "thread/items/list") return { data: [], nextCursor: null };
  return {};
};
app.set({
  current: null,
  threads: [],
  active: {},
  archived: false,
  search: "",
});
await app.loadThreads();
assert.equal(app.get().threads.length, 60);
assert.equal(app.get().threads[0].id, "sort-64");
assert.equal(app.get().threadCursor, "60");
await app.loadThreads(true);
assert.equal(app.get().threads.length, 65);
assert.equal(app.get().threadCursor, null);
await app.openThread("sort-0");
assert.equal(app.get().current.completedAt, 200);
await app.loadThreads();
assert.equal(app.get().threads[0].id, "sort-64");
assert.equal(app.get().threads.at(-1).id, "sort-0");
completions.set("sort-0", 500);
await act(async () =>
  socket.emit("turn/completed", {
    threadId: "sort-0",
    turn: { id: "new-turn", status: "completed", completedAt: 500 },
  }),
);
assert.equal(app.get().threads[0].id, "sort-0");
assert.equal(app.get().current.completedAt, 500);
assert.equal(
  (await app.listThreads({ archived: true, searchTerm: "排序" }))[0].id,
  "sort-0",
);
assert(
  requests.some(
    (r) =>
      r.method === "thread/list" &&
      r.params.archived &&
      r.params.searchTerm === "排序",
  ),
);
console.log(
  "PASS 完成时间全局排序、分页、打开旧对话顺序稳定、完成事件重排与搜索排序",
);
