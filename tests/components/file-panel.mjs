import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testFilePanel(app, requests, setResponse) {
  const original = app.get();
  const previousWindow = globalThis.window;
  const listeners = new Map();
  let discard = false;
  globalThis.window = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
    confirm: () => discard,
  };
  const documentPath = "/file-fixture/docs/README.MD";
  const markdown = [
    "# 文件预览",
    "",
    "**重点**与 *强调*。",
    "",
    "- 列表项目",
    "- [x] 已完成",
    "",
    "| 名称 | 状态 |",
    "| --- | --- |",
    "| 预览 | 完成 |",
    "",
    "```js",
    'const message = "hello";',
    "```",
    "",
    "$x^2$",
    "",
    "[源代码](../src/main.mjs:12:3)",
    "",
    "![相对图片](./images/chart.png)",
    "",
    '<script>alert("blocked")</script>',
  ].join("\n");
  const files = new Map([
    [documentPath, markdown],
    ["/file-fixture/src/main.mjs", 'export const message = "hello";'],
    ["/file-fixture/notes.markdown", "# 另一份文档"],
  ]);
  setResponse(({ method, params }) => {
    if (method === "fs/readDirectory") return { entries: [] };
    if (method === "fs/readFile")
      return {
        dataBase64: app.b64encode(files.get(params.path) || "图片数据"),
      };
    if (method === "fs/writeFile") {
      files.set(params.path, app.b64decode(params.dataBase64));
      return {};
    }
    return {};
  });
  let view;
  const button = (label) => view.root.findByProps({ "aria-label": label });
  const open = (path) => act(async () => app.set({ panelFile: path }));
  try {
    app.set({
      connected: true,
      current: { id: "other-chat", cwd: "/unrelated-chat-directory" },
      cwd: "/file-fixture",
      panel: "files",
      panelFile: documentPath,
    });
    await act(async () => {
      view = create(React.createElement(app.FilePanel));
    });
    assert.equal(view.root.findByType("h1").props.children, "文件预览");
    assert(view.root.findByType("strong"));
    assert(view.root.findByType("em"));
    assert(view.root.findByType("ul"));
    assert(view.root.findByType("table"));
    assert(view.root.findByProps({ type: "checkbox" }).props.checked);
    assert(view.root.findByProps({ className: "hljs-keyword" }));
    assert(view.root.findAllByType("math").length > 0);
    assert.equal(view.root.findAllByType("script").length, 0);
    assert.equal(button("保存文件").props.disabled, true);
    assert(
      requests.some(
        ({ method, params }) =>
          method === "fs/readFile" &&
          params.path === "/file-fixture/docs/images/chart.png",
      ),
    );
    assert.equal(
      view.root.findByType("a").props.href,
      "/file-fixture/src/main.mjs:12:3",
    );
    let prevented = false;
    await act(async () =>
      view.root.findByType("a").props.onClick({
        preventDefault() {
          prevented = true;
        },
      }),
    );
    assert(prevented);
    assert.equal(
      button("文件源码").props.value,
      files.get("/file-fixture/src/main.mjs"),
    );
    await open(documentPath);

    await act(async () => button("编辑 Markdown 源码").props.onClick());
    assert.equal(button("文件源码").props.value, markdown);
    const edited = "# 修改后的文档\n\n尚未保存的正文。";
    await act(async () =>
      button("文件源码").props.onChange({ target: { value: edited } }),
    );
    assert(listeners.has("beforeunload"));
    await act(async () => button("预览 Markdown").props.onClick());
    assert.equal(view.root.findByType("h1").props.children, "修改后的文档");
    await act(async () => button("编辑 Markdown 源码").props.onClick());
    assert.equal(button("文件源码").props.value, edited);
    await act(async () => button("预览 Markdown").props.onClick());

    await open("/file-fixture/notes.markdown");
    assert.equal(view.root.findByType("h1").props.children, "修改后的文档");
    await act(async () => button("保存文件").props.onClick());
    assert.equal(files.get(documentPath), edited);
    assert.equal(button("保存文件").props.disabled, true);
    assert.equal(listeners.has("beforeunload"), false);

    await open("/file-fixture/notes.markdown");
    assert.equal(view.root.findByType("h1").props.children, "另一份文档");
    await act(async () => button("编辑 Markdown 源码").props.onClick());
    await act(async () =>
      button("文件源码").props.onChange({ target: { value: "# 放弃的修改" } }),
    );
    discard = true;
    await open(documentPath);
    assert.equal(view.root.findByType("h1").props.children, "修改后的文档");

    await open("/file-fixture/src/main.mjs");
    assert.equal(view.root.findAllByType("h1").length, 0);
    assert.equal(
      button("文件源码").props.value,
      files.get("/file-fixture/src/main.mjs"),
    );
    assert.equal(
      view.root.findAllByProps({ "aria-label": "预览 Markdown" }).length,
      0,
    );
    console.log(
      "PASS Markdown 文件排版、代码与公式、相对图片与链接、源码切换、草稿保留、保存和放弃修改，以及代码文件编辑入口",
    );
  } finally {
    await act(async () => view?.unmount());
    app.set(original);
    globalThis.window = previousWindow;
  }
}
