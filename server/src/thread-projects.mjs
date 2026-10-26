import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

export async function prepareProjectlessDirectory(root) {
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, "chat-"));
}

// 桌面端的无项目标记也包含外部对话，只提取有自动工作目录记录的对话。
export async function readProjectlessDirectories(codexHome) {
  let state;
  try {
    state = JSON.parse(
      await readFile(join(codexHome, ".codex-global-state.json"), "utf8"),
    );
  } catch {
    return {};
  }
  if (!Array.isArray(state?.["projectless-thread-ids"])) return {};
  const directories = {};
  for (const id of state["projectless-thread-ids"]) {
    const output = state["thread-projectless-output-directories"]?.[id];
    const root = state["thread-workspace-root-hints"]?.[id];
    if (
      typeof output !== "string" ||
      typeof root !== "string" ||
      state["thread-project-assignments"]?.[id] ||
      basename(output) !== "outputs"
    )
      continue;
    const directory = dirname(output);
    if (/^\d{4}-\d{2}-\d{2}[/\\][^/\\]+$/.test(relative(root, directory)))
      directories[id] = directory;
  }
  return directories;
}
