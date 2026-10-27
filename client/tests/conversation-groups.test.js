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
test("中途引导消息独立显示，同轮过程汇总到最后一条引导下方", () => {
  const groups = conversationGroups([
    user,
    progress,
    item("steer", "userMessage"),
    tool,
    item("next-steer", "userMessage"),
    thought,
    answer,
  ]);
  assert.deepEqual(
    groups.map((g) => g.id),
    ["user", "steer", "next-steer", "process-progress", "answer"],
  );
  assert.deepEqual(
    groups[3].items.map((entry) => entry.id),
    ["progress", "tool", "thought"],
  );
});
test("生成中的引导消息立即将已有过程移到消息下方并保持分组 ID", () => {
  const before = conversationGroups([user, progress, tool]);
  const during = conversationGroups([
    user,
    progress,
    tool,
    item("pending-steer", "userMessage", { optimistic: true }),
  ]);
  assert.deepEqual(
    during.map((g) => g.id),
    ["user", "pending-steer", before[1].id],
  );
  assert.deepEqual(during[2].items, before[1].items);
});
test("每轮过程各自汇总，前一轮的引导和过程保留在该轮最终回答上方", () => {
  const groups = conversationGroups([
    user,
    progress,
    item("steer", "userMessage"),
    tool,
    answer,
    item("next-user", "userMessage", { turnId: "turn-2" }),
    { ...progress, id: "next-progress", turnId: "turn-2" },
    item("next-steer", "userMessage", { turnId: "turn-2" }),
    { ...tool, id: "next-tool", turnId: "turn-2" },
    { ...answer, id: "next-answer", turnId: "turn-2" },
  ]);
  assert.deepEqual(
    groups.map((g) => g.id),
    [
      "user",
      "steer",
      "process-progress",
      "answer",
      "next-user",
      "next-steer",
      "process-next-progress",
      "next-answer",
    ],
  );
  assert.deepEqual(
    groups.filter((g) => g.type === "process").map((g) => g.turnId),
    ["turn-1", "turn-2"],
  );
});
test("缺少轮次信息的历史活动保持相邻分组", () => {
  for (const turnId of [undefined, null]) {
    const groups = conversationGroups(
      [user, progress, tool, item("steer", "userMessage"), thought, answer].map(
        (entry) => ({ ...entry, turnId }),
      ),
    );
    assert.deepEqual(
      groups.map((g) => g.id),
      ["user", "process-progress", "steer", "process-thought", "answer"],
    );
  }
});
test("缺少轮次信息的活动与其他轮次的活动分别分组", () => {
  const groups = conversationGroups([
    { ...progress, turnId: undefined },
    tool,
    { ...thought, turnId: undefined },
  ]);
  assert.deepEqual(
    groups.map((g) => g.id),
    ["process-progress", "process-tool", "process-thought"],
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
test("异步提问保持展开，空正文和后续进度均保留问题卡片", () => {
  const question = item("question", "agentMessage", {
    phase: "commentary",
    text: "",
    questions: [{ title: "选择部署方式", options: ["源码", "npm"] }],
  });
  const groups = conversationGroups([
    progress,
    question,
    tool,
    { ...answer, id: "next-answer" },
  ]);
  assert.deepEqual(
    groups.map((group) => group.type),
    ["message", "process", "message"],
  );
  assert.equal(groups[0].item, question);
  assert.deepEqual(groups[1].items, [progress, tool]);
});
