import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRelease } from "./version.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

export function publishRelease(repo, tag, assets, notes, run = gh) {
  const releases = JSON.parse(
    run("api", `repos/${repo}/releases?per_page=100`, "--paginate", "--slurp"),
  ).flat();
  const existing = releases.find((release) => release.tag_name === tag);
  if (existing && !existing.draft) {
    for (const path of assets)
      assert.ok(
        existing.assets.some(
          (asset) =>
            asset.name === basename(path) &&
            asset.state === "uploaded" &&
            asset.size > 0,
        ),
        `${tag} 已正式发布但缺少附件 ${basename(path)}，请核查已交付内容`,
      );
    return;
  }
  if (!existing)
    run(
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--verify-tag",
      "--draft",
      "--title",
      `Codex Web ${tag}`,
      "--notes-file",
      notes,
    );
  run("release", "upload", tag, ...assets, "--repo", repo, "--clobber");
  run(
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--title",
    `Codex Web ${tag}`,
    "--notes-file",
    notes,
    "--draft=false",
    "--latest",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = mkdtempSync(join(tmpdir(), "codex-web-release-"));
  try {
    const version = checkRelease();
    const repo = process.env.GITHUB_REPOSITORY;
    assert.ok(repo, "发布需要 GITHUB_REPOSITORY");
    const [pack] = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", dir],
        { cwd: root, encoding: "utf8" },
      ),
    );
    const path = join(dir, pack.filename);
    const checksum = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
    writeFileSync(`${path}.sha256`, `${checksum}  ${pack.filename}\n`);
    publishRelease(
      repo,
      `v${version}`,
      [path, `${path}.sha256`],
      join(root, `docs/releases/v${version}.md`),
    );
    console.log(
      `发布完成：https://github.com/${repo}/releases/tag/v${version}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
