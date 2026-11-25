import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { V1_LIMITS } from "#contracts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { createTemplateExpander } from "../../src/core/templates/index.ts";
import { bundledExtensions } from "../../src/extensions/index.ts";
import { extensionFixture, unwrap } from "./fixtures/protocol.mjs";

const name = "common:adjustable-value";
const fixturePackage = templates => ({ namespace: "fixture", version: "1.0.0", protocolVersion: 1, templates });
const template = (body, parameters = {}) => ({ parameters, body });
const call = (name, params = {}) => ({ type: "template", name, params });
const codes = result => result.diagnostics.map(({ code }) => code);

test("shared reader validates template name, missing and unexpected parameters, and literal types", () => {
  const { protocol } = extensionFixture();
  const read = (params, id = name) => protocol.read({
    yaml: `version: 1\ntype: template\nname: ${id}\nparams: ${params}\n`, sourceId: "test.md",
  });
  assert.deepEqual(codes(read("{}", "unknown:template")), ["extension.unknown-template"]);
  assert.deepEqual(codes(read("{ caption: Title }")), ["extension.missing-parameter"]);
  assert.deepEqual(codes(read("{ seed: 1, extra: 2 }")), ["extension.unknown-parameter"]);
  assert.deepEqual(codes(read("{ seed: '1', showBaseline: 'true' }")), ["extension.parameter-type", "extension.parameter-type"]);
  const error = read("{ seed: 1, caption: false }").diagnostics[0];
  assert.deepEqual(error.path, ["params", "caption"]);
  assert.equal(error.range.start.line, 4);
  assert.equal(error.sourceId, "test.md");
  assert.deepEqual(codes(read("{ seed: '{{unknown}}' }")), ["semantic.unknown-identifier"]);
  assert.equal(read("{ seed: '{{0}}', showBaseline: '{{false}}', caption: 'Label {{2}}' }").ok, true);
});

test("expander produces typed immutable params, applies defaults, and rejects bad resolved values", () => {
  const { protocol, extensions } = extensionFixture();
  const expander = createTemplateExpander(extensions, protocol);
  const expand = (params, id = name) => expander.expand({ id, params, source: { path: ["layout"] }, ancestry: [] });
  const result = unwrap(expand({ seed: 0, caption: "", showBaseline: false }));
  assert.deepEqual({ ...result.locals }, { seed: 0, caption: "", unit: "", showBaseline: false });
  assert.deepEqual(result.ancestry, [name]);
  assert.equal(result.node.type, "interactive");
  assert.ok(Object.isFrozen(result.locals));
  assert.ok(Object.isFrozen(result.ancestry));
  assert.deepEqual({ ...unwrap(expand({ seed: 1 })).locals }, { seed: 1, caption: "调整值", unit: "", showBaseline: true });
  assert.deepEqual(codes(expand({ seed: 1 }, "other:missing")), ["extension.unknown-template"]);
  assert.deepEqual(codes(expand({})), ["extension.missing-parameter"]);
  for (const value of [null, [], {}, "1", Infinity, NaN]) {
    const result = expand({ seed: value });
    assert.deepEqual(codes(result), ["extension.parameter-type"]);
    assert.deepEqual(result.diagnostics[0].path, ["layout", "params", "seed"]);
  }
  let reads = 0;
  assert.deepEqual(codes(expand({ get seed() { reads++; return 1; } })), ["extension.parameter-type"]);
  assert.equal(reads, 0);
});

test("template bodies are validated in isolated scopes and share component budgets", () => {
  let deep = { type: "text", body: "Leaf" };
  for (let index = 0; index < V1_LIMITS.componentDepth; index++) deep = { type: "interactive", layout: deep };
  const { protocol, extensions } = extensionFixture([fixturePackage({
    old: template({ type: "text", version: 0, body: "Older" }),
    "hidden-alias": template({ type: "text", body: "{{item}}" }),
    "model-conflict": template({ type: "interactive", state: { seed: { type: "number", default: 0 } }, layout: { type: "text", body: "value" } },
      { seed: { type: "number", default: 1 } }),
    deep: template(deep),
  })]);
  const expander = createTemplateExpander(extensions, protocol);
  const source = { path: ["children", 1],
    range: { start: { line: 10, column: 5, offset: 50 }, end: { line: 11, column: 1, offset: 74 } } };
  const expand = id => expander.expand({ id: "fixture:" + id, params: {}, source, ancestry: [] });
  const old = expand("old");
  assert.deepEqual(codes(old), ["schema.unknown-field"]);
  assert.deepEqual(old.diagnostics[0].path, source.path);
  assert.deepEqual(old.diagnostics[0].range, source.range);
  assert.match(old.diagnostics[0].message, /body \/version/);
  assert.deepEqual(codes(expand("hidden-alias")), ["semantic.unknown-identifier"]);
  assert.deepEqual(codes(expand("model-conflict")), ["semantic.name-conflict"]);
  assert.deepEqual(codes(expand("deep")), ["schema.component-depth-limit"]);
});

test("nested calls carry ancestor chains across each expansion and reject cycles and excess depth", () => {
  const depth = V1_LIMITS.templateDepth;
  const chain = Object.fromEntries(Array.from({ length: depth + 1 }, (_, index) => [
    "level-" + index, template(index === depth ? { type: "text", body: "Leaf" } : call("fixture:level-" + (index + 1))),
  ]));
  const { protocol, extensions } = extensionFixture([fixturePackage({
    ...chain, a: template(call("fixture:b")), b: template(call("fixture:a")),
  })]);
  const expander = createTemplateExpander(extensions, protocol);

  function follow(id, count) {
    let ancestry = [];
    for (let index = 0; index < count; index++) {
      const expanded = unwrap(expander.expand({ id, params: {}, source: { path: [] }, ancestry }));
      assert.equal(expanded.ancestry.length, index + 1);
      ancestry = expanded.ancestry;
      id = expanded.node.props.name;
    }
    return expander.expand({ id, params: {}, source: { path: [] }, ancestry });
  }

  assert.deepEqual(codes(follow("fixture:level-0", depth)), ["extension.template-depth-limit"]);
  assert.deepEqual(codes(follow("fixture:a", 2)), ["extension.template-cycle"]);
  const allowed = unwrap(follow("fixture:level-1", depth - 1));
  assert.equal(allowed.ancestry.length, depth);
  assert.equal(allowed.node.type, "text");
});

test("the examples and all bundled template bodies and symbol primitives validate through the shared reader", async () => {
  const { protocol, extensions } = extensionFixture();
  const example = await readFile(new URL("../../examples/extensions/gallery.md", import.meta.url), "utf8");
  const blocks = unwrap(markdownBlockScanner.scan(example, "examples/extensions/gallery.md"));
  assert.equal(blocks.length, 2);
  for (const block of blocks) unwrap(protocol.read(block));

  const expander = createTemplateExpander(extensions, protocol);
  unwrap(expander.expand({ id: name, params: { seed: 0 }, source: { path: [] }, ancestry: [] }));
  for (const extension of bundledExtensions) {
    for (const id of Object.keys(extension.symbols ?? {})) {
      const symbol = extensions.symbol(extension.namespace + ":" + id);
      unwrap(protocol.readNode({ value: { type: "svg", ...symbol }, locate: () => undefined }, { locals: new Set() }));
    }
  }
});
