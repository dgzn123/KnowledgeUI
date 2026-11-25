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

const driverBinary = process.env.CHROMEDRIVER_BIN ?? "chromedriver";
const driverVersion = spawnSync(driverBinary, ["--version"], { encoding: "utf8" });
const chromium = process.env.KUI_CHROMIUM ?? process.env.CHROMIUM_BIN;

async function driverPort(driver) {
  let output = "";
  driver.stdout.setEncoding("utf8");
  driver.stdout.on("data", chunk => { output += chunk; });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && driver.exitCode === null) {
    const port = /started successfully on port (\d+)\./.exec(output)?.[1];
    if (port) return port;
    await delay(25);
  }
  throw new Error("ChromeDriver could not start. " + output);
}

const chart = fields => ({ version: 1, type: "chart", xAxis: {}, yAxis: {}, ...fields });
const fn = (expr, samples) => ({ type: "function", expr, samples });

test("injected chart runtime in Chromium", {
  skip: driverVersion.status !== 0 && "ChromeDriver is unavailable.",
  timeout: 60_000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), "kui-chart-browser-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const [script, ...css] = await Promise.all([
    bundle("tests/chart/fixtures/browser.mjs", { format: "iife", alias: { obsidian: "./tests/runtime/fixtures/obsidian.mjs" } }),
    ...["styles/index.css", "components/chart/styles.css", "components/controls/styles.css"].map(
      path => readFile(new URL("../../src/" + path, import.meta.url), "utf8"),
    ),
  ]);
  await Promise.all([
    writeFile(join(dir, "index.html"), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><script defer src="fixture.js"></script>'),
    writeFile(join(dir, "fixture.js"), script.outputFiles[0].contents),
    writeFile(join(dir, "fixture.css"), css.join("\n") + "\nbody { margin: 0; } .chart-fixture { padding-inline: 12px; }"),
  ]);

  const driver = spawn(driverBinary, ["--port=0"], { stdio: ["ignore", "pipe", "inherit"] });
  let session;
  let base;
  t.after(async () => {
    try {
      if (session) await send(session, undefined, "DELETE");
    } finally {
      if (driver.exitCode === null && driver.signalCode === null) {
        const closed = once(driver, "exit");
        driver.kill();
        await closed;
      }
    }
  });
  base = "http://127.0.0.1:" + await driverPort(driver);

  async function send(route, data, method = data === undefined ? "GET" : "POST") {
    const response = await fetch(base + route, {
      method, headers: { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10_000),
    });
    const { value } = await response.json();
    if (!response.ok) throw new Error(value?.message ?? response.statusText);
    return value;
  }

  const browser = await send("/session", { capabilities: { alwaysMatch: {
    browserName: "chrome",
    "goog:chromeOptions": {
      ...(chromium && { binary: chromium }),
      args: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--window-size=1100,900"],
    },
  } } });
  session = "/session/" + browser.sessionId;
  t.diagnostic("Chromium " + browser.capabilities.browserVersion + " · " + driverVersion.stdout.trim());
  const run = (script, ...args) => send(session + "/execute/sync", { script, args });
  const after = () => send(session + "/execute/async", { script: "charts.afterUpdates().then(arguments[0]);", args: [] });
  const devtools = (cmd, params) => send(session + "/goog/cdp/execute", { cmd, params });
  const key = value => send(session + "/actions", { actions: [{ type: "key", id: "keyboard",
    actions: [{ type: "keyDown", value }, { type: "keyUp", value }] }] });
  await send(session + "/url", { url: pathToFileURL(join(dir, "index.html")).href });

  await t.test("Gallery renders all five series, annotations and units at 375px in light and dark", async () => {
    await devtools("Emulation.setDeviceMetricsOverride", { width: 375, height: 780, deviceScaleFactor: 1, mobile: true });
    const markdown = await readFile(new URL("../../examples/gallery/chart.md", import.meta.url), "utf8");
    assert.deepEqual(await run("charts.blocks = charts.gallery(arguments[0]); return charts.blocks.map(block => block.handle.diagnostics());", markdown), [[], [], []]);
    const colors = [];
    for (const theme of ["theme-light", "theme-dark"]) {
      await run("document.body.className = arguments[0];", theme);
      await after();
      const state = await run(`
        const {widget, svg, shapes, groups, clip} = charts.elements(charts.blocks[0]);
        return {
          viewport: innerWidth, content: document.documentElement.scrollWidth, width: svg.getBoundingClientRect().width,
          yLabel: widget.querySelector(".kui-chart-axis-label").textContent,
          series: groups.map(group => group.dataset.type),
          geometry: shapes.every(shape => shape.getTotalLength() >= 0 && !/NaN|Infinity/.test(shape.getAttribute("d"))),
          area: widget.querySelector(".kui-chart-area").getTotalLength() > 0,
          annotation: [...widget.querySelectorAll(".kui-chart-region,.kui-chart-reference")].map(node => node.getAttribute("visibility")),
          legend: widget.querySelectorAll('[aria-label="Chart legend"] li:not([hidden])').length,
          clip: +clip.getAttribute("width"),
          color: getComputedStyle(shapes[1]).fill,
        };
      `);
      assert.equal(state.viewport, 375);
      assert.equal(state.content, 375);
      assert.equal(state.width, 351);
      assert.deepEqual(state.series, ["area", "bar", "line", "scatter"]);
      assert.equal(state.yLabel, "读数 (单位)");
      assert.ok(state.geometry && state.area && state.clip > 200);
      assert.deepEqual(state.annotation, ["visible", "visible"]);
      assert.equal(state.legend, 4);
      colors.push(state.color);
    }
    assert.deepEqual(colors, ["rgb(23, 94, 163)", "rgb(150, 199, 255)"]);
    const resized = await run("charts.blocks[0].container.style.inlineSize = '280px'; return charts.elements(charts.blocks[0]).svg.viewBox.baseVal.width;");
    await after();
    assert.equal(resized, 351);
    assert.equal(await run("return charts.elements(charts.blocks[0]).svg.viewBox.baseVal.width;"), 280);
    assert.deepEqual(await run(`
      const {groups, shapes, svg} = charts.elements(charts.blocks[2]);
      const samples = charts.blocks[2].calls;
      const at = [0, 32, 64, 96].map(index => Math.round(samples[index].x));
      const ticks = [...svg.querySelectorAll('.kui-chart-grid g[visibility="visible"] text')].slice(-4).map(node => node.textContent);
      return [groups.map(group => group.dataset.type), at, shapes[0].getTotalLength() > 0, ticks];
    `), [["function", "scatter"], [1, 10, 100, 1000], true, ["1", "10", "100", "1000"]]);
    await run("charts.blocks.forEach(block => { block.handle.dispose(); block.container.remove(); });");
  });

  await t.test("singular, non-numeric and non-positive samples create gaps with bounded diagnostics", async () => {
    const summary = script => run(`
      const block = charts.mount(arguments[0]);
      const {shapes} = charts.elements(block);
      return [shapes.map(shape => (shape.getAttribute("d").match(/M/g) ?? []).length),
        block.handle.diagnostics().map(item => [item.code, item.severity, item.path, Boolean(item.range)]),
        shapes.every(shape => !/NaN|Infinity/.test(shape.getAttribute("d")))];
    `, script);
    assert.deepEqual(await summary(chart({
      xAxis: { min: -1, max: 1 }, yAxis: { min: -12, max: 12 },
      series: [fn("1/x", 9), fn("sqrt(-1)", 11), fn("'4'", 11), fn("1/(x - 0.1)", 11)],
    })), [[2, 0, 0, 2], [
      ["render.chart-function-sample", "warning", ["series", 0, "expr"], true],
      ["render.chart-function-sample", "error", ["series", 1, "expr"], true],
      ["render.chart-function-sample", "error", ["series", 2, "expr"], true],
    ], true]);
    assert.deepEqual(await summary(chart({
      xAxis: { min: -1, max: 1 }, yAxis: { min: -1, max: 2 }, series: [fn("x < 0 ? 0 : 1", 11)],
    })), [[2], [], true]);
    assert.deepEqual(await summary(chart({
      xAxis: { min: -1, max: 1 }, yAxis: { scale: "log", min: 0.1, max: 10 }, series: [fn("x", 9)],
    })), [[1], [["render.chart-function-sample", "warning", ["series", 0, "expr"], true]], true]);
  });

  await t.test("working point, series dependencies, frame coalescing and focus stay local", async () => {
    const dynamic = {
      ...chart({ version: undefined, title: "Curve", ariaLabel: "Inspect the curve",
        xAxis: { label: "Input", unit: "s", min: 0, max: 4 }, yAxis: { label: "Output", unit: "m", min: 0, max: 12 },
        series: [{ ...fn("factor * x", 5), label: "Changing" }, { ...fn("x", 5), label: "Fixed" }],
        markers: [{ x: "{{position}}", y: "{{value}}", label: "Current {{value}}" }],
      }),
    };
    await run(`
      charts.dynamic = charts.mount(arguments[0], true);
      charts.original = charts.elements(charts.dynamic);
      charts.mutations = [0, 0];
      charts.original.shapes.forEach((shape, index) => new MutationObserver(records => {
        charts.mutations[index] += records.length;
      }).observe(shape, {attributes: true, attributeFilter: ["d"]}));
      charts.previous = document.createElement("button");
      charts.original.surface.before(charts.previous);
      charts.previous.focus();
    `, { version: 1, type: "interactive",
      state: { factor: { type: "number", default: 1 }, position: { type: "number", default: 2 } },
      computed: { value: "factor * position" }, layout: dynamic });
    await key("\uE004"); // Tab
    assert.equal(await run("charts.previous.remove(); return document.activeElement === charts.original.surface;"), true);
    await key("\uE010"); // End
    assert.match(await run("return charts.original.output.textContent;"), /Fixed · Input 4 s · Output 4 m/);
    assert.deepEqual(await run(`
      const {stores, calls} = charts.dynamic;
      stores[0].set("factor", 2);
      stores[0].set("factor", 1);
      stores[0].set("factor", 3);
      stores[0].set("position", 3);
      return [calls.length, charts.mutations];
    `), [10, [0, 0]]);
    await after();
    assert.deepEqual(await run(`
      const {stores, calls, handle} = charts.dynamic;
      const {shapes, marker, surface, clip} = charts.elements(charts.dynamic);
      const x = (marker.cx.baseVal.value - clip.x.baseVal.value) / clip.width.baseVal.value;
      const y = 1 - (marker.cy.baseVal.value - clip.y.baseVal.value) / clip.height.baseVal.value;
      return [stores[0].get("value"), x, y, calls.filter(call => call.expr === "factor * x").length,
        calls.filter(call => call.expr === "x").length, shapes.every((shape, i) => shape === charts.original.shapes[i]),
        marker === charts.original.marker, document.activeElement === surface,
        getComputedStyle(surface).outlineWidth, charts.mutations, handle.diagnostics()];
    `), [9, 0.75, 0.75, 10, 5, true, true, true, "2px", [1, 0], []]);
    await key("\uE011"); // Home
    assert.match(await run("return charts.original.output.textContent;"), /Changing · Input 0 s · Output 0 m/);
    await key("\uE014"); // Right Arrow
    assert.match(await run("return charts.original.output.textContent;"), /Fixed · Input 0 s · Output 0 m/);
    await key("\uE00C"); // Escape
    assert.equal(await run("return charts.original.output.textContent;"), "");
    await run("charts.dynamic.stores[0].set('position', 2);");
    await after();
    assert.equal(await run("return charts.dynamic.calls.length;"), 15);
  });

  await t.test("mouse and emulated touch select a marker, and the Obsidian adapter isolates editor events", async () => {
    const position = await run(`
      const {marker, svg, surface} = charts.original;
      surface.scrollIntoView({block: "center"});
      const box = svg.getBoundingClientRect();
      charts.dynamic.events.length = 0;
      return {x: Math.round(box.left + marker.cx.baseVal.value), y: Math.round(box.top + marker.cy.baseVal.value)};
    `);
    await devtools("Input.dispatchMouseEvent", { type: "mouseMoved", ...position });
    assert.match(await run("return charts.original.output.textContent;"), /Current 6 · Input 2 s · Output 6 m/);
    await devtools("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    assert.equal(await run("return charts.original.output.textContent;"), "");
    await devtools("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await devtools("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [position] });
    await devtools("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await after();
    assert.deepEqual(await run("return [charts.original.output.textContent, charts.dynamic.events];"),
      ["Current 6 · Input 2 s · Output 6 m", []]);
  });

  await t.test("bound coordinates, arrays, annotations and domain errors recover without replacing the chart", async () => {
    await run("charts.invalid = charts.mount(arguments[0]); charts.invalidRoot = charts.elements(charts.invalid).widget;", {
      version: 1, type: "interactive", state: { mode: { type: "number", default: 0 } },
      data: { valid: [{ x: 2, y: 2 }], invalid: [{ x: 2, y: 2, extra: 1 }] },
      layout: chart({ version: undefined,
        xAxis: { min: 1, max: 4 },
        yAxis: { scale: "log", min: "{{mode == 1 ? 0 : 1}}", max: 10 },
        series: [
          { type: "line", points: [{ x: "{{mode == 2 ? '3' : 3}}", y: "{{mode == 2 ? -1 : 4}}" }, { x: 4, y: 5 }] },
          { type: "scatter", points: "{{mode == 3 ? invalid : valid}}" },
        ],
        markers: [{ x: "{{mode == 2 ? 10 : 3}}", y: 6 }],
        referenceLines: [{ axis: "y", value: "{{mode == 2 ? 20 : 8}}" }],
        regions: [{ axis: "x", from: "{{mode == 2 ? 4 : 2}}", to: 3 }],
      }),
    });
    for (const [state, expected] of [[0, ["1", "visible", true]], [1, ["0", "hidden", true]],
      [2, ["1", "hidden", true]], [3, ["1", "visible", false]], [0, ["1", "visible", true]]]) {
      await run("charts.invalid.stores[0].set('mode', arguments[0]);", state);
      await after();
      assert.deepEqual(await run(`
        const {widget, svg, marker, shapes} = charts.elements(charts.invalid);
        if (widget !== charts.invalidRoot) throw new Error("Chart remounted");
        return [svg.getAttribute("opacity"), marker.getAttribute("visibility"), shapes[1].getAttribute("d") !== ""];
      `), expected);
    }
    const diagnostics = await run("return charts.invalid.handle.diagnostics();");
    assert.deepEqual(diagnostics.map(({ code, path }) => [code, path.join("/")]).sort(), [
      ["render.chart-log-value", "layout/yAxis/min"],
      ["expression.binding-type", "layout/series/0/points/0/x"],
      ["render.chart-log-value", "layout/series/0/points/0/y"],
      ["render.chart-axis-value", "layout/markers/0/x"],
      ["render.chart-axis-value", "layout/referenceLines/0/value"],
      ["render.chart-region-range", "layout/regions/0"],
      ["expression.binding-type", "layout/series/1/points"],
    ].sort());
    assert.ok(diagnostics.every(item => item.range && item.sourceId === "fixture.md"));
  });

  await t.test("exact runtime budget and overflow from a bound point list", async () => {
    const maximum = chart({ series: Array.from({ length: 4 }, () => fn("x", 512)) });
    assert.deepEqual(await run(`
      const block = charts.mount(arguments[0]); return [block.calls.length, block.handle.diagnostics()];
    `, maximum), [2048, []]);
    const bound = {
      version: 1, type: "interactive", data: { points: [{ x: 0, y: 0 }] },
      layout: { ...maximum, version: undefined, series: [{ type: "scatter", points: "{{points}}" }, ...maximum.series] },
    };
    assert.deepEqual(await run(`
      const block = charts.mount(arguments[0]);
      return [block.calls.length, charts.elements(block).groups.at(-1).getAttribute("visibility"),
        block.handle.diagnostics().map(({code, path}) => [code, path])];
    `, bound), [1536, "hidden", [["render.chart-sample-budget", ["layout", "series", 4]]]]);
    const perSeries = {
      ...bound, data: { points: Array.from({ length: 513 }, () => ({ x: 1, y: 1 })) },
      layout: { ...bound.layout, series: [{ type: "scatter", points: "{{points}}" }] },
    };
    assert.deepEqual(await run(`
      const block = charts.mount(arguments[0]);
      return [charts.elements(block).shapes[0].getAttribute("d"),
        block.handle.diagnostics().map(({code, path}) => [code, path])];
    `, perSeries), ["", [["expression.binding-type", ["layout", "series", 0, "points"]]]]);
  });

  await t.test("disposing the chart drops listeners, pending samples and the resize observer", async () => {
    const before = await run(`
      const {stores, handle, calls} = charts.dynamic;
      charts.disconnectedBefore = charts.disconnected;
      stores[0].set("factor", 2);
      handle.dispose();
      handle.dispose();
      const event = new KeyboardEvent("keydown", {key: "Home", bubbles: true, cancelable: true});
      charts.original.surface.dispatchEvent(event);
      return [calls.length, charts.disconnected - charts.disconnectedBefore, event.defaultPrevented, charts.original.widget.isConnected];
    `);
    assert.deepEqual(before, [15, 1, false, false]);
    await after();
    assert.equal(await run("return charts.dynamic.calls.length;"), 15);
  });
});
