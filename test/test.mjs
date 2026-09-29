import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  absWorkingDir: root,
  entryPoints: { bundle: "src/main.ts", features: "test/feature-entry.ts" },
  outdir: "test", outExtension: { ".js": ".mjs" },
  bundle: true, format: "esm", platform: "node",
  external: ["@codemirror/state"],
  alias: Object.fromEntries(Object.entries({
    obsidian: "obsidian", "@codemirror/view": "view",
    "@codemirror/language": "language", "@codemirror/lang-markdown": "lang-markdown",
    "@codemirror/autocomplete": "autocomplete",
  }).map(([name, stub]) => [name, resolve(root, `test/${stub}-stub.mjs`)])),
});
const scripts = readdirSync(resolve(root, "test")).filter((name) => /^run.*\.mjs$/.test(name)).sort();
for (const script of scripts) {
  const result = spawnSync(process.execPath, [resolve(root, "test", script)], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`PASS ${scripts.length} test scripts`);
