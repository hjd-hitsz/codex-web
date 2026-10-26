import test from "node:test";
import assert from "node:assert/strict";
import {
  createThreadOrdering,
  projectGroups,
  sortThreads,
  threadTime,
  threadGroupPath,
  PROJECTLESS_SOURCE,
} from "../src/thread-order.js";

test("完成时间决定对话和项目顺序，打开时间、项目添加顺序与置顶不干扰项目排序", () => {
  const threads = [
    { id: "opened", cwd: "/a", createdAt: 1, updatedAt: 999, completedAt: 10 },
    { id: "done", cwd: "/b", createdAt: 2, updatedAt: 20, completedAt: 20 },
    { id: "pinned", cwd: "/c", createdAt: 3, updatedAt: 30, completedAt: 30 },
    { id: "new", cwd: "/b", createdAt: 15, updatedAt: 888, completedAt: null },
  ];
  assert.deepEqual(
    sortThreads(threads).map((t) => t.id),
    ["pinned", "done", "new", "opened"],
  );
  assert.deepEqual(
    projectGroups(threads, ["/empty", "/a", "/b"], ["pinned"]).map(
      ([path, list]) => [path, list.map((t) => t.id)],
    ),
    [
      ["/c", []],
      ["/b", ["done", "new"]],
      ["/a", ["opened"]],
      ["", []],
      ["/empty", []],
    ],
  );
  assert.equal(threadTime(threads[3]), 15);
  assert.equal(threads[0].id, "opened");
});

test("客户端自动目录合并到未分类，CLI 与外部对话保留实际目录并参与排序", () => {
  const scratch = "/documents/Codex/2026-10-26";
  const threads = [
    { id: "desktop-a", cwd: scratch + "/mu-q", completedAt: 20 },
    { id: "desktop-b", cwd: scratch + "/x", completedAt: 40 },
    { id: "cli", cwd: "/code/x", source: "cli", completedAt: 30 },
    { id: "external", cwd: "/code/mu-q", completedAt: 10 },
    { id: "missing-cwd", completedAt: 5 },
    { id: "pinned", cwd: scratch + "/pin", completedAt: 50 },
  ];
  assert.deepEqual(
    projectGroups(threads, [], ["pinned"], {
      "desktop-a": scratch + "/mu-q",
      "desktop-b": scratch + "/x",
      pinned: scratch + "/pin",
    }).map(([path, list]) => [path, list.map((t) => t.id)]),
    [
      ["", ["desktop-b", "desktop-a", "missing-cwd"]],
      ["/code/x", ["cli"]],
      ["/code/mu-q", ["external"]],
    ],
  );
});

test("明确项目归属、改变后的目录和未被记录的相似目录保持文件夹分组", () => {
  const scratch = "/documents/Codex/2026-10-26";
  const threads = [
    { id: "assigned", cwd: scratch + "/a", projectId: "project", createdAt: 5 },
    { id: "added", cwd: scratch + "/b", createdAt: 4 },
    { id: "moved", cwd: "/code/work", createdAt: 3 },
    { id: "nested", cwd: scratch + "/c/work/repo", createdAt: 2 },
    { id: "lookalike", cwd: scratch + "/d", source: "cli", createdAt: 1 },
  ];
  const directories = {
    assigned: scratch + "/a",
    added: scratch + "/b",
    moved: scratch + "/c",
    nested: scratch + "/c",
  };
  assert.deepEqual(
    projectGroups(threads, [scratch + "/b"], [], directories).map(
      ([path]) => path,
    ),
    [...threads.map((t) => t.cwd), ""],
  );
  assert.deepEqual(projectGroups([], [], [], directories), [["", []]]);
});

test("网页新建的无项目对话通过持久来源和独立目录分组，明确归属继续优先", () => {
  const root = "/custom/codex-web/workspaces";
  const thread = {
    id: "web",
    cwd: root + "/chat-ABC123",
    threadSource: PROJECTLESS_SOURCE,
  };
  assert.equal(threadGroupPath(thread, [], {}, root), "");
  assert.equal(
    threadGroupPath({ ...thread, projectId: "assigned" }, [], {}, root),
    thread.cwd,
  );
  assert.equal(threadGroupPath(thread, [thread.cwd], {}, root), thread.cwd);
  for (const cwd of ["/code/project", thread.cwd + "/repo"]) {
    assert.equal(threadGroupPath({ ...thread, cwd }, [], {}, root), cwd);
  }
  assert.equal(
    threadGroupPath(
      { ...thread, threadSource: null, source: "cli" },
      [],
      {},
      root,
    ),
    thread.cwd,
  );
  assert.equal(threadGroupPath(thread, [], {}, "/different-root"), thread.cwd);
});

test("跨对话页、轮次页读取完成时间，忽略运行中轮次并缓存；刷新元数据保留实际顺序", async () => {
  let updatedAt = 999;
  const requests = [];
  const ordering = createThreadOrdering(async (method, params) => {
    requests.push({ method, params });
    if (method === "thread/list")
      return params.cursor
        ? {
            data: [{ id: "recent", createdAt: 1, updatedAt: 100 }],
            nextCursor: null,
          }
        : {
            data: [{ id: "opened", createdAt: 2, updatedAt }],
            nextCursor: "second",
          };
    assert.equal(params.itemsView, "notLoaded");
    if (params.threadId === "recent")
      return { data: [{ status: "completed", completedAt: 100 }] };
    return params.cursor
      ? {
          data: [
            { status: "completed", completedAt: 10 },
            { status: "failed", completedAt: null },
          ],
        }
      : {
          data: [{ status: "inProgress", completedAt: 1000 }],
          nextCursor: "older",
        };
  });
  assert.deepEqual(
    (await ordering.list({ archived: false })).map((t) => [
      t.id,
      t.completedAt,
    ]),
    [
      ["recent", 100],
      ["opened", 10],
    ],
  );
  assert.equal(
    requests.filter((r) => r.method === "thread/turns/list").length,
    3,
  );
  await ordering.list({ archived: false });
  assert.equal(
    requests.filter((r) => r.method === "thread/turns/list").length,
    3,
  );
  updatedAt++;
  assert.equal((await ordering.list({ archived: false }))[0].id, "recent");
  assert.equal(
    requests.filter((r) => r.method === "thread/turns/list").length,
    5,
  );
  assert(
    requests
      .filter((r) => r.method === "thread/list")
      .every((r) => r.params.sortKey === "created_at"),
  );
  ordering.completed("opened", { status: "completed", completedAt: 200 });
  assert.deepEqual(
    (await ordering.list({ archived: false })).map((t) => t.id),
    ["opened", "recent"],
  );
});

test("读取失败以已有完成时间或创建时间兜底，后续刷新重试", async () => {
  let failed = true;
  const ordering = createThreadOrdering(async () => {
    if (failed) throw new Error("暂时不可读");
    return { data: [{ status: "interrupted", completedAt: 50 }] };
  });
  const thread = { id: "a", createdAt: 5, updatedAt: 999 };
  assert.equal(threadTime((await ordering.hydrate([thread]))[0]), 5);
  failed = false;
  assert.equal(threadTime((await ordering.hydrate([thread]))[0]), 50);
  failed = true;
  assert.equal(
    threadTime((await ordering.hydrate([{ ...thread, updatedAt: 1000 }]))[0]),
    50,
  );
});

test("读取期间收到完成事件时采用后端完成时间，重建读取器仍从历史恢复", async () => {
  let finish;
  const ordering = createThreadOrdering(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = ordering.hydrate([{ id: "a", createdAt: 5, updatedAt: 999 }]);
  ordering.completed("a", { status: "completed", completedAt: 80 });
  finish({ data: [{ status: "completed", completedAt: 20 }] });
  assert.equal((await pending)[0].completedAt, 80);
  const fresh = createThreadOrdering(async () => ({
    data: [{ status: "completed", completedAt: 80 }],
  }));
  assert.equal(
    (await fresh.hydrate([{ id: "a", createdAt: 5, updatedAt: 999 }]))[0]
      .completedAt,
    80,
  );
});
