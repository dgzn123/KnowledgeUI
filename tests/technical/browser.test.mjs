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

const driverBin = process.env.CHROMEDRIVER_BIN ?? "chromedriver";
const driverVersion = spawnSync(driverBin, ["--version"], { encoding: "utf8" });
const chromium = process.env.KUI_CHROMIUM ?? process.env.CHROMIUM_BIN;
const html = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><script defer src="fixture.js"></script>';

test("technical components in Chromium using the shared runtime and styles", {
  skip: driverVersion.status !== 0 && "ChromeDriver is unavailable.",
  timeout: 60_000,
}, async t => {
  const dir = await mkdtemp(join(tmpdir(), "kui-technical-browser-"));
  const driver = spawn(driverBin, ["--port=0"], { stdio: ["ignore", "pipe", "inherit"] });
  let stdout = "";
  driver.stdout.setEncoding("utf8");
  driver.stdout.on("data", chunk => { stdout += chunk; });
  let base;
  let session;

  async function send(route, body, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(base + route, {
      method, headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const { value } = await response.json();
    if (!response.ok) throw new Error(value?.message ?? response.statusText);
    return value;
  }

  t.after(async () => {
    try {
      if (session) await send(session, undefined, "DELETE");
    } finally {
      if (driver.exitCode === null && driver.signalCode === null) {
        const closed = once(driver, "exit");
        driver.kill();
        await closed;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
  const [script, ...styles] = await Promise.all([
    bundle("tests/technical/fixtures/browser.mjs", { format: "iife",
      alias: { obsidian: "./tests/runtime/fixtures/obsidian.mjs" } }),
    ...["src/styles/index.css", "src/components/controls/styles.css", "src/components/technical/styles.css"]
      .map(file => readFile(new URL("../../" + file, import.meta.url), "utf8")),
  ]);
  await Promise.all([
    writeFile(join(dir, "index.html"), html),
    writeFile(join(dir, "fixture.js"), script.outputFiles[0].contents),
    writeFile(join(dir, "styles.css"), styles.join("\n")),
  ]);
  for (let attempt = 0; attempt < 200 && base === undefined; attempt++) {
    const match = /started successfully on port (\d+)\./.exec(stdout);
    if (match) base = "http://127.0.0.1:" + match[1];
    else if (driver.exitCode !== null) break;
    else await delay(25);
  }
  assert.ok(base, "ChromeDriver failed to start: " + stdout);
  const browser = await send("/session", { capabilities: { alwaysMatch: {
    browserName: "chrome",
    "goog:chromeOptions": {
      ...(chromium !== undefined && { binary: chromium }),
      args: ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--window-size=900,900"],
    },
  } } });
  session = "/session/" + browser.sessionId;
  t.diagnostic("Chromium " + browser.capabilities.browserVersion);
  await send(session + "/url", { url: pathToFileURL(join(dir, "index.html")).href });
  const run = (script, ...args) => send(session + "/execute/sync", { script, args });
  const frame = () => send(session + "/execute/async", {
    script: "technical.afterFrames().then(arguments[0]);", args: [],
  });
  const key = value => send(session + "/actions", { actions: [{ type: "key", id: "keyboard",
    actions: [{ type: "keyDown", value }, { type: "keyUp", value }] }] });
  const devtools = (cmd, params) => send(session + "/goog/cdp/execute", { cmd, params });
  const fixture = await readFile(new URL("./fixtures/stepper.yaml", import.meta.url), "utf8");
  const originalCode = "/* Start\r\n   <strong>literal</strong>\r*/\n\tThis is a narrow layout test. "
    + "This long line should scroll inside the code region, and the rest of the page should stay in place.\n";

  await t.test("browser fallback preserves literal text, line numbers and narrow layout", async () => {
    const initial = await run(`
      const block = technical.block = technical.mount(arguments[0]);
      const root = block.container.querySelector(".kui-code");
      const source = root.querySelector("code");
      const scroll = root.querySelector("pre");
      const rows = [...source.querySelectorAll(".kui-code-line")];
      const tops = rows.map(row => row.getBoundingClientRect().top);
      const height = rows[0].getBoundingClientRect().height;
      return {
        diagnostics: block.handle.diagnostics(), source: source.textContent, markup: Boolean(source.querySelector("strong")),
        fallback: root.dataset.syntax, notice: root.querySelector(".kui-code-syntax-status").textContent,
        numbers: rows.map(row => row.querySelector(".kui-code-number").dataset.line),
        highlighted: technical.highlighted(root),
        tight: scroll.clientWidth <= 375 && scroll.scrollWidth > 2 * scroll.clientWidth && block.container.scrollWidth === 375,
        lineSpacing: tops.slice(1).map((top, index) => Math.abs(top - tops[index] - height) < 1),
      };
    `, fixture);
    assert.deepEqual(initial, {
      diagnostics: [], source: originalCode, markup: false, fallback: "plain",
      notice: "example · Syntax highlighting unavailable", numbers: ["1", "2", "3", "4", "5"],
      highlighted: [1, 2, 3], tight: true, lineSpacing: [true, true, true, true],
    });
    await key("\uE004");
    assert.deepEqual(await run(
      "const e = document.activeElement; return [e.getAttribute('aria-label'), e.matches(':focus-visible'), getComputedStyle(e).outlineWidth];",
    ), ["Sample listing", true, "2px"]);
    assert.equal(await run(`
      const row = technical.block.container.querySelector(".kui-code-line");
      const light = getComputedStyle(row).boxShadow;
      document.body.classList.add("theme-dark");
      return getComputedStyle(row).boxShadow !== light;
    `), true);
  });

  await t.test("real stepper changes only affected code rows and preserves selection, scroll and focus", async () => {
    await run(`
      const block = technical.block;
      const code = block.container.querySelector(".kui-code-source");
      const rows = [...code.querySelectorAll(".kui-code-line")];
      const text = rows[1].querySelector(".kui-code-text").firstChild;
      const scroll = code.parentElement;
      const selection = getSelection();
      selection.setBaseAndExtent(text, 3, text, 19);
      scroll.scrollLeft = 90;
      const mutations = [];
      const observer = new MutationObserver(records => mutations.push(...records.map(record =>
        [record.type, rows.indexOf(record.target) + 1, record.attributeName])));
      observer.observe(code, {subtree: true, attributes: true, childList: true, characterData: true});
      technical.before = {code, rows, text, scroll, selection: selection.toString(), observer, mutations};
      block.container.querySelectorAll(".kui-stepper button")[1].click();
    `);
    await frame();
    assert.deepEqual(await run(`
      const {code, rows, text, scroll, selection, observer, mutations} = technical.before;
      const block = technical.block;
      const intact = rows.every((row, index) => row === code.querySelectorAll(".kui-code-line")[index]);
      observer.disconnect();
      return {
        intact, sameSelection: selection === getSelection().toString() && getSelection().anchorNode === text,
        scroll: scroll.scrollLeft, focused: document.activeElement === scroll, mutations,
        highlight: technical.highlighted(code), title: block.container.querySelector("figcaption").textContent,
        note: block.container.querySelector(".kui-code-annotation-text").textContent,
      };
    `), { intact: true, sameSelection: true, scroll: 90, focused: true,
      mutations: [["attributes", 1, "data-highlighted"], ["attributes", 4, "data-highlighted"]],
      highlight: [2, 3, 4], title: "Step 1", note: "Step 1 <sample>" });
  });

  await t.test("invalid bound highlights clear markers and recover on a valid step", async () => {
    const advance = () => run("technical.block.container.querySelectorAll('.kui-stepper button')[1].click();");
    const state = () => run(`
      const {handle, container} = technical.block;
      const latest = handle.diagnostics().at(-1);
      return [technical.highlighted(container), latest.code, latest.path.slice(3), latest.range.start.line];
    `);
    await run("technical.block.container.querySelectorAll('.kui-stepper button')[1].focus();");
    await key("\uE007");
    await frame();
    assert.deepEqual(await state(), [[], "expression.binding-type", ["highlight"], 22]);
    await advance();
    await frame();
    assert.deepEqual(await state(), [[], "render.code-line-out-of-range", ["highlight", 1], 22]);
    await advance();
    await frame();
    assert.deepEqual(await state(), [[], "render.code-range-order", ["highlight", 0], 22]);
    await advance();
    await frame();
    assert.deepEqual(await run(`
      const {container, stores} = technical.block;
      return [stores[0].get("step"), technical.highlighted(container), document.activeElement.textContent];
    `), [5, [4], "Next"]);
  });

  await t.test("Obsidian API fixture supplies multiline Prism tokens and missing-language fallback", async () => {
    await run(`
      technical.reset();
      technical.tokenCalls = [];
      technical.prismFixture.load = async () => ({
        languages: {example: {}},
        tokenize(code) {
          technical.tokenCalls.push(code);
          const tail = code.indexOf("*/") + 2;
          return [
            {type: "comment", alias: "block", content: [code.slice(0, 9), code.slice(9, tail)]},
            code.slice(tail),
          ];
        },
      });
      const host = technical.obsidianFixture();
      technical.block = technical.mount(arguments[0], host);
      technical.missing = technical.mount(arguments[0].replace("language: example", "language: unavailable"), host);
    `, fixture);
    await frame();
    assert.deepEqual(await run(`
      const root = technical.block.container.querySelector(".kui-code");
      const source = root.querySelector("code");
      return [root.dataset.syntax, source.textContent,
        [...root.querySelectorAll(".token.comment.block")].map(token => token.textContent),
        technical.missing.container.querySelector(".kui-code").dataset.syntax,
        technical.tokenCalls, source.dataset.language, source.matches('[class*="language-"]')];
    `), ["highlighted", originalCode, ["/* Start", "   <strong>literal</strong>", "*/"], "plain", [originalCode], "example", false]);
    await run("technical.block.container.querySelectorAll('.kui-stepper button')[1].click();");
    await frame();
    assert.equal(await run("return technical.tokenCalls.length;"), 1);
  });

  await t.test("terminal displays command, output and error as scrollable literal text", async () => {
    const long = "This is a display-only error. ".repeat(6);
    const yaml = `version: 1
type: interactive
state:
  mode: {type: string, default: preview}
layout:
  type: terminal
  title: "Transcript {{mode}}"
  prompt: ">"
  lines:
    - {kind: command, text: "show {{mode}}"}
    - {kind: output, text: "<output>shown</output>\\n  next line"}
    - {kind: command, prompt: "note {{mode}}:", text: review}
    - {kind: command, prompt: "", text: "no prompt"}
    - {kind: error, prompt: "stderr> ", text: ${JSON.stringify(long)}}
`;
    assert.deepEqual(await run(`
      technical.reset();
      const block = technical.block = technical.mount(arguments[0]);
      const terminal = block.container.querySelector(".kui-terminal");
      const pre = terminal.querySelector("pre");
      const rows = [...terminal.querySelectorAll(".kui-terminal-line")];
      return [
        block.handle.diagnostics(), pre.textContent, rows.map(row => row.dataset.kind),
        terminal.querySelector("figcaption").textContent,
        terminal.querySelector("output, input, button, a") === null,
        pre.scrollWidth > pre.clientWidth && block.container.scrollWidth === 375,
        getComputedStyle(rows[1]).color !== getComputedStyle(rows[4]).color,
      ];
    `, yaml), [[], "> show preview\n<output>shown</output>\n  next line\nnote preview: review\nno prompt\nstderr> " + long,
      ["command", "output", "command", "command", "error"], "Transcript preview", true, true, true]);
    await run("technical.block.stores[0].set('mode', 'review');");
    await frame();
    assert.match(await run("return technical.block.container.querySelector('pre').textContent;"),
      /^> show review\n[\s\S]*\nnote review: review\n/);
  });

  await t.test("native directory disclosures support Tab, Space, touch isolation and independent state", async () => {
    const yaml = `version: 1
type: interactive
state:
  label: {type: string, default: draft}
layout:
  type: file-tree
  title: Archive
  openDepth: 1
  entries:
    - kind: directory
      name: releases
      children:
        - kind: directory
          name: latest
          children:
            - {kind: file, name: "<notes>.md", detail: "Status {{label}}"}
`;
    assert.deepEqual(await run(`
      technical.reset();
      technical.events = [];
      const block = technical.block = technical.mount(arguments[0], technical.obsidianFixture());
      for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "click"]) {
        block.container.addEventListener(type, event => technical.events.push(event.type));
      }
      technical.peer = technical.mount(arguments[0]);
      const dirs = [...block.container.querySelectorAll("details")];
      return [block.handle.diagnostics(), dirs.map(dir => dir.open),
        dirs[0].querySelector("summary").getBoundingClientRect().height >= 44];
    `, yaml), [[], [true, false], true]);
    await key("\uE004");
    await key("\uE004");
    assert.deepEqual(await run("return [document.activeElement.textContent, document.activeElement.matches(':focus-visible')];"),
      ["latest", true]);
    await key("\uE00D");
    assert.deepEqual(await run(`
      const {container, stores} = technical.block;
      stores[0].set("label", "final");
      return [container.querySelectorAll("details")[1].open, technical.peer.container.querySelectorAll("details")[1].open,
        container.querySelector(".kui-file-tree-name").textContent, technical.events];
    `), [true, false, "<notes>.md", []]);
    await frame();
    assert.equal(await run("return technical.block.container.querySelector('.kui-file-tree-detail').textContent;"), "Status final");
    await devtools("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const point = await run(`
      const summary = technical.block.container.querySelector("summary");
      const rect = summary.getBoundingClientRect();
      return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    `);
    await devtools("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await devtools("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.deepEqual(await run(`
      const {container, handle} = technical.block;
      const dirs = [...container.querySelectorAll("details")];
      const list = dirs[0].closest("ul");
      const before = [dirs[0].open, dirs[1].open, [...technical.events]];
      handle.dispose();
      container.append(list);
      dirs[0].querySelector("summary").click();
      list.remove();
      return [before, technical.events, container.childElementCount];
    `), [[false, true, []], ["click"], 0]);
    await devtools("Emulation.setTouchEmulationEnabled", { enabled: false });
  });

  await t.test("changed code and line bindings stay in sync and cancel pending token requests on change and disposal", async () => {
    const yaml = `version: 1
type: interactive
state:
  step: {type: number, default: 0, min: 0, max: 2, step: 1}
data:
  snippets: [first, "second\\nline", "third\\nline\\nline"]
  highlights: [[1], [2], [3]]
layout:
  type: code
  language: example
  code: "{{snippets[step]}}"
  highlight: "{{highlights[step]}}"
`;
    await run(`
      technical.reset();
      technical.block = technical.mountControlledTokens(arguments[0]);
      technical.block.stores[0].set("step", 1);
    `, yaml);
    await frame();
    assert.deepEqual(await run(`
      const {container, requests, handle} = technical.block;
      requests[0].resolve([{text: "first", classes: ["keyword"]}]);
      requests[1].resolve([{text: "wrong text", classes: ["keyword"]}]);
      return [requests.map(r => [r.text, r.language, r.signal.aborted]), technical.highlighted(container), handle.diagnostics()];
    `), [[["first", "example", true], ["second\nline", "example", false]], [2], []]);
    await frame();
    assert.deepEqual(await run(`
      const {container, stores} = technical.block;
      const root = container.querySelector(".kui-code");
      const result = [root.dataset.syntax, root.querySelector("code").textContent, root.querySelector(".token") === null];
      stores[0].set("step", 2);
      return result;
    `), ["plain", "second\nline", true]);
    await frame();
    assert.equal(await run(`
      const {container, requests, stores, handle} = technical.block;
      technical.detached = container.querySelector(".kui-code");
      stores[0].set("step", 1);
      handle.dispose();
      const request = requests[2];
      request.resolve([{text: request.text, classes: ["keyword"]}]);
      return request.signal.aborted;
    `), true);
    await frame();
    assert.deepEqual(await run(`
      const {container, requests, stores, handle} = technical.block;
      return [container.childElementCount, requests.length, technical.detached.dataset.syntax,
        technical.detached.querySelector(".token") === null, stores[0].set("step", 0).diagnostics[0].code,
        handle.diagnostics()];
    `), [0, 3, "pending", true, "state.disposed", []]);
  });

  await t.test("the technical Gallery renders without diagnostics in both themes and at 375px", async () => {
    const gallery = await readFile(new URL("../../examples/gallery/technical.md", import.meta.url), "utf8");
    for (const [theme, width] of [["theme-light", 800], ["theme-dark", 375]]) {
      assert.deepEqual(await run(`
        technical.reset();
        document.body.className = arguments[1];
        return technical.mountGallery(arguments[0], arguments[2]).map(({container, handle}) => [
          container.querySelector("figcaption")?.textContent, handle.diagnostics(), container.scrollWidth === arguments[2],
        ]);
      `, gallery, theme, width), [
        ["生成发布说明", [], true], ["发布前检查记录", [], true], ["发布说明目录", [], true],
      ]);
    }
  });
});
