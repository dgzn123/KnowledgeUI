import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { bundle } from "../runtime/serve.mjs";

const driver = process.env.CHROMEDRIVER_BIN ?? "chromedriver";
const driverVersion = spawnSync(driver, ["--version"], { encoding: "utf8" });
const chromium = process.env.KUI_CHROMIUM ?? process.env.CHROMIUM_BIN;

test("injected diagrams in Chromium with the shared runtime and styles", {
  skip: driverVersion.status !== 0 && "ChromeDriver is unavailable.",
  timeout: 45_000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), "kui-diagrams-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const [script, ...styles] = await Promise.all([
    bundle("tests/diagrams/fixtures/browser.mjs", { format: "iife" }),
    ...["styles/index.css", "components/svg/styles.css", "components/graph/styles.css", "components/sequence/styles.css"]
      .map(path => readFile(new URL("../../src/" + path, import.meta.url), "utf8")),
  ]);
  await Promise.all([
    writeFile(join(dir, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><script src="fixture.js" defer></script>'),
    writeFile(join(dir, "fixture.js"), script.outputFiles[0].contents),
    writeFile(join(dir, "styles.css"), styles.join("\n")),
  ]);
  const job = spawn(driver, ["--port=0"], { stdio: ["ignore", "pipe", "inherit"] });
  let server;
  let session;
  t.after(async () => {
    try {
      if (session) await send(session, undefined, "DELETE");
    } finally {
      if (job.exitCode === null && job.signalCode === null) {
        const closed = once(job, "exit");
        job.kill();
        await closed;
      }
    }
  });
  let output = "";
  job.stdout.setEncoding("utf8");
  job.stdout.on("data", chunk => { output += chunk; });
  for (let attempt = 0; attempt < 160 && !server; attempt++) {
    const match = /started successfully on port (\d+)\./.exec(output);
    if (match) server = "http://127.0.0.1:" + match[1];
    else await delay(25);
  }
  assert.ok(server, output);

  async function send(route, data, method = data === undefined ? "GET" : "POST") {
    const response = await fetch(server + route, { method, headers: { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10_000) });
    const { value } = await response.json();
    if (!response.ok) throw new Error(value?.message ?? response.statusText);
    return value;
  }

  const browser = await send("/session", { capabilities: { alwaysMatch: {
    browserName: "chrome",
    "goog:chromeOptions": {
      ...(chromium && { binary: chromium }),
      args: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--window-size=1200,1000"],
    },
  } } });
  t.diagnostic("Chromium " + browser.capabilities.browserVersion);
  session = "/session/" + browser.sessionId;
  await send(session + "/url", { url: pathToFileURL(join(dir, "index.html")).href });
  const run = method => send(session + "/execute/async", {
    script: `const done = arguments[0]; Promise.resolve().then(() => diagrams.${method}()).then(done, e => done({ error: e.stack }));`, args: [],
  });

  assert.deepEqual(await run("setup"), [[], []]);

  await t.test("local IDs, symbol clipping and SVG text isolation", async () => {
    const actual = await run("identifiers");
    assert.equal(actual.total, 22);
    assert.equal(actual.unique, actual.total);
    assert.deepEqual(actual.explicit, Array(7).fill(true));
    assert.equal(actual.localSymbols, 3);
    assert.equal(actual.rawTags, 0);
    assert.equal(actual.labels[1], "Row 0 <foreignObject>plain text</foreignObject>");
    const hit = await run("clipHitTest");
    assert.equal(hit[0], "rect");
    assert.notEqual(hit[1], "rect");
    assert.deepEqual(await run("clipContainerDiagnostic"), ["semantic.svg-clip-geometry"]);
  });

  await t.test("route families, arrow heads and sequence columns use the declared topology", async () => {
    const [heads, orthogonal, curve, loop, columns] = await run("routes");
    assert.deepEqual(heads, [1, 3, 2, 2]);
    assert.match(orthogonal, /^M 316 48 L 316 79 426 79 426 110 /);
    assert.match(curve, /^M [^C]+ C /);
    assert.match(loop, /^M 132 24 C /);
    assert.deepEqual(columns, [98, 254, 410, 566]);
  });

  await t.test("bound geometry, tone and active rows update in place once per frame", async () => {
    const actual = await run("update");
    assert.deepEqual(actual.writes, ["cx", "points"]);
    assert.deepEqual(actual.svg, [true, true, "120", "335,9 349,25 317,28", "rgb(27, 107, 73)"]);
    assert.deepEqual(actual.graph, [true, true, "translate(280 0)", "M 132 24 L 280 24"]);
    assert.deepEqual(actual.sequence, [true, true, "Receive"]);
    assert.equal(actual.peer, "90");
  });

  await t.test("conditional SVG subtrees, routed edges and sequence rows retain unaffected nodes", async () => {
    const actual = await run("structure");
    assert.deepEqual(actual, {
      hidden: [false, 2, "none", "none", "translate(0 202)"], groups: 4,
      svgUnchanged: true, graphUnchanged: true, sequenceUnchanged: true, returnDash: "5 4",
    });
  });

  await t.test("unsafe bound values and missing endpoints preserve valid attributes and recover", async () => {
    const actual = await run("invalidValues");
    assert.ok(actual.diagnostics.includes("render.svg-clip-target"));
    assert.ok(actual.diagnostics.includes("expression.binding-type"));
    assert.ok(actual.diagnostics.includes("render.graph-overlap"));
    assert.ok(actual.diagnostics.includes("render.graph-endpoint"));
    assert.ok(actual.diagnostics.includes("render.sequence-endpoint"));
    assert.equal(actual.rect[0], "var(--kui-success)");
    assert.match(actual.rect[1], /^url\(#kui-instance-\d+-svg-\d+\)$/);
    assert.equal(actual.path, "M 250 18 h 20");
    assert.deepEqual(actual.visibility, ["none", "none", "none"]);
    assert.equal(actual.remainingSequence, true);
    assert.deepEqual(actual.recovered, [true, "inline", "M 248 18 h 22", "inline"]);
  });

  await t.test("expanded limits and runtime symbol validation isolate failed SVG siblings", async () => {
    assert.deepEqual(await run("budgets"), [
      [800, [], "Sibling"], [0, ["render.svg-element-limit"], "Sibling"],
      [1, ["render.diagram-repeat-limit"], "Sibling"], [1, ["render.diagram-repeat-type"], "Sibling"],
    ]);
    assert.deepEqual(await run("repeatDiagrams"), [
      ["translate(0 0)", "translate(180 0)", "translate(360 0)"], 2, true, ["render.diagram-count-limit"], "Sibling",
    ]);
    assert.deepEqual(await run("runtimeSymbols"), [
      [["render.svg-symbol-invalid"], true, "Sibling"], [["render.svg-symbol-missing"], true, "Sibling"],
    ]);
  });

  await t.test("375px container stays bounded, with focusable scroll and theme colors", async () => {
    const actual = await run("narrow");
    assert.deepEqual(actual.widths, [375, 375, 375]);
    assert.deepEqual(actual.scroll, [true, true]);
    assert.equal(actual.focus, true);
    assert.equal(actual.outer, 375);
    assert.deepEqual([actual.light, actual.dark], ["rgb(23, 94, 163)", "rgb(150, 199, 255)"]);
  });

  await t.test("SVG transitions respect the reduced-motion preference", async () => {
    const motion = async value => {
      await send(session + "/goog/cdp/execute", {
        cmd: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value }] },
      });
      return run("motion");
    };
    assert.equal(await motion("reduce"), "0s");
    assert.equal(await motion("no-preference"), "0.12s");
  });

  await t.test("idempotent disposal cancels pending updates and leaves another diagram mounted", async () => {
    assert.deepEqual(await run("dispose"), [0, "130", "state.disposed", true]);
  });
});
