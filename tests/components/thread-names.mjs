import assert from "node:assert/strict";

export async function testThreadNames(app, setResponse, emit) {
  const original = app.get();
  const thread = {
    id: "title-component-fixture",
    cwd: "/title-fixture",
    createdAt: 1,
    preview: "这是用户发送的一段很长的首条消息",
    name: null,
  };
  let holdList, holdRead;
  setResponse(({ method, params }) => {
    if (method === "thread/name/set") thread.name = params.name;
    if (method === "thread/list")
      return holdList
        ? new Promise((resolve) => holdList(resolve))
        : { data: [{ ...thread }] };
    if (method === "thread/read")
      return holdRead
        ? new Promise((resolve) => holdRead(resolve))
        : { thread: { ...thread } };
    if (method === "thread/resume") return { thread: { ...thread } };
    if (method === "lan/projectless/read") return { directories: {} };
    return { data: [] };
  });
  try {
    app.set({
      connected: true,
      threads: [thread],
      current: thread,
      archived: false,
      search: "",
      active: {},
      projectOrder: [thread.cwd],
    });
    assert.equal(app.titleOf(thread), thread.preview);
    let finish;
    holdList = (resolve) => (finish = resolve);
    const listing = app.loadThreads();
    await emit("thread/name/updated", {
      threadId: thread.id,
      threadName: "修复对话自动命名",
    });
    assert.equal(app.titleOf(app.get().current), "修复对话自动命名");
    finish({ data: [{ ...thread }] });
    await listing;
    assert.equal(app.titleOf(app.get().threads[0]), "修复对话自动命名");
    assert.equal(app.titleOf(app.get().current), "修复对话自动命名");
    holdList = null;

    holdRead = (resolve) => (finish = resolve);
    const opening = app.openThread(thread.id);
    await emit("thread/name/updated", {
      threadId: thread.id,
      threadName: "更新后的标题",
    });
    finish({ thread: { ...thread } });
    await opening;
    assert.equal(app.titleOf(app.get().current), "更新后的标题");
    assert.equal(app.titleOf(app.get().threads[0]), "更新后的标题");
    holdRead = null;

    thread.name = "在另一端保存的标题";
    await app.loadThreads();
    assert.equal(app.titleOf(app.get().current), thread.name);
    await app.rename(thread, "网页手动标题");
    assert.equal(app.titleOf(app.get().current), "网页手动标题");
    await emit("thread/name/updated", {
      threadId: "another-title-fixture",
      threadName: "其他聊天的标题",
    });
    assert.equal(app.titleOf(app.get().current), "网页手动标题");
    assert.equal(app.titleOf({ name: "  ", preview: "消息预览" }), "消息预览");
  } finally {
    app.newChat();
    app.set(original);
  }
}
