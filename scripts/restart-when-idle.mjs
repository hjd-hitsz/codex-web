import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { readConfig } from "../server/src/config.mjs";
import { isCompacting } from "../server/src/compaction.mjs";

const config = readConfig();
const url = `ws://127.0.0.1:${config.port}/rpc`;
let timer,
  restarting = false;
function connect() {
  const socket = new WebSocket(url);
  let ready = false;
  const turns = new Map(),
    compactions = new Map(),
    terminals = new Set();
  function check() {
    clearTimeout(timer);
    if (!ready || turns.size || compactions.size || terminals.size) return;
    timer = setTimeout(() => {
      restarting = true;
      try {
        execFileSync(
          "systemctl",
          ["--user", "restart", "codex-lan-web.service"],
          { stdio: "inherit" },
        );
        console.log("任务和终端已空闲，网页服务已切换到当前项目。");
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      } finally {
        socket.close();
      }
    }, 2000);
  }
  socket.on("message", (bytes) => {
    const { method, params: p = {} } = JSON.parse(bytes);
    if (method === "lan/state") {
      ready = p.ready;
      turns.clear();
      for (const [threadId, turnId] of Object.entries(p.activeTurns))
        turns.set(threadId, turnId);
      terminals.clear();
      compactions.clear();
      for (const [id, entry] of Object.entries(p.compactions || {}))
        if (isCompacting(entry)) compactions.set(id, entry);
      for (const [id, terminal] of Object.entries(p.terminals))
        if (terminal.running) terminals.add(id);
      console.log(
        `等待空闲：${turns.size} 个任务，${compactions.size} 个上下文整理，${terminals.size} 个终端。`,
      );
    }
    if (method === "lan/compaction") {
      if (isCompacting(p.compaction)) compactions.set(p.threadId, p.compaction);
      else compactions.delete(p.threadId);
    }
    if (method === "turn/started") turns.set(p.threadId, p.turn.id);
    if (method === "turn/completed" && turns.get(p.threadId) === p.turn.id)
      turns.delete(p.threadId);
    if (method === "lan/terminalStarted") terminals.add(p.processId);
    if (method === "lan/terminalExit") terminals.delete(p.processId);
    check();
  });
  socket.on("error", (error) => console.error(error.message));
  socket.on("close", () => {
    clearTimeout(timer);
    if (!restarting) setTimeout(connect, 2000);
  });
}
connect();
