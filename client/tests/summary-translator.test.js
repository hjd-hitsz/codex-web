import test from "node:test";
import assert from "node:assert/strict";
import {
  createSummaryTranslator,
  needsTranslation,
  translateWithTransmart,
} from "../src/summary-translator.js";

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  };
}
test("中文摘要与纯代码直接显示，英文摘要请求翻译", () => {
  assert.equal(needsTranslation("检查当前 Git 分支"), false);
  assert.equal(needsTranslation("`git status`"), false);
  assert.equal(needsTranslation("Identifying Git Branches"), true);
});
test("相同摘要去重，不同摘要合并，刷新后读取译文缓存", async () => {
  const saved = storage(),
    batches = [];
  const translator = createSummaryTranslator(async (texts) => {
    batches.push(texts);
    return texts.map((text) => "译文：" + text);
  }, saved);
  const first = translator.translate("Checking files");
  assert.equal(translator.translate("Checking files"), first);
  const second = translator.translate("Reviewing changes");
  await Promise.all([first, second]);
  assert.deepEqual(batches, [["Checking files", "Reviewing changes"]]);
  const reloaded = createSummaryTranslator(() => {
    throw new Error("不应再次请求");
  }, saved);
  assert.equal(
    await reloaded.translate("Checking files"),
    "译文：Checking files",
  );
  assert.equal(await reloaded.translate("已经是中文"), "已经是中文");
});
test("翻译失败保留重试能力，缺失条目不会错配到其他摘要", async () => {
  let attempts = 0;
  const translator = createSummaryTranslator(
    async () => (++attempts === 1 ? [] : ["检查文件"]),
    storage(),
  );
  await assert.rejects(translator.translate("Checking files"), /不完整/);
  assert.equal(translator.cached("Checking files"), undefined);
  assert.equal(await translator.translate("Checking files"), "检查文件");
});

test("直接批量请求机器翻译，恢复代码、路径和 Markdown 标记", async (t) => {
  const source =
    "**Reviewing changes**\nUpdate `config.model` in client/src/store.js and /tmp/config.json.\nSee https://example.com/docs and C:\\project\\file.js.\n<x0>\n```js\nconst ready = true;\n```";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://transmart.qq.com/api/imt");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    const request = JSON.parse(options.body);
    assert.equal(request.header.fn, "auto_translation");
    assert.equal(request.header.user, "");
    assert.equal(request.header.session, "");
    assert.equal(request.model_category, "normal");
    assert.equal(request.source.lang, "en");
    assert.equal(request.target.lang, "zh");
    assert.equal(request.source.text_list.length, 2);
    for (const protectedText of [
      "config.model",
      "client/src/store.js",
      "/tmp/config.json",
      "https://example.com/docs",
      "C:\\project\\file.js",
      "const ready = true;",
      "**",
    ])
      assert.ok(!request.source.text_list[1].includes(protectedText));
    return new Response(
      JSON.stringify({
        header: { ret_code: "succ" },
        auto_translation: [
          "检查文件",
          request.source.text_list[1]
            .replace("Reviewing changes", "审查更改")
            .replace(/<x(\d+)>/g, "<x $1>"),
        ],
      }),
    );
  });
  assert.deepEqual(await translateWithTransmart(["Checking files", source]), [
    "检查文件",
    source.replace("Reviewing changes", "审查更改"),
  ]);
});

test("翻译服务异常或条目缺失时报告失败", async (t) => {
  for (const [data, status, message] of [
    [{}, 503, /请求失败/],
    [{ header: { ret_code: "Session-Out" } }, 200, /暂不可用/],
    [{ header: { ret_code: "succ" }, auto_translation: [] }, 200, /不完整/],
    [{ header: { ret_code: "succ" }, auto_translation: [""] }, 200, /不完整/],
  ]) {
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(JSON.stringify(data), { status }),
    );
    await assert.rejects(translateWithTransmart(["Checking files"]), message);
    mock.mock.restore();
  }
});

test("代码占位符缺失、重复或未知时拒绝译文，重试可恢复", async (t) => {
  let translation;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          header: { ret_code: "succ" },
          auto_translation: [translation],
        }),
      ),
  );
  const translator = createSummaryTranslator(translateWithTransmart, storage());
  const source = "Checking `config.model`";
  for (translation of ["检查配置", "检查<x0><x0>", "检查<x1>"])
    await assert.rejects(translator.translate(source), /格式异常/);
  assert.equal(translator.cached(source), undefined);
  translation = "检查<x 0>";
  assert.equal(await translator.translate(source), "检查`config.model`");
});
