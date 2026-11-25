import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { segmentDocument } from "../../preview/document.ts";
import { createComponentRegistry } from "../../src/core/registry/index.ts";
import { fixtureRegistration, fixtureScanner } from "./fixtures/components.mjs";
import { bundle, serveFixture } from "./serve.mjs";

test("registry rejects duplicates and definitions with a different type discriminator", () => {
  const registry = createComponentRegistry();
  const first = fixtureRegistration("sample", () => undefined);
  assert.equal(registry.register(first).ok, true);
  assert.equal(registry.register(fixtureRegistration("sample", () => undefined)).diagnostics[0].code, "render.registration-conflict");
  const mismatch = { ...first, definition: { ...first.definition, type: "other" } };
  assert.equal(registry.register(mismatch).diagnostics[0].code, "render.registration-schema");
  assert.equal(registry.get("sample"), first);
  assert.equal(registry.get("constructor"), undefined);
  assert.deepEqual(registry.list(), [first]);
});

test("preview preserves surrounding Markdown for explicit scanner ranges", () => {
  const sourceId = "example.md";
  const source = ["Before", "~~~~kui", "type: section", "", "~~~~", "Middle",
    "~~~kui", "~~~", "After"].join("\r\n");
  const { value: blocks } = fixtureScanner.scan(source, sourceId);
  assert.deepEqual(blocks, [
    { yaml: "type: section\r\n\r\n", startLine: 3, endLine: 6, sourceId },
    { yaml: "", startLine: 8, endLine: 9, sourceId },
  ]);
  assert.deepEqual(segmentDocument(source, blocks), [
    { kind: "markdown", markdown: "Before\r\n" },
    { kind: "block", block: blocks[0] },
    { kind: "markdown", markdown: "Middle\r\n" },
    { kind: "block", block: blocks[1] },
    { kind: "markdown", markdown: "After" },
  ]);
});

test("preview keeps the new fence after a scanner range that ends at a list exit", () => {
  const fence = "\x60".repeat(3);
  const source = ["Before", "> - " + fence + "kui", ">   type: divider",
    "> " + fence, "> text in code", "> " + fence, "After"].join("\n");
  // Contract fixture for the container scan reported in B-02-02.
  const block = { yaml: "type: divider\n", startLine: 3, endLine: 4 };
  assert.deepEqual(segmentDocument(source, [block]), [
    { kind: "markdown", markdown: "Before\n" },
    { kind: "block", block },
    { kind: "markdown", markdown: ["> " + fence, "> text in code", "> " + fence, "After"].join("\n") },
  ]);
});

test("preview handles unclosed scanner ranges through the last actual line", () => {
  for (const ending of ["", "\n"]) {
    const source = "Before\n~~~kui\ntype: section" + ending;
    const { value: blocks } = fixtureScanner.scan(source);
    assert.deepEqual(blocks, [
      { yaml: "type: section" + ending, startLine: 3, endLine: 4, sourceId: undefined },
    ]);
    assert.deepEqual(segmentDocument(source, blocks), [
      { kind: "markdown", markdown: "Before\n" },
      { kind: "block", block: blocks[0] },
    ]);
  }
});

test("Web dependency graphs stay within each host boundary", async () => {
  const results = await Promise.all([
    bundle("src/main.ts", { format: "cjs", external: ["obsidian"] }),
    bundle("preview/index.ts"),
  ]);
  assert.deepEqual(
    new Set(Object.values(results[0].metafile.outputs).flatMap((output) => output.imports).map(({ path }) => path)),
    new Set(["obsidian"]),
  );
  assert.deepEqual(Object.values(results[1].metafile.outputs).flatMap((output) => output.imports), []);
  assert.ok(Object.keys(results[0].metafile.inputs).every((path) => !path.includes("adapters/browser")));
  assert.ok(Object.keys(results[1].metafile.inputs).every((path) => !path.includes("adapters/obsidian")));
  for (const result of results) assert.doesNotMatch(result.outputFiles[0].text, /\b(?:eval|Function)\s*\(|node:|electron/);
});

async function until(attempt, description) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const result = await attempt();
    if (result) return result;
    await delay(50);
  }
  throw new Error("Timed out waiting for " + description);
}

async function launchBrowser(binary, origin, onClose) {
  const profile = await mkdtemp(join(tmpdir(), "kui-chromium-"));
  const process = spawn(binary, [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--no-first-run",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, origin,
  ], { stdio: "ignore" });
  onClose(async () => {
    if (process.exitCode === null) {
      const exiting = once(process, "exit");
      process.kill();
      await exiting;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 2 });
  });
  const port = await until(async () => {
    const text = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
    return Number.parseInt(text, 10);
  }, "Chromium DevTools");
  const page = await until(async () => {
    const listing = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
    return listing.find(({ type, url }) => type === "page" && url.startsWith(origin));
  }, "preview browser page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, "open");
  onClose(() => socket.close());
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const { result, exceptionDetails } = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
  return { command, evaluate };
}

const binary = process.env.KUI_CHROMIUM ?? "chromium";
const browserVersion = spawnSync(binary, ["--version"], { encoding: "utf8" });

test("Chromium exercises the shared runtime, host adapters and preview", {
  skip: browserVersion.status !== 0 && "Chromium is unavailable. Set KUI_CHROMIUM to its executable.",
  timeout: 40_000,
}, async (t) => {
  t.diagnostic(browserVersion.stdout.trim());
  const server = await serveFixture();
  const close = [server.close];
  t.after(async () => { for (const release of close.reverse()) await release(); });
  const { command, evaluate } = await launchBrowser(binary, server.origin, (release) => close.push(release));
  await until(() => evaluate("Boolean(globalThis.fixturePreview && document.querySelector('.kui-fixture-component'))"), "fixture note");

  for (const [name, entry] of [
    ["nested mount, error isolation and resource cleanup in ownerDocument", "treeAndCleanup"],
    ["diagnostics, render budgets and independent failed blocks", "failuresAndLimits"],
    ["injected state, repeat and conditional subtree updates", "scopedBindings"],
    ["native Markdown boundary, async cleanup and plugin lifecycle (Obsidian API fake)", "markdownAndPlugin"],
    ["nested Markdown lists and safe list content reach the Obsidian API fake", "markdownLists"],
    ["the preview preserves regular fenced code after an implicit kui range", "previewFenceExtent"],
  ]) {
    await t.test(name, () => evaluate("import('/suite.js').then((suite) => suite." + entry + "())"));
  }

  await t.test("loads the sample, gallery and a user-selected file", async () => {
    assert.equal(await evaluate("document.querySelector('article h1').textContent"), "读懂一个比例");
    assert.match(await evaluate("document.querySelector('article').textContent"), /样本完成情况.*已完成项数/);
    const choose = (value) => evaluate(
      "(() => { const select = document.querySelector('select'); select.value = "
      + JSON.stringify(value)
      + "; select.dispatchEvent(new Event('change')); })()",
    );
    await choose("1");
    await until(() => evaluate("document.querySelector('article h1')?.textContent.includes('Gallery')"), "gallery");
    const { root } = await command("DOM.getDocument");
    const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
    await command("DOM.setFileInputFiles", {
      files: [fileURLToPath(new URL("../../preview/sample.md", import.meta.url))], nodeId,
    });
    await until(() => evaluate("document.querySelector('[role=status]').textContent === '已打开 sample.md'"), "local file");
    assert.equal(await evaluate("document.querySelector('article h1').textContent"), "读懂一个比例");
  });

  await t.test("switches theme and all widths, preserves keyboard focus, and fits a narrow viewport", async () => {
    await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const ui = "document.querySelector('.kui-preview-viewport')";
    for (const [value, expected] of [["1100", 1100], ["840", 840], ["650", 650], ["375", 375]]) {
      await evaluate("(() => { const width = document.querySelectorAll('select')[2]; width.value = '" + value
        + "'; width.dispatchEvent(new Event('change')); })()");
      assert.equal(await evaluate(ui + ".getBoundingClientRect().width"), expected);
    }

    const keyboard = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
    await evaluate("document.activeElement.blur()");
    await command("Input.dispatchKeyEvent", { type: "keyDown", ...keyboard });
    await command("Input.dispatchKeyEvent", { type: "keyUp", ...keyboard });
    assert.equal(await evaluate("document.activeElement === document.querySelector('select')"), true);
    assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineWidth"), "2px");

    const light = await evaluate("getComputedStyle(" + ui + ").backgroundColor");
    await evaluate("(() => { const theme = document.querySelectorAll('select')[1]; theme.value = 'dark'; theme.dispatchEvent(new Event('change')); })()");
    assert.equal(await evaluate("document.querySelector('.kui-preview').classList.contains('theme-dark')"), true);
    assert.notEqual(await evaluate("getComputedStyle(" + ui + ").backgroundColor"), light);
    assert.equal(await evaluate("document.activeElement === document.querySelector('select')"), true);

    await command("Emulation.setDeviceMetricsOverride", { width: 320, height: 768, deviceScaleFactor: 1, mobile: false });
    const available = await evaluate("document.documentElement.clientWidth");
    assert.ok(available > 0 && available <= 320);
    assert.equal(await evaluate(ui + ".getBoundingClientRect().width"), available);
    assert.equal(await evaluate("document.documentElement.scrollWidth"), available);
    if (process.env.KUI_RUNTIME_SCREENSHOTS) {
      const dir = process.env.KUI_RUNTIME_SCREENSHOTS;
      await mkdir(dir, { recursive: true });
      const { data } = await command("Page.captureScreenshot", { format: "png" });
      await writeFile(join(dir, "preview-dark-320.png"), Buffer.from(data, "base64"));
    }

    assert.equal(await evaluate("fixturePreview.dispose(); fixturePreview.dispose(); document.querySelector('#kui-preview').childNodes.length"), 0);
  });
});
