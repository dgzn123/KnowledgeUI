import { appendFile, mkdir, writeFile } from "node:fs/promises";

const gate = process.argv[2];
await appendFile("gates.txt", gate + "\n");
if (process.env.KUI_TEST_GATE_FAILURE === gate) process.exit(23);
if (gate === "build") {
  const version = process.env.KUI_TEST_VERSION ?? "1.0.0";
  await mkdir("dist/obsidian", { recursive: true });
  await writeFile("dist/obsidian/main.js", `// ${version}\n`);
  await writeFile("dist/obsidian/styles.css", `/* ${version} */\n`);
  await writeFile("dist/obsidian/manifest.json", JSON.stringify({
    id: process.env.KUI_TEST_PLUGIN_ID ?? "knowledge-ui",
    isDesktopOnly: false,
    version,
  }));
  await writeFile("dist/obsidian/extra.txt", "not a plugin artifact");
}
