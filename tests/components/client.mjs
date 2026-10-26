import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { setTimeout as delay } from "node:timers/promises";
import {
  PROJECTLESS_SOURCE,
  projectGroups,
} from "../../client/src/thread-order.js";
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
    if (!m.method || m.method === "command/exec") return;
    const result = responseFor(m);
    queueMicrotask(() =>
      this.onmessage({
        data: JSON.stringify({
          id: m.id,
          ...(result.error ? { error: result.error } : { result }),
        }),
      }),
    );
  }
  emit(method, params, id) {
    return this.onmessage({ data: JSON.stringify({ method, params, id }) });
  }
};
localStorage.setItem(
  "cx-summary-zh-v1",
  JSON.stringify([["Identifying Git Branches", "识别 Git 分支"]]),
);
const app = await import(
  pathToFileURL(process.env.CODEX_COMPONENT_BUNDLE).href
);
let projectView;
app.set({ defaultCwd: "/default", cwd: "/previous-project" });
await act(async () => {
  projectView = create(
    React.createElement(app.ProjectGroup, { path: "" }, "无项目对话"),
  );
});
assert(JSON.stringify(projectView.toJSON()).includes("未分类"));
assert(JSON.stringify(projectView.toJSON()).includes("无项目对话"));
assert.equal(projectView.root.findAllByType("button").length, 2);
await act(async () =>
  projectView.root
    .findByProps({ title: "在 未分类 中新建对话" })
    .props.onClick(),
);
assert.equal(app.get().projectless, true);
assert.equal(app.get().cwd, "/default");
assert.equal(app.get().current, null);
assert.equal(
  requests.filter((r) => r.method === "lan/projectless/prepare").length,
  0,
);
await act(async () =>
  projectView.root.findByProps({ title: "未指定项目的对话" }).props.onClick(),
);
assert(!JSON.stringify(projectView.toJSON()).includes("无项目对话"));
await act(async () => projectView.unmount());
await act(async () => {
  projectView = create(
    React.createElement(app.ProjectGroup, { path: "/code/x" }, "项目对话"),
  );
});
assert.equal(projectView.root.findAllByType("button").length, 2);
await act(async () =>
  projectView.root.findByProps({ title: "在 x 中新建对话" }).props.onClick(),
);
assert.equal(app.get().cwd, "/code/x");
assert.equal(app.get().projectless, false);
await act(async () => projectView.unmount());
console.log("PASS 未分类分组展示与折叠、实际项目目录和新建对话入口");

{
  const root = "/codex/codex-web/workspaces";
  const thread = {
    id: "new-projectless",
    cwd: root + "/chat-ABC123",
    threadSource: PROJECTLESS_SOURCE,
    createdAt: 1,
    updatedAt: 1,
  };
  let prepareFails = true,
    startFails = true,
    preparations = 0;
  responseFor = ({ method }) => {
    if (method === "lan/projectless/prepare") {
      preparations++;
      return prepareFails
        ? { error: { message: "目录不可写" } }
        : { cwd: thread.cwd, root };
    }
    if (method === "thread/start")
      return startFails ? { error: { message: "创建暂时失败" } } : { thread };
    if (method === "thread/resume") return { thread, cwd: thread.cwd };
    if (method === "thread/list") return { data: [thread] };
    if (method === "thread/turns/list" || method === "thread/items/list")
      return { data: [] };
    if (method === "lan/projectless/read") return { directories: {} };
    if (method === "turn/start")
      return { turn: { id: "projectless-turn", status: "inProgress" } };
    return {};
  };
  app.set({
    connected: true,
    model: "fixture-model",
    projects: [],
    threads: [],
    archived: false,
    search: "",
    active: {},
  });
  app.newChat("");
  app.setDraft("创建无项目对话");
  const startCount = requests.filter((r) => r.method === "thread/start").length;
  assert.equal(await app.sendMessage(), false);
  assert.equal(
    requests.filter((r) => r.method === "thread/start").length,
    startCount,
  );
  assert.equal(app.get().draft, "创建无项目对话");
  prepareFails = false;
  assert.equal(await app.sendMessage(), false);
  assert.equal(app.get().projectlessCwd, thread.cwd);
  startFails = false;
  assert.equal(await app.sendMessage(), true);
  assert.equal(preparations, 2);
  const start = requests.findLast((r) => r.method === "thread/start");
  assert.equal(start.params.cwd, thread.cwd);
  assert.equal(start.params.threadSource, PROJECTLESS_SOURCE);
  assert.equal(start.params.approvalPolicy, "never");
  assert.equal(start.params.sandbox, "danger-full-access");
  assert.equal(app.get().cwd, thread.cwd);
  await app.loadThreads();
  app.set({ current: null, projectless: false });
  await app.openThread(thread.id);
  assert.equal(app.get().projectless, true);
  assert.equal(
    projectGroups(
      app.get().threads,
      [],
      [],
      app.get().projectlessDirectories,
      root,
    )[0][0],
    "",
  );
  app.newChat();
  assert.equal(app.get().projectless, true);
  assert.equal(app.get().projectlessCwd, null);
  app.newChat("/code/x");
  app.set({ threads: [], active: {}, error: "", model: "" });
  responseFor = (m) => (m.method === "thread/list" ? { data: [] } : {});
  requests.length = 0;
  console.log(
    "PASS 未分类新建的独立目录、失败重试与草稿保留、统一权限、重新加载归类及新建上下文",
  );
}
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
{
  const originalFetch = globalThis.fetch;
  const batches = [];
  const requestCount = requests.length;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://transmart.qq.com/api/imt");
    const texts = JSON.parse(options.body).source.text_list;
    batches.push(texts);
    return new Response(
      JSON.stringify({
        header: { ret_code: "succ" },
        auto_translation: texts.map((text) =>
          text === "Reviewing local configuration"
            ? "检查本地配置"
            : "检查应用设置",
        ),
      }),
    );
  };
  app.set({
    items: [
      {
        id: "machine-translation",
        type: "reasoning",
        summary: [
          "Reviewing local configuration\nInspecting application settings",
        ],
      },
    ],
  });
  await act(async () => {
    view = create(React.createElement(app.Conversation));
  });
  await act(async () =>
    view.root
      .findByProps({ className: "process-group" })
      .props.onToggle({ currentTarget: { open: true } }),
  );
  await act(async () => delay(1400));
  assert.deepEqual(batches, [["Reviewing local configuration"]]);
  assert(JSON.stringify(view.toJSON()).includes("检查本地配置"));
  await act(async () =>
    view.root
      .findByProps({ className: "activity reasoning-summary" })
      .props.onToggle({ currentTarget: { open: true } }),
  );
  await act(async () => delay(1400));
  assert.deepEqual(batches, [
    ["Reviewing local configuration"],
    ["Inspecting application settings"],
  ]);
  assert(JSON.stringify(view.toJSON()).includes("检查应用设置"));
  assert.equal(requests.length, requestCount);
  await act(async () => view.unmount());
  globalThis.fetch = originalFetch;
  console.log("PASS 思考标题与正文按需调用机器翻译，翻译过程不发送 Codex 请求");
}
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
let projectlessDirectories = { "sort-0": "/project-0" };
let projectlessUnavailable = false;
responseFor = ({ method, params }) => {
  if (method === "lan/projectless/read")
    return projectlessUnavailable
      ? { error: { message: "分组元数据暂不可用" } }
      : { directories: projectlessDirectories };
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
assert.deepEqual(app.get().projectlessDirectories, projectlessDirectories);
assert.equal(app.get().threads.length, 60);
assert.equal(app.get().threads[0].id, "sort-64");
assert.equal(app.get().threadCursor, "60");
await app.loadThreads(true);
assert.equal(app.get().threads.length, 65);
assert.equal(app.get().threadCursor, null);
await app.openThread("sort-0");
assert.equal(app.get().current.completedAt, 200);
projectlessDirectories = {};
await app.loadThreads();
assert.deepEqual(app.get().projectlessDirectories, {});
projectlessUnavailable = true;
await app.loadThreads();
assert.deepEqual(app.get().projectlessDirectories, {});
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

{
  responseFor = (m) =>
    m.method === "thread/list" ? { data: [], nextCursor: null } : {};
  const question = {
    id: "deployment",
    header: "部署方式",
    question: "希望怎样部署？",
    isOther: true,
    isSecret: false,
    options: [
      { label: "源码", description: "在本机构建。" },
      { label: "npm", description: "安装预构建包。" },
    ],
  };
  const request = {
    id: "input-fixture",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "questions",
      turnId: "question-turn",
      itemId: "question-item",
      isBlocking: true,
      autoResolutionMs: null,
      questions: [
        question,
        {
          id: "details",
          header: "补充说明",
          question: "还有哪些要求？",
          options: null,
        },
      ],
    },
  };
  const submitEvent = () => ({ preventDefault() {} });
  const showRequest = async (next = request, extra = {}) => {
    await act(async () => {
      app.set({
        connected: true,
        current: { id: "questions" },
        items: [],
        questions: [next],
        active: {},
        busy: false,
        error: "",
        ...extra,
      });
      view = create(React.createElement(app.Conversation));
    });
  };
  await showRequest(request, {
    questions: [
      request,
      {
        ...request,
        id: "other-thread",
        params: { ...request.params, threadId: "other" },
      },
    ],
  });
  assert.equal(view.root.findAllByType("form").length, 1);
  assert.equal(view.root.findByProps({ type: "submit" }).props.disabled, true);
  const firstGroup = view.root.findAllByType("fieldset")[0];
  await act(async () => firstGroup.findAllByType("input")[1].props.onChange());
  const details = view.root.findByType("textarea");
  await act(async () =>
    details.props.onChange({ target: { value: "第一行\n第二行" } }),
  );
  assert.equal(view.root.findByProps({ type: "submit" }).props.disabled, false);
  const form = view.root.findByType("form");
  const plainEnter = event({ target: { tagName: "TEXTAREA" } });
  await act(async () => form.props.onKeyDown(plainEnter));
  assert(!plainEnter.prevented);
  const composing = event({
    ctrlKey: true,
    nativeEvent: { isComposing: true },
  });
  await act(async () => form.props.onKeyDown(composing));
  assert(!requests.some((m) => m.id === request.id));
  await act(async () => form.props.onKeyDown(event({ ctrlKey: true })));
  assert.deepEqual(
    requests.find((m) => m.id === request.id),
    {
      id: request.id,
      result: {
        answers: {
          deployment: { answers: ["npm"] },
          details: { answers: ["第一行\n第二行"] },
        },
      },
    },
  );
  assert.equal(app.get().questions.length, 1);
  assert.equal(app.get().questions[0].id, "other-thread");
  await act(async () => assert.equal(app.respond(request, {}), false));
  assert.equal(requests.filter((m) => m.id === request.id).length, 1);
  await act(async () => view.unmount());
  console.log(
    "PASS 同步提问按对话显示、多问题校验、选项和多行回答、输入法与提交快捷键、重复提交保护",
  );

  const single = {
    ...request,
    params: { ...request.params, questions: [question], isBlocking: false },
  };
  await showRequest(single);
  assert.equal(view.root.findAllByType("input")[0].props.checked, true);
  await act(async () => view.root.findAllByType("input")[2].props.onChange());
  assert.equal(view.root.findByProps({ type: "submit" }).props.disabled, true);
  await act(async () =>
    view.root
      .findByType("textarea")
      .props.onChange({ target: { value: "容器\n部署" } }),
  );
  await act(async () => view.root.findAllByType("input")[1].props.onChange());
  assert.equal(view.root.findAllByType("textarea").length, 0);
  await act(async () => view.root.findAllByType("input")[2].props.onChange());
  assert.equal(view.root.findByType("textarea").props.value, "容器\n部署");
  await act(async () => app.set({ connected: false }));
  assert.equal(view.root.findByProps({ type: "submit" }).props.disabled, true);
  await act(async () => assert.equal(app.respond(single, {}), false));
  assert.equal(app.get().questions.length, 1);
  await act(async () => {
    app.set({ connected: true });
    socket.readyState = 3;
  });
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  assert.equal(app.get().questions.length, 1);
  assert.equal(view.root.findByType("textarea").props.value, "容器\n部署");
  assert(view.root.findByProps({ role: "alert" }));
  socket.readyState = 1;
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  assert.deepEqual(requests.findLast((m) => m.id === request.id).result, {
    answers: { deployment: { answers: ["容器\n部署"] } },
  });
  await act(async () => view.unmount());
  console.log("PASS 非阻塞提问预选、其他回答独立保存、断线保留回答及重试");

  await showRequest({
    ...single,
    params: {
      ...single.params,
      isBlocking: true,
      questions: [
        { ...question, isOther: false },
        {
          id: "secret",
          header: "私密信息",
          question: "请输入私密值",
          isSecret: true,
          options: null,
        },
      ],
    },
  });
  assert.equal(view.root.findAllByProps({ type: "radio" }).length, 2);
  assert.equal(
    view.root.findByProps({ type: "password" }).props.autoComplete,
    "off",
  );
  await act(async () => view.unmount());
  console.log("PASS 自定义回答开关和私密输入字段");

  await showRequest(single, {
    questions: [single, { ...single, id: "second-request" }],
  });
  const names = view.root
    .findAllByProps({ type: "radio" })
    .map((node) => node.props.name);
  assert.notEqual(names[0], names[3]);
  await act(async () =>
    socket.emit("item/tool/requestUserInput", single.params, 37),
  );
  await act(async () =>
    socket.emit("item/tool/requestUserInput", single.params, "37"),
  );
  assert.equal(
    app.get().questions.filter((question) => String(question.id) === "37")
      .length,
    1,
  );
  await act(async () =>
    socket.emit("serverRequest/resolved", { requestId: 37 }),
  );
  assert.equal(app.get().questions.length, 2);
  await act(async () =>
    socket.emit("lan/state", {
      ready: true,
      activeTurns: {},
      questions: [single],
      terminals: {},
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 1);
  assert.equal(view.root.findAllByType("input")[0].props.checked, true);
  await act(async () =>
    socket.emit("serverRequest/resolved", {
      threadId: "questions",
      requestId: request.id,
    }),
  );
  assert.equal(app.get().questions.length, 0);
  await act(async () =>
    socket.emit("item/tool/requestUserInput", single.params, "second-request"),
  );
  await act(async () =>
    socket.emit("lan/questionResolved", { id: "second-request" }),
  );
  assert.equal(view.root.findAllByType("form").length, 0);
  await act(async () => view.unmount());
  console.log(
    "PASS 多张问题卡片的单选组隔离、请求 ID 去重、重连恢复、后端清理和跨页面解决通知",
  );

  const asyncItem = {
    id: "async-question",
    type: "agentMessage",
    turnId: "async-turn",
    phase: "commentary",
    text: "",
    questions: [
      { title: "选择运行方式", options: ["源码", "npm"] },
      { title: "补充部署要求", options: null },
    ],
  };
  await showRequest(single, {
    questions: [],
    items: [asyncItem],
    active: { questions: "async-turn" },
    draft: "尚未发送的草稿",
    attachments: [{ id: "draft-file" }],
  });
  assert.equal(view.root.findAllByType("form").length, 1);
  await act(async () =>
    socket.emit("item/completed", {
      threadId: "questions",
      turnId: "async-turn",
      item: {
        id: "continued",
        type: "agentMessage",
        phase: "commentary",
        text: "继续处理中",
      },
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 1);
  await act(async () =>
    view.root
      .findByType("textarea")
      .props.onChange({ target: { value: "保留配置" } }),
  );
  responseFor = (m) => {
    if (m.method === "turn/steer")
      return { error: { code: -32000, message: "模拟发送失败" } };
    return m.method === "thread/list" ? { data: [], nextCursor: null } : {};
  };
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  assert(view.root.findByProps({ role: "alert" }));
  assert.equal(view.root.findByType("textarea").props.value, "保留配置");
  assert.equal(
    app.get().items.some((item) => item.optimistic),
    false,
  );
  responseFor = (m) =>
    m.method === "thread/list" ? { data: [], nextCursor: null } : {};
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  const steer = requests.findLast((m) => m.method === "turn/steer");
  assert.equal(steer.params.expectedTurnId, "async-turn");
  assert.equal(
    steer.params.input[0].text,
    "选择运行方式\n回答：源码\n\n补充部署要求\n回答：保留配置",
  );
  assert.equal(app.get().draft, "尚未发送的草稿");
  assert.deepEqual(app.get().attachments, [{ id: "draft-file" }]);
  assert(JSON.stringify(view.toJSON()).includes("回答已发送"));
  await act(async () =>
    socket.emit("item/completed", {
      threadId: "questions",
      turnId: "async-turn",
      item: {
        id: "async-answer",
        type: "userMessage",
        content: steer.params.input,
      },
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 0);
  assert(JSON.stringify(view.toJSON()).includes("选择运行方式"));
  await act(async () => view.unmount());
  console.log(
    "PASS 空正文异步提问展开、后续进度保留卡片、失败重试、运行中补充、草稿和附件保留、历史回显",
  );

  await showRequest(single, { questions: [], items: [asyncItem], active: {} });
  await act(async () =>
    view.root
      .findByType("textarea")
      .props.onChange({ target: { value: "全部结束后提交" } }),
  );
  await act(async () =>
    view.root.findByType("form").props.onSubmit(submitEvent()),
  );
  assert.equal(
    requests.findLast((m) => m.method === "turn/start").params.input[0].text,
    "选择运行方式\n回答：源码\n\n补充部署要求\n回答：全部结束后提交",
  );
  await act(async () => view.unmount());
  console.log("PASS 异步提问在轮次结束后通过新轮次提交回答");

  await showRequest(single, {
    questions: [],
    items: [
      asyncItem,
      {
        ...asyncItem,
        id: "another-async-question",
        questions: [{ title: "选择配置保留策略", options: ["保留", "覆盖"] }],
      },
    ],
    active: {},
  });
  assert.equal(view.root.findAllByType("form").length, 2);
  await act(async () =>
    socket.emit("item/completed", {
      threadId: "questions",
      turnId: "async-turn",
      item: {
        id: "unrelated-input",
        type: "userMessage",
        content: [{ type: "text", text: "请继续检查其他模块。" }],
      },
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 2);
  await act(async () =>
    view.root.findByType("textarea").props.onChange({
      target: { value: "单独回答第一张卡片" },
    }),
  );
  await act(async () =>
    view.root.findAllByType("form")[0].props.onSubmit(submitEvent()),
  );
  const input = requests.findLast((message) => message.method === "turn/start")
    .params.input;
  await act(async () =>
    socket.emit("item/completed", {
      threadId: "questions",
      turnId: "async-turn",
      item: { id: "first-card-answer", type: "userMessage", content: input },
    }),
  );
  assert.equal(view.root.findAllByType("form").length, 1);
  assert(
    view.root
      .findByType("form")
      .findAllByType("p")
      .some((node) => node.props.children === "选择配置保留策略"),
  );
  await act(async () => view.unmount());
  await act(async () => {
    view = create(React.createElement(app.Conversation));
  });
  assert.equal(view.root.findAllByType("form").length, 1);
  await act(async () => view.unmount());
  console.log("PASS 多批异步提问独立回答，其他问题和普通补充消息保留待答卡片");
}
