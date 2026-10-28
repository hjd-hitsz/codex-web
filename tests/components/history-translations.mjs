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
    return Response.json({
      translations: texts.map((text) =>
        text
          .replace(/Stored heading (\d+)/g, "历史标题 $1")
          .replace(/Stored body (\d+)/g, "历史正文 $1")
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
    await act(async () => view.unmount());
    view = null;
    await open();
    assert(requests.length > completed, "重新打开历史继续读取新译文");
    assert(!JSON.stringify(view.toJSON()).includes("翻译失败"));
  } finally {
    if (view) await act(async () => view.unmount());
    app.set(original);
    globalThis.fetch = originalFetch;
  }
  console.log(
    "PASS 旧对话批量摘要标题与正文翻译、正文失败隔离重试、路径保留及重新打开重译",
  );
}
