import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";
import { componentSamples, previewDocuments } from "../src/composition/preview-notes.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const pluginDir = join(root, "dist", "obsidian");
export const previewDir = join(root, "dist", "preview");

const JavaScriptBudget = 512 * 1024;
const yamlLicense = await readFile(join(root, "node_modules", "yaml", "LICENSE"), "utf8");
const licenseBanner = "/*! Knowledge UI: 0BSD\nBundled yaml: ISC\n\n" + yamlLicense.trim() + "\n*/";

function bundleOptions({ outdir, entryPoints, format, external = [], stylesheet, assetSources, readAssets }) {
  const stylesheetPath = join(root, stylesheet);
  const watchFiles = assetSources.map(source => join(root, source));
  return {
    absWorkingDir: root,
    entryPoints,
    outdir,
    bundle: true,
    platform: "browser",
    format,
    target: "es2022",
    external,
    minify: true,
    banner: { js: licenseBanner },
    write: false,
    metafile: true,
    plugins: [{
      name: "knowledge-ui-output",
      setup(builder) {
        builder.onLoad({ filter: /\.css$/, namespace: "file" }, async ({ path }) => {
          if (path !== stylesheetPath) return;
          return {
            contents: await readFile(path),
            loader: "css",
            resolveDir: dirname(path),
            watchFiles: [path, ...watchFiles],
          };
        });
        builder.onEnd(async result => {
          if (result.errors.length > 0) return;
          checkBundle(result, external);
          const assets = await readAssets();
          await mkdir(outdir, { recursive: true });
          for (const output of result.outputFiles) {
            await writeFile(output.path, output.contents);
            console.log(basename(outdir) + "/" + basename(output.path) + " (" + output.contents.length + " bytes)");
          }
          await Promise.all(assets.map(({ output, contents }) => writeFile(join(outdir, output), contents)));
        });
      },
    }],
  };
}

function checkBundle(result, external) {
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !external.includes(dependency.path)) {
        throw new Error("Unexpected external bundle dependency: " + dependency.path);
      }
    }
  }

  for (const output of result.outputFiles) {
    if (!output.path.endsWith(".js")) continue;
    for (const requireCall of output.text.matchAll(/\brequire\(\s*(["'])([^"']+)\1\s*\)/g)) {
      if (!external.includes(requireCall[2])) {
        throw new Error("Unexpected runtime module reference: " + requireCall[2]);
      }
    }
    if (output.contents.length > JavaScriptBudget) {
      throw new Error(basename(output.path) + " exceeds the " + JavaScriptBudget + "-byte bundle budget.");
    }
  }
}

async function readObsidianAssets() {
  const manifestContents = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestContents.toString("utf8"));
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (manifest.id !== "knowledge-ui" || manifest.version !== packageJson.version || manifest.isDesktopOnly !== false) {
    throw new Error("Plugin manifest does not match the project ID, version, or mobile target.");
  }
  return [{ output: "manifest.json", contents: manifestContents }];
}

const obsidianStylesheet = "src/composition/styles.css";
const obsidianBundle = bundleOptions({
  outdir: pluginDir,
  entryPoints: {
    main: "src/composition/obsidian.ts",
    styles: obsidianStylesheet,
  },
  format: "cjs",
  external: ["obsidian"],
  stylesheet: obsidianStylesheet,
  assetSources: ["manifest.json", "package.json"],
  readAssets: readObsidianAssets,
});

const previewAssets = [{ source: "preview/index.html", output: "index.html" }, ...previewDocuments];
const gallerySources = [
  "examples/gallery/basic.md", "examples/gallery/basic-supplement.md",
  "examples/gallery/chart.md", "examples/gallery/diagrams.md",
  "examples/gallery/technical.md", "examples/extensions/gallery.md",
];

async function readPreviewAssets() {
  const [documents, gallery] = await Promise.all([
    Promise.all(previewAssets.map(async ({ source, output }) => ({
      output,
      contents: await readFile(join(root, source)),
    }))),
    Promise.all(gallerySources.map(source => readFile(join(root, source), "utf8"))),
  ]);
  const contents = gallery.map(note => note.trimEnd()).join("\n\n") + "\n";
  return [...documents, { output: componentSamples.output, contents }];
}

const previewStylesheet = "src/composition/preview.css";
const previewBundle = bundleOptions({
  outdir: previewDir,
  entryPoints: [
    { in: "src/composition/preview.ts", out: "preview" },
    { in: previewStylesheet, out: "preview" },
  ],
  format: "esm",
  stylesheet: previewStylesheet,
  assetSources: [...previewAssets.map(({ source }) => source), ...gallerySources],
  readAssets: readPreviewAssets,
});

export async function buildObsidian() {
  await build(obsidianBundle);
}

export async function buildPreview() {
  await build(previewBundle);
}

export async function watchProduct() {
  const watchers = [];
  try {
    for (const options of [obsidianBundle, previewBundle]) {
      const watcher = await context(options);
      watchers.push(watcher);
      await watcher.watch();
    }
  } catch (error) {
    await Promise.all(watchers.map(watcher => watcher.dispose()));
    throw error;
  }
}
