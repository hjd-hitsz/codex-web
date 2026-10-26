import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

export function readVersion(root = packageRoot) {
  const { version } = JSON.parse(readFileSync(join(root, "package.json")));
  if (!existsSync(join(root, ".git"))) {
    const manifest = join(root, "build-info.json");
    if (existsSync(manifest)) {
      const info = JSON.parse(readFileSync(manifest));
      if (info.version !== version)
        throw new Error("构建信息与包版本不一致，请重新构建。");
      return info;
    }
  } else {
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    try {
      const revision = git("rev-parse", "HEAD");
      const dirty = Boolean(
        git("status", "--porcelain", "--untracked-files=normal"),
      );
      const release =
        !dirty &&
        git("tag", "--points-at", "HEAD").split("\n").includes(`v${version}`);
      return {
        version,
        displayVersion: release
          ? version
          : `${version}+dev.g${revision.slice(0, 7)}${dirty ? ".dirty" : ""}`,
        revision,
        dirty,
        channel: release ? "release" : "development",
        builtAt: null,
      };
    } catch {
      // Git 不可用的源码部署仍可运行，来源显示为未知。
    }
  }
  return {
    version,
    displayVersion: `${version}+unknown`,
    revision: null,
    dirty: null,
    channel: "unknown",
    builtAt: null,
  };
}
