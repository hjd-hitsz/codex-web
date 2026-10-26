import { spawn } from "node:child_process";
import { readConfig } from "../server/src/config.mjs";

const child = spawn(
  "codex",
  [
    "-c",
    "thread_unload_delay_secs=0",
    "app-server",
    "--listen",
    readConfig().upstreamUrl,
  ],
  { stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
