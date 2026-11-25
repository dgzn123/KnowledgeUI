import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { bundle } from "../runtime/serve.mjs";

const exec = promisify(execFile);
const chromium = process.env.CHROMIUM_BIN ?? "chromium";
const available = spawnSync(chromium, ["--version"], { encoding: "utf8" });

test("batch D template scope and code token contracts", { skip: available.status !== 0 && "Chromium unavailable" }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "kui-batch-d-contract-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 2 }));
  const fixture = await bundle("tests/integration/fixtures/batch-d-contract.mjs", { format: "iife",
    alias: { obsidian: "./tests/runtime/fixtures/obsidian.mjs" } });
  const page = join(dir, "index.html");
  await Promise.all([
    writeFile(page, '<!doctype html><meta charset="utf-8"><script defer src="fixture.js"></script>'),
    writeFile(join(dir, "fixture.js"), fixture.outputFiles[0].contents),
  ]);
  const { stdout } = await exec(chromium, ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
    "--user-data-dir=" + join(dir, "profile"), "--dump-dom", "--virtual-time-budget=1000", pathToFileURL(page).href,
  ], { timeout: 15_000 });
  const encoded = /<body>([A-Za-z0-9+/=]+)<\/body>/.exec(stdout)?.[1];
  assert.ok(encoded, stdout);
  const result = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.template, {
    diagnostics: [], observed: [[], ["fixture:outer"], [], ["fixture:outer"]],
    values: ["3", "10", "8", "15"], titles: ["Seed 3 · Value 10", "Seed 8 · Value 15"],
    templateState: [{ row: 7, seed: 3, adjusted: 10 }, { row: 7, seed: 8, adjusted: 15 }],
    staticDiagnostics: [["semantic.unknown-identifier", ["computed", "adjusted"]]], secondInstance: 15, disposed: true,
  });
  assert.deepEqual(result.highlight, {
    tokens: [{ text: "<b>`x`", classes: ["template-string", "string", "literal"] }, { text: "\nreturn 1", classes: [] }],
    unknown: null, cancelled: null, browser: false,
  });
});
