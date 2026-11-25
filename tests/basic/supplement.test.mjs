import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createActiveProtocol } from "../../src/composition/protocol.ts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { bundle } from "../runtime/serve.mjs";

const protocol = createActiveProtocol();
const tests = [
  [{ type: "table", columns: [{ label: "A" }, { label: "B" }], rows: [[1]] }, "semantic.table-row-width", ["rows", 0]],
  [{ type: "progress", value: 2 }, "semantic.progress-range", ["value"]],
  [{ type: "tabs", initial: 1, tabs: [{ title: "Only", children: [{ type: "divider" }] }] }, "semantic.tabs-initial", ["initial"]],
];

test("supplemental protocol rejects row width, progress range and tab index mismatches with source locations", () => {
  for (const [node, code, path] of tests) {
    const result = protocol.read({ yaml: JSON.stringify({ version: 1, ...node }), sourceId: "Invalid.md" });
    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnostics.map(item => [item.code, item.path]), [[code, path]]);
    assert.equal(result.diagnostics[0].sourceId, "Invalid.md");
    assert.ok(result.diagnostics[0].range);
  }
});

test("the production protocol and scanner accept the supplemental Gallery", () => {
  const source = readFileSync(new URL("../../examples/gallery/basic-supplement.md", import.meta.url), "utf8");
  const blocks = markdownBlockScanner.scan(source);
  assert.equal(blocks.ok, true);
  assert.equal(blocks.value.length, 3);
  for (const block of blocks.value) {
    const result = protocol.read(block);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
  }
});

const driverBinary = process.env.CHROMEDRIVER_BIN ?? "chromedriver";
const available = spawnSync(driverBinary, ["--version"], { encoding: "utf8" });

test("Chromium renders supplemental components with shared bindings, slots and lifetimes", {
  skip: available.status !== 0 && "ChromeDriver unavailable",
  timeout: 25_000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), "kui-basic-supplement-"));
  const driver = spawn(driverBinary, ["--port=0"], { stdio: ["ignore", "pipe", "inherit"] });
  let origin;
  let session;
  t.after(async () => {
    try {
      if (session) await send(session, undefined, "DELETE");
    } finally {
      if (driver.exitCode === null && driver.signalCode === null) {
        const exit = once(driver, "exit");
        driver.kill();
        await exit;
      }
      await rm(dir, { recursive: true, force: true, maxRetries: 2 });
    }
  });
  let output = "";
  driver.stdout.setEncoding("utf8");
  driver.stdout.on("data", chunk => { output += chunk; });

  async function waitFor(read) {
    const deadline = Date.now() + 7_000;
    while (Date.now() < deadline) {
      const value = await read();
      if (value) return value;
      await delay(25);
    }
    assert.fail("The browser fixture did not finish.");
  }

  async function send(route, data, method = "POST") {
    const response = await fetch(origin + route, {
      method, headers: { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(8_000),
    });
    const { value } = await response.json();
    assert.ok(response.ok, value?.message ?? response.statusText);
    return value;
  }

  const fixture = await bundle("tests/basic/fixtures/supplement.mjs", { format: "iife", loader: { ".md": "text" } });
  const page = join(dir, "index.html");
  await Promise.all([
    writeFile(page, '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><script defer src="fixture.js"></script>'),
    writeFile(join(dir, "fixture.js"), fixture.outputFiles[0].contents),
    writeFile(join(dir, "styles.css"), readFileSync(new URL("../../src/styles/index.css", import.meta.url))),
  ]);
  const port = await waitFor(() => /started successfully on port (\d+)\./.exec(output)?.[1]);
  origin = "http://127.0.0.1:" + port;
  const chromium = process.env.CHROMIUM_BIN;
  const browser = await send("/session", { capabilities: { alwaysMatch: {
    browserName: "chrome",
    "goog:chromeOptions": {
      ...(chromium && { binary: chromium }),
      args: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
        "--user-data-dir=" + join(dir, "profile")],
    },
  } } });
  session = "/session/" + browser.sessionId;
  await send(session + "/url", { url: pathToFileURL(page).href });
  const result = await waitFor(() => send(session + "/execute/sync", {
    script: "return globalThis.supplementResult ?? null;", args: [],
  }));
  assert.deepEqual(result, { passed: true });
});
