import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { buildPreview, previewDir } from "./bundles.mjs";
import { componentSamples, previewDocuments } from "../src/composition/preview-notes.ts";

const port = Number(process.argv[2] ?? "4173");
if (process.argv.length > 3 || !Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("Usage: npm run preview -- [port]");
}
await buildPreview();

const routes = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/preview.js", ["preview.js", "text/javascript"]],
  ["/preview.css", ["preview.css", "text/css"]],
  ...[...previewDocuments, componentSamples].map(({ output }) => ["/" + output, [output, "text/markdown"]]),
]);
const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const route = routes.get(request.url?.split("?", 1)[0]);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  const [file, mime] = route;
  try {
    const contents = await readFile(join(previewDir, file));
    response.writeHead(200, {
      "Content-Type": mime + "; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch {
    response.writeHead(500).end();
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log("Knowledge UI preview at http://127.0.0.1:" + server.address().port + "/");
});
