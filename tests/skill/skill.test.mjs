import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { createActiveProtocol } from "../../src/composition/protocol.ts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";

const skill = new URL("../../skills/knowledge-ui/", import.meta.url);
const examples = new URL("examples/", skill);
const wrapper = fileURLToPath(new URL("scripts/validate.mjs", skill));
const productionCli = fileURLToPath(new URL("../../cli/main.ts", import.meta.url));

test("skill metadata and routed Markdown resources are usable", () => {
  const entry = readFileSync(new URL("SKILL.md", skill), "utf8");
  const frontmatter = entry.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(frontmatter);
  const metadata = parse(frontmatter[1]);
  assert.equal(metadata.name, "knowledge-ui");
  assert.equal(typeof metadata.description, "string");
  assert.ok(metadata.description.trim());
  const sources = readdirSync(skill, { recursive: true })
    .filter(name => name.endsWith(".md"))
    .map(name => new URL(name, skill));
  sources.push(new URL("../../README.md", import.meta.url));
  for (const source of sources) {
    const content = readFileSync(source, "utf8");
    for (const [, link] of content.matchAll(/\[[^\]\n]+\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) {
      accessSync(new URL(link, source));
    }
  }
});

test("golden notes contain production-valid blocks and the standalone entry validates them", () => {
  const protocol = createActiveProtocol();
  const names = readdirSync(examples).filter(name => name.endsWith(".md"));
  assert.ok(names.length >= 3);
  for (const name of names) {
    const note = readFileSync(new URL(name, examples), "utf8");
    const scanned = markdownBlockScanner.scan(note, name);
    assert.equal(scanned.ok, true, name);
    assert.ok(scanned.value.length > 0, name);
    for (const block of scanned.value) {
      const result = protocol.read(block);
      assert.equal(result.ok, true, name);
      assert.deepEqual(result.diagnostics, [], name);
    }
  }
  const result = spawnSync(process.execPath, [wrapper], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("skill entry forwards relative paths, shared diagnostics and exit status", t => {
  const cwd = mkdtempSync(join(tmpdir(), "kui-skill-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const name = "note with spaces.md";
  writeFileSync(join(cwd, name), [
    "# A note", "", "```kui", "version: 1", "type: metric", "label: Count", "value: '{{unknownValue}}'", "```", "",
  ].join("\n"));
  const run = (entry, target) => spawnSync(process.execPath, [entry, "--", target], { cwd, encoding: "utf8" });
  const invalid = run(wrapper, name);
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.match(invalid.stderr, /:7:\d+ error semantic\.[a-z-]+ \[value\]/);
  assert.equal(invalid.stderr, run(productionCli, name).stderr);
  const missing = run(wrapper, "missing.md");
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /validate\.io/);
});
