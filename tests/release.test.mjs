import test from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { publishRelease } from "../scripts/publish-release.mjs";

const repo = "example/codex-web";
const tag = "v1.2.3";
const assets = ["/tmp/codex-web-1.2.3.tgz", "/tmp/codex-web-1.2.3.tgz.sha256"];
const notes = "docs/releases/v1.2.3.md";

function registry() {
  const state = {
    releases: [],
    mutations: [],
    failUpload: false,
    failPublishResponse: false,
  };
  state.run = (...args) => {
    if (args[0] === "api") {
      assert.deepEqual(args, [
        "api",
        `repos/${repo}/releases?per_page=100`,
        "--paginate",
        "--slurp",
      ]);
      return JSON.stringify([state.releases]);
    }
    assert.equal(args[0], "release");
    assert.equal(args[2], tag);
    assert.equal(args[args.indexOf("--repo") + 1], repo);
    state.mutations.push(args[1]);
    let release = state.releases.find((item) => item.tag_name === tag);
    if (args[1] === "create") {
      assert.equal(release, undefined);
      assert.ok(args.includes("--draft"));
      assert.ok(args.includes("--verify-tag"));
      state.releases.push({ tag_name: tag, draft: true, assets: [] });
    } else if (args[1] === "upload") {
      assert.equal(release.draft, true);
      assert.ok(args.includes("--clobber"));
      for (const path of args.slice(3, args.indexOf("--repo"))) {
        const name = basename(path);
        release.assets = release.assets.filter((item) => item.name !== name);
        release.assets.push({ name, state: "uploaded", size: 123 });
        if (state.failUpload) {
          state.failUpload = false;
          throw new Error("附件上传中断");
        }
      }
    } else if (args[1] === "edit") {
      assert.equal(release.assets.length, 2);
      assert.ok(args.includes("--draft=false"));
      assert.ok(args.includes("--latest"));
      assert.equal(args[args.indexOf("--notes-file") + 1], notes);
      release.draft = false;
      if (state.failPublishResponse) {
        state.failPublishResponse = false;
        throw new Error("发布成功后连接中断");
      }
    } else {
      assert.fail(`意外的写入：${args.join(" ")}`);
    }
    return "";
  };
  return state;
}

test("附件部分上传失败后重试同一草稿，完整上传后发布", () => {
  const state = registry();
  state.failUpload = true;
  assert.throws(
    () => publishRelease(repo, tag, assets, notes, state.run),
    /上传中断/,
  );
  assert.equal(state.releases[0].draft, true);
  assert.equal(state.releases[0].assets.length, 1);
  publishRelease(repo, tag, assets, notes, state.run);
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0].tag_name, tag);
  assert.equal(state.releases[0].draft, false);
  assert.deepEqual(
    state.releases[0].assets.map((item) => item.name),
    assets.map((path) => basename(path)),
  );
  assert.deepEqual(state.mutations, ["create", "upload", "upload", "edit"]);
});

test("发布成功但响应中断后重试，保留正式附件和发布记录", () => {
  const state = registry();
  state.failPublishResponse = true;
  assert.throws(
    () => publishRelease(repo, tag, assets, notes, state.run),
    /连接中断/,
  );
  const published = structuredClone(state.releases);
  state.mutations.length = 0;
  publishRelease(repo, tag, assets, notes, state.run);
  assert.deepEqual(state.releases, published);
  assert.deepEqual(state.mutations, []);
});

test("正式版本缺少附件和 GitHub 查询失败时保持现场并报错", () => {
  const state = registry();
  state.releases.push({ tag_name: tag, draft: false, assets: [] });
  assert.throws(
    () => publishRelease(repo, tag, assets, notes, state.run),
    /缺少附件/,
  );
  assert.deepEqual(state.mutations, []);
  assert.throws(
    () =>
      publishRelease(repo, tag, assets, notes, () => {
        throw new Error("GitHub 暂不可用");
      }),
    /GitHub 暂不可用/,
  );
  assert.deepEqual(state.mutations, []);
});
