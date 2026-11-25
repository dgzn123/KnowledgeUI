import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));

export function bundle(entry, options = {}) {
  return build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
    metafile: true,
    ...options,
  });
}

export async function serveFixture(port = 0) {
  const builds = [
    bundle("tests/runtime/fixtures/preview.mjs"),
    bundle("tests/runtime/fixtures/browser-suite.mjs", {
      alias: { obsidian: "./tests/runtime/fixtures/obsidian.mjs" },
    }),
  ];
  const [preview, suite, html, css, sample, gallery] = await Promise.all([
    ...builds,
    readFile(new URL("../../preview/index.html", import.meta.url)),
    readFile(new URL("../../preview/preview.css", import.meta.url)),
    readFile(new URL("../../preview/sample.md", import.meta.url)),
    readFile(new URL("./fixtures/gallery.md", import.meta.url)),
  ]);
  const paths = new Map([
    ["/", ["text/html", html]],
    ["/preview.css", ["text/css", css]],
    ["/preview.js", ["text/javascript", preview.outputFiles[0].contents]],
    ["/suite.js", ["text/javascript", suite.outputFiles[0].contents]],
    ["/sample.md", ["text/markdown", sample]],
    ["/gallery.md", ["text/markdown", gallery]],
  ]);
  const server = createServer((request, response) => {
    const file = paths.get(request.url);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": file[0] + "; charset=utf-8" }).end(file[1]);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    origin: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.main) {
  const { origin } = await serveFixture(Number(process.argv[2] ?? 4173));
  console.log("Agent 02 fixture preview " + origin);
}
