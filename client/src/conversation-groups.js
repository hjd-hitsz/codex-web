import { reasoningSummaries } from "./reasoning-summary.js";

// 用户消息、提问和最终回答保持独立，其间的进度、摘要与工具记录合并为一个过程区域。
export function conversationGroups(items) {
  const lastInTurn = new Map();
  for (const item of items)
    if (item.turnId) lastInTurn.set(item.turnId, item.id);
  const groups = [];
  let process;
  for (const item of items) {
    if (item.type === "reasoning" && !reasoningSummaries(item.summary).length)
      continue;
    const question = item.type === "agentMessage" && !!item.questions?.length;
    if (item.type === "agentMessage" && !item.text?.trim() && !question)
      continue;
    const answer =
      item.type === "agentMessage" &&
      (item.phase === "final_answer" ||
        (item.phase !== "commentary" &&
          lastInTurn.get(item.turnId) === item.id));
    if (item.type === "userMessage" || question || answer) {
      process = null;
      groups.push({ type: "message", id: item.id, item });
    } else {
      if (!process || process.turnId !== item.turnId) {
        process = {
          type: "process",
          id: "process-" + item.id,
          turnId: item.turnId,
          items: [],
        };
        groups.push(process);
      }
      process.items.push(item);
    }
  }
  return groups;
}
