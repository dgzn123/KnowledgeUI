import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { bundle } from "../runtime/serve.mjs";

const binary = process.env.CHROMEDRIVER_BIN ?? "chromedriver";
const available = spawnSync(binary, ["--version"], { encoding: "utf8" });
const chromium = process.env.KUI_CHROMIUM ?? process.env.CHROMIUM_BIN;

async function waitFor(read) {
  const deadline = Date.now() + 5000;
  do {
    const value = await read();
    if (value) return value;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for the browser fixture.");
}

test("extension runtime in Chromium with injected component and symbol directories", {
  skip: available.status !== 0 && "ChromeDriver unavailable",
  timeout: 30_000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), "kui-extensions-"));
  const driver = spawn(binary, ["--port=0"], { stdio: ["ignore", "pipe", "inherit"] });
  let session;
  t.after(async () => {
    try {
      if (session) await send(session, undefined, "DELETE");
    } finally {
      if (driver.exitCode === null && driver.signalCode === null) {
        const closed = once(driver, "exit");
        driver.kill();
        await closed;
      }
      await rm(dir, { recursive: true, force: true, maxRetries: 2 });
    }
  });
  let output = "";
  driver.stdout.setEncoding("utf8");
  driver.stdout.on("data", chunk => { output += chunk; });
  const fixture = await bundle("tests/extensions/fixtures/browser.mjs", { format: "iife", loader: { ".md": "text" } });
  const page = join(dir, "index.html");
  await Promise.all([
    writeFile(page, '<!doctype html><meta charset="utf-8"><script defer src="fixture.js"></script>'),
    writeFile(join(dir, "fixture.js"), fixture.outputFiles[0].contents),
  ]);
  const port = await waitFor(() => /started successfully on port (\d+)\./.exec(output)?.[1]);

  async function send(route, data, method = "POST") {
    const response = await fetch("http://127.0.0.1:" + port + route, {
      method, headers: { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(8000),
    });
    const { value } = await response.json();
    if (!response.ok) throw new Error(value?.message ?? response.statusText);
    return value;
  }

  const browser = await send("/session", { capabilities: { alwaysMatch: {
    browserName: "chrome",
    "goog:chromeOptions": {
      ...(chromium && { binary: chromium }),
      args: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
        "--user-data-dir=" + join(dir, "profile")],
    },
  } } });
  t.diagnostic("Chromium " + browser.capabilities.browserVersion);
  session = "/session/" + browser.sessionId;
  await send(session + "/url", { url: pathToFileURL(page).href });
  const results = await waitFor(() => send(session + "/execute/sync", {
    script: "return globalThis.extensionResults ?? null;", args: [],
  }));
  assert.equal(results.length, 6);
  for (const { name, error } of results) {
    await t.test(name, () => assert.equal(error, undefined, error));
  }
});
