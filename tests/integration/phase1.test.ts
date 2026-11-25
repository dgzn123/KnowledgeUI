import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ComponentNode } from "#contracts";
import { phase1ComponentTypes } from "#protocol-schema";
import { segmentDocument } from "../../preview/document.ts";
import { createActiveProtocol } from "../../src/composition/protocol.ts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";

test("the production protocol accepts Gallery blocks and includes every Phase 1 component", () => {
  const markdown = readFileSync(new URL("../../examples/gallery/basic.md", import.meta.url), "utf8");
  const scan = markdownBlockScanner.scan(markdown);
  assert.equal(scan.ok, true);
  assert.equal(scan.value.length, 2);

  const protocol = createActiveProtocol();
  const covered = new Set<string>();
  function visit(node: ComponentNode): void {
    covered.add(node.type);
    for (const slot of Object.values(node.slots)) slot.forEach(visit);
  }
  for (const block of scan.value) {
    const result = protocol.read(block);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
    visit(result.value.root);
  }
  assert.deepEqual([...covered].sort(), [...phase1ComponentTypes].sort());
});

test("the preview uses production scanner ranges and preserves the next fence", () => {
  const before = ["<!--", "~~~kui", "type: ignored", "~~~", "-->"];
  const after = ["> ~~~", "> code after container", "> ~~~", "After"];
  for (const newline of ["\n", "\r\n"]) {
    const markdown = [...before, "> - ~~~kui", ">   version: 1", ">   type: divider", ...after].join(newline);
    const scan = markdownBlockScanner.scan(markdown);
    assert.equal(scan.ok, true);
    assert.equal(scan.value.length, 1);
    assert.equal(scan.value[0]?.endLine, 9);
    const segments = segmentDocument(markdown, scan.value);
    assert.deepEqual(segments.map(({ kind }) => kind), ["markdown", "block", "markdown"]);
    assert.deepEqual(segments[2], { kind: "markdown", markdown: after.join(newline) });
  }
});

test("the production protocol enables controls, compiles expressions, and validates bindings", () => {
  const yaml = readFileSync(new URL("../state/fixtures/controls.yaml", import.meta.url), "utf8");
  const protocol = createActiveProtocol();
  const valid = protocol.read({ yaml });
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));
  assert.deepEqual(valid.diagnostics, []);

  const invalid = protocol.read({
    yaml: yaml.replace("type: slider, bind: amount", "type: slider, bind: shown"),
  });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.diagnostics.map(({ code, path }) => [code, path]), [
    ["semantic.control-bind", ["layout", "children", 0, "bind"]],
  ]);
});
