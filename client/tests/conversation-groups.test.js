import test from "node:test";
import assert from "node:assert/strict";
import { conversationGroups } from "../src/conversation-groups.js";
const item = (id, type, props = {}) => ({
  id,
  type,
  turnId: "turn-1",
  ...props,
});
const user = item("user", "userMessage");
const progress = item("progress", "agentMessage", {
  phase: "commentary",
  text: "正在检查。",
});
const tool = item("tool", "commandExecution", { command: "pwd" });
const thought = item("thought", "reasoning", { summary: ["**检查结果**"] });
const answer = item("answer", "agentMessage", {
  phase: "final_answer",
  text: "检查完成。",
});
test("进度、命令与思考摘要整体合并，用户消息和最终回答保持独立", () => {
  const groups = conversationGroups([user, progress, tool, thought, answer]);
  assert.deepEqual(
    groups.map((g) => g.type),
    ["message", "process", "message"],
  );
  assert.deepEqual(
    groups[1].items.map((i) => i.id),
    ["progress", "tool", "thought"],
  );
});
test("不同轮次和中途补充的用户消息不会被一起折叠", () => {
  const groups = conversationGroups([
    user,
    progress,
    item("steer", "userMessage"),
    tool,
    answer,
    { ...progress, id: "next-progress", turnId: "turn-2" },
  ]);
  assert.deepEqual(
    groups.map((g) => g.type),
    ["message", "process", "message", "process", "message", "process"],
  );
});
test("空摘要不创建折叠区域，只有最终回答时直接显示", () => {
  assert.deepEqual(
    conversationGroups([
      item("empty", "reasoning", { summary: [] }),
      answer,
    ]).map((g) => g.id),
    ["answer"],
  );
});
test("旧消息缺少阶段字段时，末尾回复保留为正文", () => {
  assert.deepEqual(
    conversationGroups([
      user,
      { ...progress, phase: null },
      tool,
      { ...answer, phase: null },
    ]).map((g) => g.type),
    ["message", "process", "message"],
  );
});
test("生成中的进度和工具依然位于一个折叠区域", () => {
  assert.equal(conversationGroups([progress, tool, thought]).length, 1);
});
