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

const binary = process.env.CHROMEDRIVER_BIN ?? "chromedriver";
const driverVersion = spawnSync(binary, ["--version"], { encoding: "utf8" });
const chromium = process.env.KUI_CHROMIUM ?? process.env.CHROMIUM_BIN;

async function waitFor(action) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const result = await action();
    if (result) return result;
    await delay(25);
  }
  throw new Error("Browser condition timed out.");
}

test("injected dynamic runtime in Chromium with shared styles and native controls", {
  skip: driverVersion.status !== 0 && "ChromeDriver is unavailable.",
  timeout: 60_000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), "kui-controls-browser-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const [script, css, controls, collision] = await Promise.all([
    bundle("tests/state/fixtures/browser.mjs", { format: "iife",
      alias: { obsidian: "./tests/runtime/fixtures/obsidian.mjs" } }),
    readFile(new URL("../../src/styles/index.css", import.meta.url)),
    readFile(new URL("../../src/components/controls/styles.css", import.meta.url)),
    readFile(new URL("./fixtures/scope-collision.yaml", import.meta.url), "utf8"),
  ]);
  await Promise.all([
    writeFile(join(dir, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><script defer src="fixture.js"></script>'),
    writeFile(join(dir, "fixture.js"), script.outputFiles[0].contents),
    writeFile(join(dir, "styles.css"), Buffer.concat([css, Buffer.from("\n"), controls])),
  ]);
  const driver = spawn(binary, ["--port=0"], { stdio: ["ignore", "pipe", "inherit"] });
  let server;
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
    }
  });
  let output = "";
  driver.stdout.setEncoding("utf8");
  driver.stdout.on("data", chunk => { output += chunk; });
  const port = await waitFor(() => /started successfully on port (\d+)\./.exec(output)?.[1]);
  server = "http://127.0.0.1:" + port;

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
      ...(chromium !== undefined && { binary: chromium }),
      args: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--window-size=1200,1000"],
    },
  } } });
  session = "/session/" + browser.sessionId;
  t.diagnostic("Chromium " + browser.capabilities.browserVersion);
  const evaluate = (script, ...args) => send(session + "/execute/sync", { script, args });
  const asyncEvaluate = (script, ...args) => send(session + "/execute/async", { script, args });
  const frame = () => asyncEvaluate("const done = arguments[0]; controls.afterFrame().then(done);");
  const fixture = await readFile(new URL("./fixtures/controls.yaml", import.meta.url), "utf8");
  await send(session + "/url", { url: pathToFileURL(join(dir, "index.html")).href });
  await evaluate("controls.setup(arguments[0]);", fixture);
  const keyboard = key => send(session + "/actions", { actions: [{ type: "key", id: "keyboard",
    actions: [{ type: "keyDown", value: key }, { type: "keyUp", value: key }] }] });
  const devtools = (cmd, params) => send(session + "/goog/cdp/execute", { cmd, params });

  await t.test("typed bindings, static repeat, keyboard and independent mounts", async () => {
    assert.deepEqual(await evaluate("return controls.first.handle.diagnostics();"), []);
    assert.deepEqual(await evaluate("return controls.second.handle.diagnostics();"), []);
    const result = await evaluate(
      "const first = controls.first.container; return [first.querySelector('.kui-interactive-title').textContent,"
      + "Array.from(first.querySelectorAll('.kui-text-content'), node => node.textContent)];",
    );
    assert.deepEqual(result, ["Items 0", ["Mode A {{draft}} end }}", "Row 0 · First"]]);
    await keyboard("\uE004"); // Tab
    assert.equal(await evaluate("return document.activeElement.matches('.kui-slider input:focus-visible');"), true);
    assert.equal(await evaluate("return getComputedStyle(document.activeElement).outlineWidth;"), "2px");
    await keyboard("\uE014"); // Right Arrow
    await frame();
    assert.deepEqual(await evaluate(
      "return [controls.first.stores[0].get('amount'), controls.second.stores[0].get('amount'),"
      + "controls.first.container.querySelector('.kui-number-input input').value, document.activeElement.type];",
    ), [1, 0, "1", "range"]);
  });

  await t.test("coalesced updates retain nodes and focus while controls stay in sync", async () => {
    const before = await evaluate(
      "const first = controls.first.container;"
      + "controls.metric = first.querySelector('.kui-metric-value'); controls.input = first.querySelector('[type=range]');"
      + "controls.writes = 0; new MutationObserver(records => controls.writes += records.length)"
      + ".observe(controls.metric, {childList: true, characterData: true, subtree: true});"
      + "controls.first.stores[0].set('amount', 2); controls.first.stores[0].set('amount', 0); controls.first.stores[0].set('amount', 2);"
      + "return [controls.metric.textContent, controls.writes];",
    );
    assert.deepEqual(before, ["2", 0]);
    await frame();
    const after = await evaluate(
      "const first = controls.first.container;"
      + "return [controls.writes, controls.metric === first.querySelector('.kui-metric-value'), controls.metric.textContent,"
      + "document.activeElement === controls.input, first.querySelector('.kui-number-input input').value,"
      + "first.querySelector('option:last-child').textContent];",
    );
    assert.deepEqual(after, [1, true, "4", true, "2", "Second 4"]);
    await evaluate(
      "const first = controls.first.container; const entry = first.querySelector('.kui-number-input input');"
      + "entry.value = '1'; entry.dispatchEvent(new Event('change'));"
      + "const select = first.querySelector('select'); select.selectedIndex = 1; select.dispatchEvent(new Event('change'));",
    );
    await frame();
    assert.deepEqual(await evaluate(
      "return [controls.input.value, controls.metric.textContent, controls.first.stores[0].get('mode')];",
    ), ["1", "2", "B"]);
    await evaluate("controls.first.container.querySelector('.kui-button').click();");
    await frame();
    assert.equal(await evaluate("return controls.metric.textContent;"), "4");
  });

  await t.test("touch activation, host event isolation and nested when preserve independent state", async () => {
    await devtools("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const point = await evaluate(
      "const toggle = controls.first.container.querySelector('.kui-toggle input');"
      + "toggle.scrollIntoView({block: 'center'}); const box = toggle.getBoundingClientRect();"
      + "return {x: box.left + box.width / 2, y: box.top + box.height / 2};",
    );
    await devtools("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await devtools("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await frame();
    assert.deepEqual(await evaluate(
      "const {container, stores} = controls.first;"
      + "const titles = container.querySelectorAll('.kui-interactive-title');"
      + "return [stores[0].get('shown'), stores[1].get('amount'), controls.hostEvents, titles[1].textContent];",
    ), [true, 10, [], "Nested 10"]);
    await evaluate(
      "const toggle = controls.first.container.querySelector('.kui-toggle input');"
      + "controls.nested = controls.first.stores[1]; toggle.click();",
    );
    await frame();
    assert.deepEqual(await evaluate(
      "const {container} = controls.first; return [container.querySelectorAll('.kui-interactive').length,"
      + "controls.nested.set('amount', 12).diagnostics[0].code, controls.metric.isConnected];",
    ), [1, "state.disposed", true]);
  });

  await t.test("quiz uses native radio interaction and shows instance-local explanations", async () => {
    await evaluate("const answer = controls.first.container.querySelector('.kui-quiz input'); answer.focus();");
    await keyboard("\uE00D"); // Space
    assert.match(await evaluate("return controls.first.container.querySelector('.kui-quiz-feedback').textContent;"), /Incorrect.*Try the other option/);
    await keyboard("\uE014"); // Right Arrow
    assert.match(await evaluate("return controls.first.container.querySelector('.kui-quiz-feedback').textContent;"), /Correct.*Chosen 4.*End of exercise/);
    assert.equal(await evaluate("return controls.second.container.querySelector('.kui-quiz input:checked') === null;"), true);
  });

  await t.test("stepper advances, reverses, resets, pauses, autoplays and cleans up", async () => {
    const operate = script => evaluate("const stepper = controls.first.container.querySelector('.kui-stepper');"
      + "const [previous, next, reset, play] = stepper.querySelectorAll('button');"
      + "const store = controls.first.stores[0];" + script);
    assert.equal(await operate("return previous.getAttribute('aria-disabled');"), "true");
    assert.equal(await operate("next.click(); return store.get('step');"), 1);
    await frame();
    assert.equal(await operate("previous.click(); return store.get('step');"), 0);
    await frame();
    assert.equal(await operate("play.click(); return play.textContent;"), "Pause");
    await waitFor(() => operate("return store.get('step') > 0;"));
    const paused = await operate("if (play.textContent === 'Pause') play.click(); return store.get('step');");
    await delay(250);
    assert.equal(await operate("return store.get('step');"), paused);
    assert.equal(await operate("reset.click(); return store.get('step');"), 0);
    await frame();
    await operate("next.focus(); next.click(); next.click();");
    await frame();
    assert.deepEqual(await operate("return [store.get('step'), document.activeElement === next, next.getAttribute('aria-disabled')];"), [2, true, "true"]);
    await evaluate("controls.auto = controls.mount(arguments[0]);", fixture.replace("intervalMs: 200", "intervalMs: 200\n      autoplay: true"));
    await waitFor(() => evaluate("return controls.auto.stores[0].get('step') === 2;"));
    assert.equal(await evaluate("return controls.auto.container.querySelector('.kui-stepper button:last-child').textContent;"), "Play");
    const initial = await evaluate(
      "const {handle, container, stores} = controls.auto; const [, , reset, play] = container.querySelectorAll('.kui-stepper button');"
      + "reset.click(); play.click(); container.querySelector('.kui-button').click();"
      + "controls.detached = container.querySelector('.kui-metric-value'); handle.dispose(); return stores[0].get('step');",
    );
    await delay(250);
    assert.equal(initial, 0);
    assert.deepEqual(await evaluate(
      "return [controls.auto.stores[0].get('step'), controls.auto.container.childElementCount, controls.detached.textContent];",
    ), [0, 0, "0"]);
  });

  await t.test("runtime rejects type-mismatched bindings without remounting siblings", async () => {
    const result = await evaluate(
      "const block = controls.mount(arguments[0]); return [block.handle.diagnostics(), Boolean(block.container.querySelector('.kui-slider'))];",
      fixture.replace("title: \"Items {{amount}}\"", "title: '{{amount}}'"),
    );
    assert.equal(result[1], true);
    assert.deepEqual(result[0].map(item => [item.code, item.path]), [["expression.binding-type", ["title"]]]);
  });

  await t.test("a repeated interactive evaluates its condition outside and uses independent state inside", async () => {
    const result = await evaluate(
      "const accepted = controls.protocol.read({yaml: arguments[0]}); const block = controls.mount(arguments[0]);"
      + "controls.repeated = block;"
      + "return [accepted.ok, block.handle.diagnostics(),"
      + "Array.from(block.container.querySelectorAll('.kui-interactive-title'), node => node.textContent),"
      + "block.container.querySelector('input').value, block.stores[0].get('item') ?? null];", collision,
    );
    assert.deepEqual(result, [true, [], ["Own 7"], "7", null]);
    await evaluate(
      "const input = controls.repeated.container.querySelector('input');"
      + "input.value = '8'; input.dispatchEvent(new Event('change'));",
    );
    await frame();
    assert.deepEqual(await evaluate(
      "const block = controls.repeated; return [block.stores[1].get('item'),"
      + "block.container.querySelector('.kui-interactive-title').textContent, block.handle.diagnostics()];",
    ), [8, "Own 8", []]);
  });
});
