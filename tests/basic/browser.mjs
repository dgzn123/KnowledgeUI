import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = new URL("../../", import.meta.url);
const fixture = new URL("fixtures/", import.meta.url);
const output = new URL(".cache/basic-browser/", project);
const localPath = relative => fileURLToPath(new URL(relative, output));
await mkdir(output, { recursive: true });
await Promise.all([
  copyFile(new URL("browser.html", fixture), localPath("index.html")),
  copyFile(new URL("src/styles/index.css", project), localPath("styles.css")),
  build({
    entryPoints: [fileURLToPath(new URL("browser.mjs", fixture))],
    bundle: true,
    loader: { ".md": "text" },
    outfile: localPath("browser.js"),
  }),
]);

const driver = spawn(process.env.CHROMEDRIVER_BIN ?? "chromedriver", ["--port=0"], {
  stdio: ["ignore", "pipe", "inherit"],
});
let base;
let session;

async function request(command, data, method = data === undefined ? "GET" : "POST") {
  const response = await fetch(base + command, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data !== undefined && { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30_000),
  });
  const { value } = await response.json();
  if (!response.ok) throw new Error(value.message ?? response.statusText);
  return value;
}

try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("ChromeDriver did not start")), 5000);
    let output = "";
    driver.on("error", error => { clearTimeout(timeout); reject(error); });
    driver.once("exit", code => {
      clearTimeout(timeout);
      reject(new Error("ChromeDriver exited with code " + code));
    });
    driver.stdout.on("data", chunk => {
      output += chunk;
      const match = /started successfully on port (\d+)\./.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  base = "http://127.0.0.1:" + port;
  const browser = await request("/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        "goog:chromeOptions": {
          ...(process.env.CHROMIUM_BIN && { binary: process.env.CHROMIUM_BIN }),
          args: ["--headless", "--window-size=1200,1000"],
        },
      },
    },
  });
  session = "/session/" + browser.sessionId;
  console.log(browser.capabilities.browserName + " " + browser.capabilities.browserVersion);
  const execute = (script, args = []) => request(session + "/execute/sync", { script, args });
  const devtools = (cmd, params) => request(session + "/goog/cdp/execute", { cmd, params });

  await request(session + "/url", { url: new URL("index.html", output).href });
  const results = await request(session + "/execute/async", {
    script: "const done = arguments[0]; window.kuiFixture.run().then(done, error => done({ error: error.stack }));",
    args: [],
  });
  assert.ok(Array.isArray(results), JSON.stringify(results));
  for (const { name, ok, error } of results) {
    console.log((ok ? "PASS " : "FAIL ") + name);
    if (!ok) console.error(error);
  }

  for (const [theme, focusColor] of [["light", "rgb(19, 88, 160)"], ["dark", "rgb(153, 199, 255)"]]) {
    await execute("window.kuiFixture.keyboardFixture(arguments[0]);", [theme]);
    await request(session + "/actions", { actions: [{
      type: "key",
      id: "keyboard",
      actions: [{ type: "keyDown", value: "\uE004" }, { type: "keyUp", value: "\uE004" }],
    }] });
    assert.deepEqual(await execute(`
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return [element.id, element.matches(":focus-visible"), style.outlineStyle, style.outlineWidth, style.outlineColor];
    `), ["fixture-link", true, "solid", "2px", focusColor]);
    console.log("PASS keyboard Tab and visible focus in " + theme + " theme");
  }

  await devtools("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const touch = await execute(`
    const box = document.querySelector("#fixture-link").getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  `);
  await devtools("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] });
  await devtools("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.equal(await execute("return location.hash;"), "#fixture-target");
  console.log("PASS host link activation with Chromium touch emulation");

  for (const theme of ["light", "dark"]) {
    for (const width of [900, 375]) {
      const clip = await execute(`
        window.kuiFixture.setGallery(arguments[0], arguments[1]);
        document.querySelector("#sandbox").replaceChildren();
        window.scrollTo(0, 0);
        const box = document.querySelector("#gallery").getBoundingClientRect();
        return { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: Math.ceil(box.height + 32), scale: 1 };
      `, [width, theme]);
      const { data } = await devtools("Page.captureScreenshot", { clip, captureBeyondViewport: true });
      await writeFile(localPath(`gallery-${theme}-${width}.png`), Buffer.from(data, "base64"));
    }
  }
  assert.ok(results.every(({ ok }) => ok), "One or more browser checks failed");
  console.log(`${results.length + 3} browser checks passed. Screenshots in ${fileURLToPath(output)}`);
} finally {
  try {
    if (session) await request(session, undefined, "DELETE");
  } finally {
    driver.kill();
  }
}
