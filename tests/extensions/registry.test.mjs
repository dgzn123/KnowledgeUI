import assert from "node:assert/strict";
import { test } from "node:test";
import { V1_LIMITS } from "#contracts";
import { createExtensionRegistry } from "../../src/core/templates/index.ts";
import { unwrap } from "./fixtures/protocol.mjs";

const extension = (overrides = {}) => ({ namespace: "demo", version: "1.0.0", protocolVersion: 1, ...overrides });
const symbol = () => ({ viewBox: "0 0 20 20", elements: [{ kind: "line", x1: 0, y1: 10, x2: 20, y2: 10 }] });
const template = () => ({ parameters: {}, body: { type: "text", body: "Template" } });

function rejected(registry, input, code, path) {
  const result = registry.register(input);
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map(entry => [entry.code, entry.path]), [["extension." + code, path]]);
}

test("namespaces are atomic and symbols and templates have independent names", () => {
  const registry = createExtensionRegistry();
  rejected(registry, extension({ symbols: { part: symbol() }, templates: { Bad: template() } }), "invalid-name", ["templates", "Bad"]);
  assert.equal(registry.symbol("demo:part"), undefined);
  const input = extension({ symbols: { part: symbol() }, templates: { part: template() } });
  unwrap(registry.register(input));
  unwrap(registry.register(extension({ namespace: "other", templates: { part: template() } })));

  rejected(registry, extension({ version: "2.0.0", templates: { replacement: template() } }), "duplicate-namespace", ["namespace"]);
  assert.equal(registry.template("demo:replacement"), undefined);
  assert.equal(registry.symbol("demo:part").viewBox, "0 0 20 20");
  assert.equal(registry.template("demo:part").body.body, "Template");
  assert.equal(registry.template("other:part").body.body, "Template");
  assert.equal(registry.template("demo:constructor"), undefined);
  assert.equal(registry.symbol("demo:part:extra"), undefined);
  assert.equal(registry.symbol("part"), undefined);
});

test("registry snapshots declarations and their nested data", () => {
  const registry = createExtensionRegistry();
  const input = extension({ symbols: { part: symbol() }, templates: {
    part: { ...template(), parameters: { title: { type: "string", default: "Original" } } },
  } });
  unwrap(registry.register(input));
  input.templates.part.parameters.title.default = "Replacement";
  input.symbols.part.elements[0].x2 = 7;
  assert.equal(registry.template("demo:part").parameters.title.default, "Original");
  assert.equal(registry.symbol("demo:part").elements[0].x2, 20);
  assert.throws(() => { registry.template("demo:part").body.body = "Replacement"; }, TypeError);
  assert.throws(() => { registry.symbol("demo:part").elements.push({}); }, TypeError);
});

test("registry rejects retired protocol versions, malformed SemVer and invalid declarations", () => {
  const registry = createExtensionRegistry();
  for (const version of ["1", "v1.0.0", "01.0.0", "1.0.0-01", "1.0.0-rc..1", "1.0.0 ", "1.0.0\n"]) {
    rejected(registry, extension({ version }), "invalid-version", ["version"]);
  }
  rejected(registry, extension({ protocolVersion: 0 }), "protocol-version", ["protocolVersion"]);
  rejected(registry, extension({ protocolVersion: 2 }), "protocol-version", ["protocolVersion"]);
  rejected(registry, extension({ namespace: "bad:name" }), "invalid-namespace", ["namespace"]);
  rejected(registry, extension({ hook: true }), "unknown-field", ["hook"]);
  rejected(registry, extension({ symbols: { part: { viewBox: "0 0 1 1", elements: [] } } }), "invalid-declaration",
    ["symbols", "part", "elements"]);
  unwrap(registry.register(extension({ version: "0.2.11-rc.0.beta-01+build.001" })));
});

test("template declarations check parameter names, descriptions and strictly typed defaults", () => {
  const registry = createExtensionRegistry();
  const define = parameters => extension({ templates: { sample: { ...template(), parameters } } });
  for (const name of ["a-b", "len", "PI", "true", "null"]) {
    rejected(registry, define({ [name]: { type: "number" } }), "invalid-parameter", ["templates", "sample", "parameters", name]);
  }
  const field = ["templates", "sample", "parameters", "arg"];
  rejected(registry, define({ arg: { type: "number", default: "4" } }), "parameter-type", [...field, "default"]);
  rejected(registry, define({ arg: { type: "boolean", default: null } }), "parameter-type", [...field, "default"]);
  rejected(registry, define({ arg: { type: "object" } }), "invalid-parameter", [...field, "type"]);
  rejected(registry, define({ arg: { type: "string", description: 5 } }), "invalid-parameter", [...field, "description"]);
  rejected(registry, define({ arg: { type: "string", required: true } }), "unknown-field", [...field, "required"]);
});

test("declaration copying rejects getters, cyclic data, prototype fields and excessive structures", () => {
  const registry = createExtensionRegistry();
  const body = template();
  const field = ["templates", "part", "body", "child"];
  const define = child => extension({ templates: { part: { ...body, body: { ...body.body, child } } } });

  let calls = 0;
  const accessor = { get unsafe() { calls++; return true; } };
  rejected(registry, define(accessor), "invalid-data", [...field, "unsafe"]);
  assert.equal(calls, 0);
  rejected(registry, define({ ["__proto__"]: true }), "invalid-data", [...field, "__proto__"]);
  rejected(registry, define(Object.create({ inherited: true })), "invalid-data", field);
  const cycle = {};
  cycle.back = cycle;
  rejected(registry, define(cycle), "invalid-data", [...field, "back"]);
  rejected(registry, define(Array(V1_LIMITS.yamlNodes).fill(1)), "declaration-limit", field);
  const deep = Array.from({ length: V1_LIMITS.yamlDepth }).reduce(value => ({ value }), true);
  assert.equal(registry.register(define(deep)).diagnostics[0].code, "extension.declaration-limit");
  const elements = Array.from({ length: V1_LIMITS.svgElements + 1 }, () => ({ kind: "line" }));
  rejected(registry, extension({ symbols: { part: { ...symbol(), elements } } }), "symbol-element-limit",
    ["symbols", "part", "elements"]);
});
