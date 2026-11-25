import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { segmentDocument } from "../../preview/document.ts";
import { activeRegistrations, createActiveProtocol } from "../../src/composition/protocol.ts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";

const root = new URL("../../", import.meta.url);
const gallery = "examples/Component Gallery.md";
const notes = {
  "mosfet.md": { types: ["chart", "metric", "quiz", "slider", "svg"], fallback: "−4.80 V/V" },
  "linux-fork-exec-fd.md": { types: ["code", "stepper", "svg", "terminal"], fallback: "fd 4 = EBADF" },
  "tcp-handshake-congestion.md": { types: ["chart", "select", "sequence", "stepper"], fallback: "首次 RTO" },
  "linked-list-reversal.md": { types: ["code", "graph", "stepper"], fallback: "B, D, A, C" },
  "second-order-system.md": { types: ["chart", "formula", "slider"], fallback: "1/√2" },
};
const notePath = name => "examples/notes/" + name;

test("the gallery covers the active protocol and every lesson retains Markdown teaching content", async () => {
  const protocol = createActiveProtocol();
  const paths = [gallery, ...Object.keys(notes).map(notePath)];
  for (const path of paths) {
    const markdown = await readFile(new URL(path, root), "utf8");
    const scan = markdownBlockScanner.scan(markdown, path);
    assert.equal(scan.ok, true, JSON.stringify(scan.diagnostics));
    assert.deepEqual(scan.diagnostics, []);
    assert.ok(scan.value.length > 0, path);
    const covered = new Set();
    function visit(node) {
      covered.add(node.type);
      for (const slot of Object.values(node.slots)) slot.forEach(visit);
    }
    for (const block of scan.value) {
      const result = protocol.read(block);
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      assert.deepEqual(result.diagnostics, []);
      visit(result.value.root);
    }
    if (path === gallery) {
      assert.deepEqual([...covered].sort(), activeRegistrations.map(item => item.definition.type).sort());
    } else {
      const expectation = notes[path.slice(notePath("").length)];
      for (const type of expectation.types) assert.ok(covered.has(type), path + " missing " + type);
      const plain = segmentDocument(markdown, scan.value)
        .filter(segment => segment.kind === "markdown").map(segment => segment.markdown).join("\n");
      assert.ok(plain.includes(expectation.fallback), path + " missing the standalone teaching result");
    }
  }
});

const chromeDriver = process.env.CHROMEDRIVER_BIN ?? "chromedriver";
const chromium = process.env.CHROMIUM_BIN ?? "chromium";
const canRunBrowser = [chromeDriver, chromium].every(binary => spawnSync(binary, ["--version"]).status === 0);

async function start(t, executable, args, readAddress) {
  const child = spawn(executable, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  let log = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log += chunk; });
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    const match = readAddress.exec(log);
    if (match) return match[1];
    await delay(25);
  }
  throw new Error(executable + " did not start\n" + log);
}

test("the formal Chromium Preview loads and exercises the five lessons and gallery", {
  skip: !canRunBrowser && "Chromium or ChromeDriver unavailable",
}, async t => {
  const preview = process.env.KUI_EXAMPLES_PREVIEW_ORIGIN ?? await start(t, process.execPath,
    ["scripts/preview.mjs", "0"], /Knowledge UI preview at (http:\/\/127\.0\.0\.1:\d+\/)/);
  const port = await start(t, chromeDriver, ["--port=0"], /started successfully on port (\d+)/);
  async function request(path, body, method = "POST") {
    const response = await fetch("http://127.0.0.1:" + port + path, {
      method, headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const { value } = await response.json();
    assert.ok(response.ok, value?.message);
    return value;
  }
  const browser = await request("/session", { capabilities: { alwaysMatch: {
    browserName: "chrome", "goog:chromeOptions": {
      ...(process.env.CHROMIUM_BIN && { binary: chromium }),
      args: ["--headless", "--disable-gpu", "--disable-background-networking",
        ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])] },
  } } });
  t.diagnostic("Chromium " + browser.capabilities.browserVersion);
  const session = "/session/" + browser.sessionId;
  try {
    const command = (path, body) => request(session + path, body);
    const execute = (script, ...args) => command("/execute/sync", { script, args });
    const check = async (fn) => {
      const failure = await command("/execute/async", { script: "(" + fn.toString() + ")(arguments[0]);", args: [] });
      assert.equal(failure, null, failure);
    };

    await command("/url", { url: preview });
    for (const path of [...Object.keys(notes).map(notePath), gallery]) {
      const name = path.split("/").at(-1);
      await t.test(name, async () => {
        const file = await command("/element", { using: "css selector", value: "input[type=file]" });
        await command("/element/" + file["element-6066-11e4-a52e-4f735466cecf"] + "/value",
          { text: fileURLToPath(new URL(path, root)) });
        const deadline = Date.now() + 5_000;
        while (await execute("return document.querySelector('.kui-preview-status')?.textContent") !== "已打开 " + name) {
          assert.ok(Date.now() < deadline, "Preview failed to open " + name);
          await delay(25);
        }
        const title = (await readFile(new URL(path, root), "utf8")).split("\n")[0].slice(2);
        for (const width of [1250, 375]) {
          await command("/goog/cdp/execute", { cmd: "Emulation.setDeviceMetricsOverride",
            params: { width, height: 850, deviceScaleFactor: 1, mobile: width === 375 } });
          for (const theme of ["light", "dark"]) {
            const info = await execute(`
              const [width, theme] = arguments;
              const [, themeSelect, widthSelect] = document.querySelectorAll('.kui-preview-controls select');
              for (const [control, value] of [[themeSelect, theme], [widthSelect, String(Math.min(width, 1100))]]) {
                control.value = value;
                control.dispatchEvent(new Event('change'));
              }
              const article = document.querySelector('article');
              const viewport = document.querySelector('main');
              const page = document.documentElement;
              return {
                title: article.querySelector('h1')?.textContent,
                theme: getComputedStyle(document.querySelector('.kui-preview')).colorScheme,
                width: viewport.clientWidth,
                overflow: Math.max(viewport.scrollWidth - viewport.clientWidth, page.scrollWidth - page.clientWidth),
                diagnostics: Array.from(article.querySelectorAll('.kui-diagnostic'), entry => entry.innerText),
              };
            `, width, theme);
            assert.deepEqual(info, { title, theme, width: Math.min(width, 1100), overflow: 0, diagnostics: [] });
          }
        }

        await check(async done => {
          try {
            const article = document.querySelector("article");
            const name = document.querySelector(".kui-preview-status").textContent.slice(4);
            const all = (selector, scope = article) => [...scope.querySelectorAll(selector)];
            const one = selector => article.querySelector(selector);
            const text = selector => one(selector)?.textContent.trim();
            const must = (condition, message) => { if (!condition) throw new Error(message); };
            const frame = async () => {
              for (let i = 0; i < 4; i++) await new Promise(resolve => requestAnimationFrame(resolve));
              const diagnostics = all(".kui-diagnostic").map(entry => entry.innerText);
              must(!diagnostics.length, diagnostics.join("\n"));
            };
            const set = (element, value, event = "input") => {
              element.value = value;
              element.dispatchEvent(new Event(event, { bubbles: true }));
            };
            const push = (label, scope = article) => {
              const control = all("button", scope).find(button => button.textContent.trim() === label);
              must(control, "Missing button " + label);
              control.click();
            };
            const step = async (group, count, label = "Next") => {
              const scope = all(".kui-stepper")[group];
              for (let i = 0; i < count; i++) {
                push(label, scope);
                await frame();
              }
            };
            const metric = label => all(".kui-metric").find(item => item.querySelector(".kui-metric-label")
              ?.textContent.includes(label))?.querySelector(".kui-metric-value")?.textContent.trim();
            const sliders = () => all('input[type="range"]');
            const highlights = () => all(".kui-code-line[data-highlighted] .kui-code-number")
              .map(number => number.dataset.line).join(",");
            await frame();

            if (name === "mosfet.md") {
              const [gate, drain, threshold] = sliders();
              const marker = one(".kui-chart-marker");
              const initial = marker.getAttribute("cx");
              must(metric("漏电流") === "2.400" && metric("跨导") === "2.400", "Default MOSFET Q");
              set(drain, "2");
              await frame();
              must(metric("漏电流") === "2.200" && metric("工作区") === "饱和区"
                && marker === one(".kui-chart-marker") && marker.getAttribute("cx") !== initial, "MOSFET boundary marker");
              set(drain, "1");
              await frame();
              must(metric("工作区") === "线性区" && metric("漏电流") === "1.575", "MOSFET linear branch");
              set(gate, "1");
              await frame();
              must(metric("工作区") === "截止" && metric("漏电流") === "0.000", "MOSFET cutoff");
              set(gate, "3");
              set(drain, "4");
              set(threshold, "2");
              await frame();
              must(metric("漏电流") === "0.600" && all(".kui-svg-drawing svg").length === 3, "Threshold and circuit symbols");
              all('input[type="radio"]')[1].click();
              await frame();
              must(text(".kui-quiz-feedback")?.includes("1.10"), "MOSFET quiz feedback");
            } else if (name === "linux-fork-exec-fd.md") {
              const svg = one(".kui-svg-drawing");
              must(highlights() === "1,2" && svg.querySelectorAll("path").length === 2, "Initial FD references");
              await step(0, 2);
              must(highlights() === "6" && svg.textContent.includes("偏移 4 B")
                && svg.querySelectorAll("path").length === 4, "Shared read offset");
              await step(0, 1);
              must(highlights() === "7" && svg.textContent.includes("B · 引用 1")
                && svg.querySelectorAll("path").length === 3
                && text(".kui-terminal-transcript")?.includes("fd 4 = EBADF"), "Successful exec closes child FD 4");
              await step(0, 2);
              must(highlights() === "13,14" && svg.querySelectorAll("path").length === 0, "FD references released");
              await step(0, 1, "Reset");
              must(highlights() === "1,2" && text(".kui-code-syntax-status")?.includes("unavailable"), "Reset and plain C");
            } else if (name === "tcp-handshake-congestion.md") {
              await step(0, 2);
              must(text('.kui-sequence [aria-current="step"]')?.includes("ack 7001"), "Final handshake ACK");
              await step(1, 6);
              const series = one(".kui-chart-shape");
              const path = series.getAttribute("d");
              must(metric("cwnd") === "11" && metric("ssthresh") === "8", "No-loss branch");
              set(one(".kui-select select"), "1", "change");
              await frame();
              must(metric("cwnd") === "8" && metric("ssthresh") === "5"
                && series.getAttribute("d") !== path, "Fast-recovery branch and curve");
              await step(1, 1);
              must(metric("cwnd") === "5", "Fast-recovery deflation");
              await step(1, 1, "Previous");
              set(one(".kui-select select"), "2", "change");
              await frame();
              must(metric("cwnd") === "1" && metric("ssthresh") === "5", "RTO branch");
            } else if (name === "linked-list-reversal.md") {
              await step(0, 5);
              const graph = one(".kui-graph");
              must(highlights() === "6" && graph.textContent.includes("next → C"), "Save C before changing B.next");
              const edges = all('.kui-graph-edge[display="inline"] path', graph);
              must(edges.length === 4 && edges.at(-1).getAttribute("d").startsWith("M 112 106.5 L 91 106.5"),
                "The new node edge points back from B to A");
              const diagramScroll = graph.querySelector(".kui-graph-scroll");
              diagramScroll.scrollLeft = diagramScroll.scrollWidth;
              must(diagramScroll.tabIndex === 0 && diagramScroll.scrollLeft > 0, "Graph scrolls inside the 375 px note");
              await step(0, 4);
              must(highlights() === "4,10" && graph.textContent.includes("prev → C")
                && graph.textContent.includes("curr → ∅"), "Final C → B → A");
              await step(1, 1);
              must(article.innerText.includes("A → B → D") && article.innerText.includes("已访问 B → D"), "Tree call path");
            } else if (name === "second-order-system.md") {
              const [damping, omega] = sliders();
              const first = all(".kui-chart")[0];
              const curves = () => all(".kui-chart-shape", first).map(shape => shape.getAttribute("d"));
              must(metric("超调") === "16.30" && metric("正频率") === "1.414", "Second-order defaults");
              set(omega, "4");
              await frame();
              must(metric("首峰时间") === "0.907" && metric("正频率") === "2.828", "Angular frequency scaling");
              set(damping, "0.8");
              await frame();
              must(Number(metric("超调")) > 0 && metric("正频率") === "—", "Overshoot without resonance");
              set(damping, "1");
              await frame();
              must(metric("超调") === "0.00" && curves()[0] === curves()[1], "Critical damping");
              set(damping, "2");
              await frame();
              must(metric("首峰") === "—" && curves()[0] !== curves()[1], "Overdamped branch");
              must(text(".kui-formula-equation .kui-markdown-latex")?.includes("\\frac"), "LaTeX source fallback");
            } else {
              const [count] = sliders();
              const [manualCount, seedOne, seedTwo] = all('input[type="number"]');
              must(count.value === "2" && one("progress").value === 2, "Gallery progress default");
              set(count, "4");
              await frame();
              must(Number(manualCount.value) === 4 && one("progress").value === 4, "Slider binding");
              set(manualCount, "3", "change");
              await frame();
              must(count.value === "3" && one("progress").value === 3, "Numeric binding");
              push("重置核对数");
              set(one(".kui-select select"), "1", "change");
              one('input[role="switch"]').click();
              await frame();
              must(one("progress").value === 2 && text("table")?.includes("20.1")
                && article.innerText.includes("取偏差绝对值"), "Gallery reset, batch and toggle");
              const [readings, formula] = all('[role="tab"]');
              readings.focus();
              readings.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
              must(document.activeElement === formula, "Keyboard moved tab focus");
              formula.click();
              one(".kui-collapse summary").click();
              await frame();
              must(formula.getAttribute("aria-selected") === "true"
                && text(".kui-collapse .kui-markdown-latex")?.includes("\\Delta T"), "Keyboard tab and formula disclosure");
              all(".kui-file-tree summary").find(item => item.textContent === "readings").click();
              await step(0, 1);
              must(text('.kui-sequence [aria-current="step"]')?.includes("返回读数"), "Gallery sequence");
              const second = seedTwo.value;
              set(seedOne, "2", "change");
              await frame();
              must(seedOne.value === "2" && seedTwo.value === second && metric("调整后") === "5", "Template state isolation");
            }
            done(null);
          } catch (error) {
            done(error.stack);
          }
        });
        if (path === gallery) {
          const key = "element-6066-11e4-a52e-4f735466cecf";
          const formulaTab = await command("/element", { using: "css selector", value: '[role="tab"][aria-selected="true"]' });
          await command("/element/" + formulaTab[key] + "/value", { text: "\uE012" });
          assert.equal(await execute("return document.activeElement.textContent"), "读数");
          const focused = await command("/element", { using: "css selector", value: '[role="tab"]:focus' });
          await command("/element/" + focused[key] + "/value", { text: "\uE007" });
          assert.equal(await execute("return document.querySelector('[role=tab][aria-selected=true]').textContent"), "读数");
        }
      });
    }
  } finally {
    await request(session, undefined, "DELETE");
  }
});
