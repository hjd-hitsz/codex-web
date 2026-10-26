import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cache = root + ".cache/component-tests";
await mkdir(cache, { recursive: true });
try {
  await build({
    stdin: {
      contents: `export {Conversation, Composer} from './src/chat.jsx'; export {TerminalPanel} from './src/workspace.jsx'; export * from './src/store.js';`,
      resolveDir: root + "client",
    },
    banner: {
      js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: cache + "/client.mjs",
    external: ["react", "react-dom"],
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "terminal-fixture",
        setup(builder) {
          builder.onResolve(
            { filter: /^@xterm\/(xterm|addon-fit)$/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: args.path.endsWith("/xterm")
              ? `export class Terminal {constructor(options){this.options=options;this.cols=80;this.rows=24;globalThis.testTerminals.push(this)} loadAddon(){} open(){} write(){} reset(){} dispose(){} onData(fn){this.input=fn}}`
              : `export class FitAddon {fit(){}}`,
          }));
        },
      },
    ],
  });
  const result = spawnSync(
    process.execPath,
    [root + "tests/components/client.mjs"],
    {
      stdio: "inherit",
      env: { ...process.env, CODEX_COMPONENT_BUNDLE: cache + "/client.mjs" },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(cache, { recursive: true, force: true });
}
