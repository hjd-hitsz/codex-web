import test from "node:test";
import assert from "node:assert/strict";
import {
  createSummaryTranslator,
  needsTranslation,
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
