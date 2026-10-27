import { reasoningSummaries } from "./reasoning-summary.js";

// 每轮活动合并为一个过程区域，放在该轮最后一条用户消息或提问之后、最终回答之前。
export function conversationGroups(items) {
  const lastInTurn = new Map();
  for (const item of items)
    if (item.turnId) lastInTurn.set(item.turnId, item.id);
  const groups = [];
  const processes = new Map();
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
      groups.push({ type: "message", id: item.id, item });
      const process = item.turnId && processes.get(item.turnId);
      if ((item.type === "userMessage" || question) && process) {
        groups.splice(groups.indexOf(process), 1);
        groups.push(process);
      }
    } else {
      let process = processes.get(item.turnId);
      // 无轮次信息的历史活动仅合并相邻记录，避免跨任务聚合。
      if (!item.turnId && groups.at(-1) !== process) process = null;
      if (!process) {
        process = {
          type: "process",
          id: "process-" + item.id,
          turnId: item.turnId,
          items: [],
        };
        processes.set(item.turnId, process);
        groups.push(process);
      }
      process.items.push(item);
    }
  }
  return groups;
}
