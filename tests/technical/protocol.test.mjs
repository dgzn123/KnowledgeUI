import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { technicalRegistrations } from "../../src/components/technical/index.ts";
import { v1ComponentSchema } from "#protocol-schema";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { protocol } from "./fixtures/runtime.mjs";

test("technical registrations reuse the frozen component schemas and validate the gallery", async () => {
  assert.deepEqual(technicalRegistrations.map(({ definition }) => definition.type), ["code", "terminal", "file-tree"]);
  for (const { definition } of technicalRegistrations) {
    assert.equal(definition.schema, v1ComponentSchema(definition.type).schema);
  }
  const gallery = await readFile(new URL("../../examples/gallery/technical.md", import.meta.url), "utf8");
  const blocks = markdownBlockScanner.scan(gallery);
  assert.equal(blocks.ok, true);
  assert.equal(blocks.value.length, 3);
  for (const block of blocks.value) {
    const result = protocol.read(block);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
  }
});

test("static code ranges and annotation lines produce located semantic diagnostics", () => {
  const result = protocol.read({
    sourceId: "technical.md",
    yaml: 'version: 1\ntype: code\ncode: "first\\r\\nsecond\\rthird\\n"\nhighlight: [5, {from: 3, to: 1}]\n'
      + 'annotations: [{line: 5, text: "outside"}]\n',
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map(({ code, path, sourceId, range }) => [code, path, sourceId, range?.start.line]), [
    ["semantic.code-line-out-of-range", ["highlight", 0], "technical.md", 4],
    ["semantic.code-range-order", ["highlight", 1], "technical.md", 4],
    ["semantic.code-line-out-of-range", ["annotations", 0, "line"], "technical.md", 5],
  ]);
});

test("empty lines, duplicates, and range endpoints within the source are accepted", () => {
  const result = protocol.read({
    yaml: 'version: 1\ntype: code\ncode: "first\\r\\nsecond\\rthird\\n"\nhighlight: [{from: 1, to: 4}, 4, 1]\n'
      + 'annotations: [{line: 4, text: "blank"}]\n',
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(protocol.read({ yaml: 'version: 1\ntype: code\ncode: ""\nhighlight: [1]\n' }).ok, true);
});

test("the shared protocol rejects incorrect literal types, undeclared names and unknown fields", () => {
  const cases = [
    'type: code\ncode: sample\nhighlight: ["1"]',
    'type: code\ncode: sample\nhighlight: [0]',
    'type: code\ncode: sample\nhighlight: [{from: 1, to: 1, other: 1}]',
    'type: code\ncode: sample\nhighlight: "Step {{1}}"',
    'type: code\ncode: sample\nhighlight: "{{undeclared}}"',
    'type: terminal\nlines: [{kind: output, text: 1}]',
    'type: file-tree\nentries: [{kind: file, name: notes, children: []}]',
  ];
  for (const yaml of cases) {
    const result = protocol.read({ yaml: "version: 1\n" + yaml });
    assert.equal(result.ok, false, yaml);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.severity === "error" && diagnostic.path.length), yaml);
  }
});
