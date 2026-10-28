import test from "node:test";
import assert from "node:assert/strict";
import {
  createSummaryTranslator,
  needsTranslation,
  translateSummaries,
} from "../src/summary-translator.js";

test("中文摘要与纯代码直接显示，英文摘要请求翻译", () => {
  assert.equal(needsTranslation("检查当前 Git 分支"), false);
  assert.equal(needsTranslation("`git status`"), false);
  assert.equal(needsTranslation("Identifying Git Branches"), true);
});
test("仅合并正在请求的相同摘要，完成后再次翻译会重新请求", async () => {
  const batches = [];
  const translator = createSummaryTranslator(async (texts) => {
    batches.push(texts);
    return texts.map((text) => "译文：" + text);
  });
  const first = translator.translate("Checking files");
  assert.equal(translator.translate("Checking files"), first);
  const second = translator.translate("Reviewing changes");
  await Promise.all([first, second]);
  assert.deepEqual(batches, [["Checking files", "Reviewing changes"]]);
  assert.equal(
    await translator.translate("Checking files"),
    "译文：Checking files",
  );
  assert.deepEqual(batches, [
    ["Checking files", "Reviewing changes"],
    ["Checking files"],
  ]);
  assert.equal(await translator.translate("已经是中文"), "已经是中文");
});
test("翻译失败保留重试能力，缺失条目不会错配到其他摘要", async () => {
  let attempts = 0;
  const translator = createSummaryTranslator(async () =>
    ++attempts === 1 ? [] : ["检查文件"],
  );
  await assert.rejects(translator.translate("Checking files"), /不完整/);
  assert.equal(await translator.translate("Checking files"), "检查文件");
});

test("标题立即发送并越过正文队列，慢正文仍为后续标题保留容量", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const batches = [];
  let finishBody;
  const translator = createSummaryTranslator(async (texts) => {
    batches.push(texts);
    if (texts.includes("Slow background paragraph"))
      await new Promise((resolve) => (finishBody = resolve));
    return texts.map((text) => "译文：" + text);
  });
  const body = translator.translate("Slow background paragraph");
  const firstTitle = translator.translate("First heading", "title");
  t.mock.timers.tick(0);
  await firstTitle;
  assert.deepEqual(batches, [["First heading"]]);
  t.mock.timers.tick(100);
  assert.deepEqual(batches[1], ["Slow background paragraph"]);

  const nextBody = translator.translate("Next background paragraph");
  const nextTitle = translator.translate("Next heading", "title");
  t.mock.timers.tick(0);
  await nextTitle;
  assert.deepEqual(batches[2], ["Next heading"]);
  t.mock.timers.tick(1000);
  assert.equal(batches.length, 3);

  finishBody();
  await body;
  t.mock.timers.tick(100);
  await nextBody;
  assert.deepEqual(batches[3], ["Next background paragraph"]);
});

test("同一原文从正文提升为标题时立即发送并复用请求", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const batches = [];
  const translator = createSummaryTranslator(async (texts) => {
    batches.push(texts);
    return texts.map(() => "共享译文");
  });
  const body = translator.translate("Shared translation text");
  const title = translator.translate("Shared translation text", "title");
  assert.equal(title, body);
  t.mock.timers.tick(0);
  assert.equal(await title, "共享译文");
  assert.deepEqual(batches, [["Shared translation text"]]);
});

test("通过本站批量请求翻译，恢复代码、路径和 Markdown 标记", async (t) => {
  const source =
    "**Reviewing changes**\nUpdate `config.model` in client/src/store.js and /tmp/config.json.\nSee https://example.com/docs and C:\\project\\file.js.\n<x0>\n```js\nconst ready = true;\n```";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/translate");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    const request = JSON.parse(options.body);
    assert.deepEqual(Object.keys(request), ["texts"]);
    assert.equal(request.texts.length, 2);
    for (const protectedText of [
      "config.model",
      "client/src/store.js",
      "/tmp/config.json",
      "https://example.com/docs",
      "C:\\project\\file.js",
      "const ready = true;",
      "**",
    ])
      assert.ok(!request.texts[1].includes(protectedText));
    return new Response(
      JSON.stringify({
        translations: [
          "检查文件",
          request.texts[1]
            .replace("Reviewing changes", "审查更改")
            .replace(/<x(\d+)>/g, "<x $1>"),
        ],
      }),
    );
  });
  assert.deepEqual(await translateSummaries(["Checking files", source]), [
    "检查文件",
    source.replace("Reviewing changes", "审查更改"),
  ]);
});

test("翻译服务异常或条目缺失时报告失败", async (t) => {
  for (const [data, status, message] of [
    [{}, 404, /网页服务尚未加载翻译接口/],
    [{}, 503, /请求失败/],
    [{ error: "翻译服务暂不可用，请重试" }, 502, /暂不可用/],
    [{ translations: [] }, 200, /不完整/],
    [{ translations: [""] }, 200, /不完整/],
  ]) {
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(JSON.stringify(data), { status }),
    );
    await assert.rejects(translateSummaries(["Checking files"]), message);
    mock.mock.restore();
  }
});

test("旧桥接返回纯文本 404 时提示等待网页服务更新", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("Not found", { status: 404 }),
  );
  await assert.rejects(
    translateSummaries(["Checking files"]),
    /网页服务尚未加载翻译接口/,
  );
});

test("代码占位符缺失、重复或未知时拒绝译文，重试可恢复", async (t) => {
  let translation;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          translations: [translation],
        }),
      ),
  );
  const translator = createSummaryTranslator(translateSummaries);
  const source = "Checking `config.model`";
  for (translation of ["检查配置", "检查<x0><x0>", "检查<x1>"])
    await assert.rejects(translator.translate(source), /格式异常/);
  translation = "检查<x 0>";
  assert.equal(await translator.translate(source), "检查`config.model`");
});
