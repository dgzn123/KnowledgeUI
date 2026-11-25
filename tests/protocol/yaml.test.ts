import assert from "node:assert/strict";
import test from "node:test";
import { V1_LIMITS } from "#contracts";
import { yamlReader } from "../../src/core/protocol/index.ts";
import { unwrap } from "./fixtures.ts";

test("YAML Core preserves types, own keys and UTF-16 ranges", () => {
  const yaml = "text: '𠮷'\r\nitems: [yes, off, 0o17, true, null]\r\nmap: { 'a/b~': 7, toString: scalar }\r\n";
  const { value, locate } = unwrap(yamlReader.read({ yaml }));
  assert.equal(Object.getPrototypeOf(value), null);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), {
    text: "𠮷", items: ["yes", "off", 15, true, null], map: { "a/b~": 7, toString: "scalar" },
  });
  assert.deepEqual(locate(["text"]), {
    start: { line: 1, column: 7, offset: 6 },
    end: { line: 1, column: 11, offset: 10 },
  });
  const range = locate(["map", "a/b~"]);
  assert.equal(range?.start.line, 3);
  assert.equal(yaml.slice(range?.start.offset, range?.end.offset), "7");
});

const forbidden = [
  ["object:\n  duplicate: first\n  'duplicate': second\n", "yaml.duplicate-key", ["object", "duplicate"]],
  ["anchor: &value 1\n", "yaml.anchor", ["anchor"]],
  ["alias: *value\n", "yaml.alias", ["alias"]],
  ["nested: { <<: { x: 1 } }\n", "yaml.merge-key", ["nested", "<<"]],
  ["nested: { '<<': 1 }\n", "yaml.merge-key", ["nested", "<<"]],
  ["tag: !!str 1\n", "yaml.tag", ["tag"]],
  ["tag: !local 1\n", "yaml.tag", ["tag"]],
  ["tag: ! 1\n", "yaml.tag", ["tag"]],
  ["%YAML 1.1\n---\ncontent: yes\n", "yaml.directive", []],
  ["%TAG !e! tag:example.org,2026:\n---\ncontent: value\n", "yaml.directive", []],
  ["nested: { [a, b]: 1 }\n", "yaml.mapping-key", ["nested"]],
  ["nested: { 1: value }\n", "yaml.mapping-key", ["nested"]],
  ["nested: { __proto__: value }\n", "yaml.reserved-key", ["nested", "__proto__"]],
  ["nested: { constructor: value }\n", "yaml.reserved-key", ["nested", "constructor"]],
  ["nested: { prototype: value }\n", "yaml.reserved-key", ["nested", "prototype"]],
  ["values: [.inf]\n", "yaml.non-finite", ["values", 0]],
  ["values: [.nan]\n", "yaml.non-finite", ["values", 0]],
  ["values: [1e99999]\n", "yaml.non-finite", ["values", 0]],
  ["first: a\n---\nsecond: b\n", "yaml.multiple-documents", []],
  ["first: a\n...\nsecond: b\n", "yaml.multiple-documents", []],
  ["invalid: [1, 2\n", "yaml.syntax", ["invalid"]],
] as const;

for (const [yaml, code, path] of forbidden) {
  test(`YAML rejects ${code} for ${JSON.stringify(yaml)}`, () => {
    const result = yamlReader.read({ yaml, sourceId: "source" });
    assert.equal(result.ok, false);
    const diagnostic = result.diagnostics.find(item => item.code === code);
    assert.deepEqual(diagnostic?.path, path);
    assert.equal(diagnostic?.sourceId, "source");
    assert.ok(diagnostic?.range?.start.line);
    if (code === "yaml.duplicate-key") {
      assert.equal(diagnostic.range.start.line, 3);
      assert.equal(diagnostic.range.start.column, 3);
    }
  });
}

test("YAML directives and document markers in quoted or block scalars are text", () => {
  const result = unwrap(yamlReader.read({ yaml: "---\nquoted: [\"---\", '%YAML']\nbody: |\n  %YAML 1.1\n  ---\n" }));
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), { quoted: ["---", "%YAML"], body: "%YAML 1.1\n---\n" });
});

test("YAML enforces UTF-8 source, depth and AST node budgets at the boundary", () => {
  const sourceAtLimit = "value: " + "字".repeat((V1_LIMITS.sourceBytes - 8) / 3) + "x";
  assert.equal(new TextEncoder().encode(sourceAtLimit).length, V1_LIMITS.sourceBytes);
  assert.equal(yamlReader.read({ yaml: sourceAtLimit }).ok, true);
  assert.equal(yamlReader.read({ yaml: sourceAtLimit + "字" }).diagnostics[0]?.code, "yaml.source-limit");

  const nested = (arrays: number) => "[".repeat(arrays) + "0" + "]".repeat(arrays);
  assert.equal(yamlReader.read({ yaml: nested(V1_LIMITS.yamlDepth - 1) }).ok, true);
  for (const depth of [V1_LIMITS.yamlDepth, 10_000]) {
    assert.equal(yamlReader.read({ yaml: nested(depth) }).diagnostics[0]?.code, "yaml.depth-limit");
  }

  const implicit = (count: number) => Array.from({ length: count }, () => "-\n").join("");
  const explicit = (count: number) => "[" + "0,".repeat(count - 1) + "0]";
  for (const source of [implicit, explicit]) {
    assert.equal(yamlReader.read({ yaml: source(V1_LIMITS.yamlNodes - 1) }).ok, true);
    assert.equal(yamlReader.read({ yaml: source(V1_LIMITS.yamlNodes) }).diagnostics[0]?.code, "yaml.nodes-limit");
  }
});

test("YAML counts keys and the mappings implied by flow sequence pairs", () => {
  const entries = (count: number) => "[" + Array.from({ length: count }, () => "a:").join(", ") + "]";
  assert.equal(yamlReader.read({ yaml: entries(3999) }).ok, true);
  assert.equal(yamlReader.read({ yaml: entries(4000) }).diagnostics[0]?.code, "yaml.nodes-limit");
});
