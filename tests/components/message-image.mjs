import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testMessageImages(app, requests, setResponse) {
  const original = app.get();
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const viewerEvents = [];
  globalThis.document = {
    body: {},
    activeElement: {
      isConnected: true,
      focus: () => viewerEvents.push("focus"),
    },
  };
  const renderOptions = {
    createNodeMock: ({ type }) =>
      type === "dialog"
        ? {
            showModal: () => viewerEvents.push("open"),
            close: () => viewerEvents.push("close"),
          }
        : null,
  };
  const start = requests.length;
  const fileRequests = () =>
    requests.slice(start).filter((request) => request.method === "fs/readFile");
  let missing = true;
  let finishSlow;
  setResponse(({ method, params }) => {
    if (method !== "fs/readFile") return { data: [] };
    if (params.path === "/tmp/slow.png")
      return new Promise((resolve) => (finishSlow = resolve));
    if (params.path === "/tmp/missing.png" && missing)
      return { error: { message: "图片文件不存在" } };
    return { dataBase64: params.path.endsWith(".jpg") ? "AQ==" : "Ag==" };
  });
  let view;
  const imageText = (source) => `![测试图片](${source} "图片标题")`;
  const update = (text) =>
    act(async () => view.update(React.createElement(app.RichText, { text })));
  const click = () => ({ preventDefault() {}, stopPropagation() {} });
  const openPreview = () =>
    act(async () =>
      view.root
        .findByProps({ className: "message-image-button" })
        .props.onClick(click()),
    );
  try {
    app.set({
      connected: true,
      current: { id: "image-fixture", cwd: "/project" },
      defaultCwd: "/other",
    });
    await act(async () => {
      view = create(
        React.createElement(app.RichText, {
          text: imageText("/tmp/preview.jpg"),
        }),
        renderOptions,
      );
    });
    assert.equal(fileRequests().length, 1);
    assert.deepEqual(fileRequests()[0].params, { path: "/tmp/preview.jpg" });
    assert.equal(
      view.root.findByType("img").props.src,
      "data:image/jpeg;base64,AQ==",
    );
    assert.equal(view.root.findByType("img").props.alt, "测试图片");
    assert.equal(view.root.findByType("img").props.title, "图片标题");
    await update(imageText("/tmp/preview.jpg") + "\n\n流式正文更新。");
    assert.equal(fileRequests().length, 1);
    assert.equal(
      view.root.findByProps({ className: "message-image-button" }).props[
        "aria-haspopup"
      ],
      "dialog",
    );
    await openPreview();
    let dialog = view.root.findByType("dialog");
    assert.equal(dialog.props["aria-modal"], "true");
    assert.equal(
      dialog.findByType("img").props.src,
      "data:image/jpeg;base64,AQ==",
    );
    assert.deepEqual(viewerEvents, ["open"]);
    await update(imageText("/tmp/preview.jpg") + "\n\n预览期间正文继续更新。");
    assert.equal(view.root.findAllByType("dialog").length, 1);
    assert.deepEqual(viewerEvents, ["open"]);
    await act(async () =>
      dialog.findByProps({ "aria-pressed": false }).props.onClick(),
    );
    assert(
      view.root.findByProps({ className: "image-viewer-canvas original-size" }),
    );
    await act(async () => dialog.findByType("img").props.onClick());
    const canvas = view.root.findByProps({ className: "image-viewer-canvas" });
    await act(async () =>
      canvas.props.onClick({ target: {}, currentTarget: {} }),
    );
    assert.equal(view.root.findAllByType("dialog").length, 1);
    const background = {};
    await act(async () =>
      canvas.props.onClick({ target: background, currentTarget: background }),
    );
    assert.equal(view.root.findAllByType("dialog").length, 0);
    assert.deepEqual(viewerEvents, ["open", "close", "focus"]);
    await openPreview();
    let prevented = false;
    await act(async () =>
      view.root.findByType("dialog").props.onKeyDown({
        key: "Escape",
        stopPropagation() {},
        preventDefault() {
          prevented = true;
        },
      }),
    );
    assert(prevented);
    assert.equal(view.root.findAllByType("dialog").length, 0);
    await openPreview();
    await act(async () =>
      view.root.findByProps({ "aria-label": "关闭图片预览" }).props.onClick(),
    );
    assert.equal(view.root.findAllByType("dialog").length, 0);
    await openPreview();
    await act(async () =>
      view.root.findByType("dialog").props.onCancel(click()),
    );
    assert.equal(view.root.findAllByType("dialog").length, 0);
    await openPreview();

    await update(imageText("/tmp/slow.png"));
    assert.equal(view.root.findAllByType("dialog").length, 0);
    assert(JSON.stringify(view.toJSON()).includes("正在加载图片"));
    await update(imageText("/tmp/latest.jpg"));
    await act(async () => finishSlow({ dataBase64: "Aw==" }));
    assert.equal(
      view.root.findByType("img").props.src,
      "data:image/jpeg;base64,AQ==",
    );
    await update(imageText("/tmp/preview.jpg"));
    assert.equal(view.root.findAllByType("dialog").length, 0);

    await update(imageText("/tmp/missing.png"));
    assert(JSON.stringify(view.toJSON()).includes("图片加载失败"));
    missing = false;
    await act(async () =>
      view.root.findByProps({ "aria-label": "重试加载图片" }).props.onClick(),
    );
    assert.equal(
      view.root.findByType("img").props.src,
      "data:image/png;base64,Ag==",
    );
    assert.equal(
      fileRequests().filter(
        (request) => request.params.path === "/tmp/missing.png",
      ).length,
      2,
    );
    await act(async () => view.root.findByType("img").props.onError());
    assert(JSON.stringify(view.toJSON()).includes("图片加载失败"));
    await act(async () =>
      view.root.findByProps({ "aria-label": "重试加载图片" }).props.onClick(),
    );
    assert(view.root.findByType("img"));

    await act(async () => app.set({ connected: false }));
    const disconnectedCount = fileRequests().length;
    await update(imageText("/tmp/reconnected.png"));
    assert.equal(fileRequests().length, disconnectedCount);
    assert(JSON.stringify(view.toJSON()).includes("等待连接后加载图片"));
    await act(async () => app.set({ connected: true }));
    assert.equal(fileRequests().at(-1).params.path, "/tmp/reconnected.png");
    assert(view.root.findByType("img"));

    for (const [source, path] of [
      ["./images/chart.png", "/project/images/chart.png"],
      ["file:///tmp/preview%20one.png", "/tmp/preview one.png"],
      ["sandbox:/mnt/data/chart.png", "/mnt/data/chart.png"],
    ]) {
      await update(imageText(source));
      assert.equal(fileRequests().at(-1).params.path, path);
      assert(view.root.findByType("img").props.src.startsWith("data:image/"));
    }
    const localCount = fileRequests().length;
    for (const source of [
      "https://example.invalid/chart.png",
      "//example.invalid/chart.png",
      "data:image/png;base64,Ag==",
    ]) {
      await update(imageText(source));
      assert.equal(view.root.findByType("img").props.src, source);
    }
    assert.equal(fileRequests().length, localCount);
    await update("![无效图片](javascript:alert%281%29)");
    assert.equal(view.root.findAllByType("img").length, 0);
    assert.equal(fileRequests().length, localCount);
    await update(
      "[![测试图片](https://example.invalid/linked.png)](https://example.invalid/destination)",
    );
    const handled = [];
    await act(async () =>
      view.root
        .findByProps({ className: "message-image-button" })
        .props.onClick({
          preventDefault: () => handled.push("prevent"),
          stopPropagation: () => handled.push("stop"),
        }),
    );
    assert.deepEqual(handled, ["prevent", "stop"]);
    assert.equal(view.root.findAllByType("dialog").length, 1);
    await act(async () => view.unmount());

    app.set({
      items: [
        {
          id: "local-image-fixture",
          type: "userMessage",
          content: [{ type: "localImage", path: "/tmp/attachment.png" }],
        },
      ],
      active: {},
      questions: [],
    });
    await act(async () => {
      view = create(React.createElement(app.Conversation), renderOptions);
    });
    assert.equal(fileRequests().at(-1).params.path, "/tmp/attachment.png");
    assert.equal(
      view.root.findByType("img").props.src,
      "data:image/png;base64,Ag==",
    );
    await openPreview();
    assert.equal(
      view.root.findByType("dialog").findByType("img").props.alt,
      "图片附件",
    );
    await act(async () => view.unmount());
    assert.equal(
      viewerEvents.filter((event) => event === "open").length,
      viewerEvents.filter((event) => event === "close").length,
    );
    console.log(
      "PASS 图片缩略预览、点击放大、原始尺寸、关闭与焦点恢复，以及本地路径、历史附件、流式更新、迟到响应、失败重试、重连和外部图片过滤",
    );
  } finally {
    await act(async () => view?.unmount());
    app.set(original);
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
}
