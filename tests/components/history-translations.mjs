import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testHistoryTranslations(app) {
  const original = app.get();
  const originalFetch = globalThis.fetch;
  const requests = [];
  const paragraph =
    "Inspect the stored conversation and preserve its content. ";
  let failBody = true;
  let finishBody;
  let view;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/translate");
    const { texts } = JSON.parse(options.body);
    requests.push(texts);
    assert(texts.join("").length <= 3000);
    if (failBody && texts.some((text) => text.startsWith("Stored body 4."))) {
      failBody = false;
      return Response.json({ error: "模拟正文批次失败" }, { status: 502 });
    }
    if (texts.includes("Delayed body"))
      await new Promise((resolve) => (finishBody = resolve));
    return Response.json({
      translations: texts.map((text) =>
        text
          .replace(/Stored heading (\d+)/g, "历史标题 $1")
          .replace(/Stored body (\d+)/g, "历史正文 $1")
          .replace("Delayed heading", "延迟标题")
          .replace("Delayed body", "延迟正文")
          .replaceAll(paragraph.trim(), "检查已有对话并保留其内容。"),
      ),
    });
  };
  const open = async () => {
    await act(async () => {
      view = create(React.createElement(app.Conversation));
    });
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } }),
    );
    for (let attempt = 0; attempt < 200; attempt++) {
      await act(async () => delay(10));
      const text = JSON.stringify(view.toJSON());
      if (
        !text.includes("正在翻译") &&
        Array.from({ length: 12 }, (_, index) =>
          text.includes(`历史正文 ${index}.`),
        ).every(Boolean)
      )
        return;
    }
    assert.fail("历史摘要的全部标题与正文应完成翻译");
  };
  try {
    app.set({
      current: { id: "translation-history-fixture" },
      loading: false,
      active: {},
      questions: [],
      plans: {},
      items: Array.from({ length: 12 }, (_, index) => ({
        id: `stored-reasoning-${index}`,
        type: "reasoning",
        turnId: "stored-turn",
        summary: [
          `Stored heading ${index}\nStored body ${index}. ${paragraph.repeat(15)}\nRead \`/fixture/${index}/config.js\`.`,
        ],
      })),
    });
    await open();
    const text = JSON.stringify(view.toJSON());
    assert(!text.includes("翻译失败"));
    for (let index = 0; index < 12; index++) {
      assert(text.includes(`历史标题 ${index}`));
      assert(text.includes(`/fixture/${index}/config.js`));
    }
    assert.equal(failBody, false, "正文失败批次拆分重试后恢复");
    assert(requests.some((batch) => batch.length > 1));
    const completed = requests.length;
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: false } }),
    );
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } }),
    );
    assert(!JSON.stringify(view.toJSON()).includes("正在翻译"));
    await act(async () => delay(150));
    assert.equal(requests.length, completed, "再次展开直接复用标题与正文译文");
    await act(async () => view.unmount());
    view = null;
    await open();
    assert.equal(requests.length, completed, "同一页面重新打开历史复用译文");
    assert(!JSON.stringify(view.toJSON()).includes("翻译失败"));
    await act(async () =>
      app.set({
        items: [
          {
            id: "delayed-reasoning",
            type: "reasoning",
            turnId: "delayed-turn",
            summary: ["Delayed heading\nDelayed body"],
          },
        ],
      }),
    );
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } }),
    );
    await act(async () => delay(200));
    assert.equal(typeof finishBody, "function");
    const waiting = requests.length;
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: false } }),
    );
    await act(async () => finishBody());
    await act(async () =>
      view.root
        .findByProps({ className: "process-history" })
        .props.onToggle({ currentTarget: { open: true } }),
    );
    const delayed = JSON.stringify(view.toJSON());
    assert(delayed.includes("延迟正文"));
    assert(!delayed.includes("正在翻译"));
    await act(async () => delay(150));
    assert.equal(requests.length, waiting, "卸载后完成的译文继续进入会话缓存");
  } finally {
    if (view) await act(async () => view.unmount());
    app.set(original);
    globalThis.fetch = originalFetch;
  }
  console.log(
    "PASS 旧对话批量摘要翻译、正文失败隔离重试、路径保留及折叠与重开复用译文",
  );
}
