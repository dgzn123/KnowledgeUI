import assert from "node:assert/strict";
import test from "node:test";
import { V1_LIMITS } from "#contracts";
import type { JsonObject, JsonValue } from "#contracts";
import { phase1ComponentTypes, v1Components, v1ComponentSchema } from "#protocol-schema";
import { createProtocolCatalog, yamlReader } from "../../src/core/protocol/index.ts";
import { expressionFixture, phase1Fixture, unwrap } from "./fixtures.ts";

const protocol = phase1Fixture();
const read = (yaml: string) => protocol.read({ yaml, sourceId: "note.md" });

test("missing version warns, explicit version must be numeric 1", () => {
  const result = read("type: metric\nlabel: Sample\nvalue: 4\n");
  assert.equal(unwrap(result).version, 1);
  assert.equal(unwrap(result).root.props.value, 4);
  assert.equal(result.diagnostics[0]?.code, "schema.version-defaulted");
  assert.equal(result.diagnostics[0].severity, "warning");
  assert.deepEqual(result.diagnostics[0].path, ["version"]);

  for (const value of ["2", "0", "1.1", "'1'", "true", "null"]) {
    const invalid = read(`version: ${value}\ntype: divider\n`);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.diagnostics[0]?.code, "schema.unsupported-version");
    assert.deepEqual(invalid.diagnostics[0].path, ["version"]);
    assert.equal(invalid.diagnostics[0].sourceId, "note.md");
    assert.deepEqual(invalid.diagnostics[0].range?.start, { offset: 9, line: 1, column: 10 });
  }
});

test("strict nested structures report independent child and property diagnostics", () => {
  const invalid = read(
    "version: 1\ntype: grid\ncolumns: {desktop: 2, mobile: false, mystery: 1}\n" +
    "children:\n  - {type: text, body: 42, extra: true}\n  - {type: chart}\n  - {type: whatever}\n" +
    "  - {type: divider, version: 1}\n  - {type: hero}\n",
  );
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.diagnostics.map(({ code, path }) => [code, path]), [
    ["schema.type", ["columns", "mobile"]],
    ["schema.unknown-field", ["columns", "mystery"]],
    ["schema.type", ["children", 0, "body"]],
    ["schema.unknown-field", ["children", 0, "extra"]],
    ["schema.component-unavailable", ["children", 1, "type"]],
    ["schema.unknown-type", ["children", 2, "type"]],
    ["schema.unknown-field", ["children", 3, "version"]],
    ["schema.required", ["children", 4, "title"]],
  ]);
  assert.equal(invalid.diagnostics[4]?.range?.start.line, 6);
  assert.equal(invalid.diagnostics[4]?.range?.start.column, 12);
});

test("slot normalization retains sibling metadata and source ranges", () => {
  const yaml = "version: 1\ntype: compare\nariaLabel: Alternatives\ntitle: Options\npanels:\n" +
    "  - title: Alpha\n    children:\n      - {type: text, body: First}\n" +
    "  - title: Beta\n    children:\n      - {type: divider}\n";
  const { root } = unwrap(read(yaml));
  assert.equal(root.ariaLabel, "Alternatives");
  assert.deepEqual(JSON.parse(JSON.stringify(root.props)), { title: "Options", panels: [{ title: "Alpha" }, { title: "Beta" }] });
  assert.deepEqual(Object.keys(root.slots), ["/panels/0/children", "/panels/1/children"]);
  const first = root.slots["/panels/0/children"]?.[0];
  assert.deepEqual(first?.source.path, ["panels", 0, "children", 0]);
  assert.equal(first?.locate(["body"])?.start.line, 8);
  const range = root.locate(["panels", 0, "children", 0, "body"]);
  assert.deepEqual(first?.locate(["body"]), range);
  assert.equal(yaml.slice(range?.start.offset, range?.end.offset), "First");
});

test("single slots and JSON Pointer escaping come from the injected registration", () => {
  const type = "panel-fixture";
  const schema = v1ComponentSchema("collapse").schema;
  const registration = {
    ...v1ComponentSchema("collapse"),
    type,
    schema: {
      ...schema,
      required: ["type", "a/b~"],
      properties: {
        type: { const: type },
        "a/b~": schema.properties.content!,
      },
    },
  };
  const fixture = phase1Fixture([registration, v1ComponentSchema("text")]);
  const { root } = unwrap(fixture.read({ yaml: `version: 1\ntype: ${type}\na/b~: {type: text, body: Literal}\n` }));
  assert.equal(root.slots["/a~1b~0"]?.[0]?.props.body, "Literal");
  assert.equal(root.props["a/b~"], undefined);
});

test("catalog rejects duplicate or mismatched registrations and publishes the active schema", () => {
  const text = v1ComponentSchema("text");
  assert.equal(createProtocolCatalog([text, text]).diagnostics[0]?.code, "schema.duplicate-type");
  assert.equal(createProtocolCatalog([{ ...text, type: "anything" }]).diagnostics[0]?.code, "schema.invalid-definition");
  const catalog = unwrap(createProtocolCatalog([text]));
  assert.deepEqual([...catalog.components.keys()], ["text"]);
  assert.equal(JSON.stringify(catalog.schema).includes('"const":"chart"'), false);
});

test("component semantic callbacks receive normalized ASTs and shared extensions", () => {
  const extensions = { symbol: () => undefined, template: () => undefined };
  const text = v1ComponentSchema("text");
  let calls = 0;
  const fixture = phase1Fixture([{
    ...text,
    validate({ node, state, sourceId, extensions: provided }) {
      calls++;
      assert.equal(node.props.body, "Sample");
      assert.deepEqual(Object.keys(state), []);
      assert.equal(provided, extensions);
      assert.equal(sourceId, "callback.md");
      return [{ phase: "semantic", code: "semantic.fixture", path: [...node.source.path, "body"], severity: "error", message: "Rejected by fixture." }];
    },
  }], { extensions });
  const bad = fixture.read({ yaml: "type: text\nbody: 1\n", sourceId: "callback.md" });
  assert.equal(bad.ok, false);
  assert.equal(calls, 0);
  const result = fixture.read({ yaml: "type: text\nbody: Sample\n", sourceId: "callback.md" });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  const rejected = result.diagnostics.find(item => item.code === "semantic.fixture");
  assert.equal(rejected?.range?.start.line, 2);
});

test("Phase 1 reports dynamic capabilities with field locations", () => {
  for (const [yaml, path] of [
    ["type: text\nbody: '{{name}}'\n", ["body"]],
    ["type: metric\nlabel: Count\nvalue: '{{step}}'\n", ["value"]],
    ["type: divider\nwhen: 'true'\n", ["when"]],
    ["type: divider\nrepeat: {items: values, as: value}\n", ["repeat"]],
  ] as const) {
    const result = read(yaml);
    assert.equal(result.ok, false);
    const diagnostic = result.diagnostics.find(item => item.code === "semantic.capability-unavailable");
    assert.deepEqual(diagnostic?.path, path);
    assert.ok(diagnostic?.range);
  }
  assert.equal(read("type: text\nbody: '\\{{literal}}'\n").ok, true);
  assert.equal(read("type: text\nmarkdown: true\nbody: literal }}\n").ok, true);
});

test("readNode accepts declared locals and rejects root-only version and unsafe template values", () => {
  const fixture = phase1Fixture(undefined, { expressions: expressionFixture });
  const values = unwrap(yamlReader.read({ yaml: "type: text\nwhen: ready\nbody: '{{name}}'\n" }));
  const scope = { sourceId: "template", locals: new Set(["ready", "name"]) };
  const node = unwrap(fixture.readNode(values, scope));
  assert.equal(node.when?.source, "ready");
  assert.equal(node.props.body, "{{name}}");
  assert.deepEqual(node.when?.location.path, ["when"]);
  assert.equal(node.when?.location.range?.start.line, 2);
  assert.equal(fixture.readNode(values, { ...scope, locals: new Set() }).ok, false);
  assert.equal(fixture.readNode({ ...values, value: { type: "text", body: "ok", version: 1 } }, scope).ok, false);

  const cycle: Record<string, JsonValue> = { type: "text" };
  cycle.body = cycle;
  const getter = { type: "text", get body(): never { throw new Error("Unexpected getter"); } };
  const reserved = JSON.parse('{"type":"text","constructor":1}') as JsonObject;
  const inherited = Object.create({ type: "text" }) as JsonObject;
  for (const value of [cycle, getter, reserved, inherited, { type: "text", body: Number.NaN }]) {
    assert.equal(fixture.readNode({ ...values, value }, scope).diagnostics[0]?.code, "schema.invalid-data");
  }
});

test("expression injection checks repeat and model scopes and indexes raw prop expressions", () => {
  const fixture = phase1Fixture(v1Components, { expressions: expressionFixture });
  const result = fixture.read({ yaml:
    "version: 1\ntype: interactive\nstate: { step: { type: number, default: 0 } }\n" +
    "data: { rows: [one, two] }\ncomputed: { first: second, second: step }\ntitle: '{{first}}'\n" +
    "layout:\n  type: stack\n  children:\n" +
    "    - type: text\n      repeat: { items: rows, as: item, index: idx }\n      when: item\n      body: 'Row {{idx}}'\n" +
    "    - type: chart\n      xAxis: {}\n      yAxis: {}\n      series: [{ type: function, expr: x }]\n",
  });
  const { root } = unwrap(result);
  assert.equal(root.model?.state.step?.default, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(root.model?.data)), { rows: ["one", "two"] });
  assert.deepEqual(Object.keys(root.props), ["title"]);
  const [repeated, chart] = root.slots["/layout"]?.[0]?.slots["/children"] ?? [];
  assert.equal(repeated?.repeat?.items.source, "rows");
  assert.equal(repeated?.when?.source, "item");
  assert.equal(chart?.expressions["/series/0/expr"]?.source, "x");
  assert.deepEqual(chart?.expressions["/series/0/expr"]?.location.path, ["layout", "children", 1, "series", 0, "expr"]);

  const rejected = fixture.read({ yaml:
    "type: interactive\nstate: { step: { type: number, default: 0 } }\ncomputed: { a: b, b: a }\n" +
    "layout: { type: divider, repeat: { items: step, as: step } }\n",
  });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.diagnostics.some(item => item.code === "semantic.computed-cycle"));
  assert.ok(rejected.diagnostics.some(item => item.code === "semantic.name-conflict"));
  assert.ok(rejected.diagnostics.some(item => item.code === "semantic.unknown-identifier"));
});

test("component depth, aggregate instance count and diagnostics are bounded", () => {
  const nested = (depth: number) =>
    "version: 1\n" + Array.from({ length: depth - 1 }, (_, i) => " ".repeat(i * 4) + (i ? "- " : "") + "type: stack\n" +
      " ".repeat(i * 4 + (i ? 2 : 0)) + "children:\n").join("") +
      " ".repeat((depth - 1) * 4) + "- type: divider\n";
  assert.equal(read(nested(V1_LIMITS.componentDepth)).ok, true);
  // Use single slots to exceed the component depth before reaching the YAML depth.
  const collapse = phase1Fixture([...phase1ComponentTypes.map(v1ComponentSchema), v1ComponentSchema("collapse")]);
  const chain = "type: collapse\nlabel: Show\ncontent:\n";
  const deep = Array.from({ length: V1_LIMITS.componentDepth }, (_, depth) => chain.replace(/^(?=.)/gm, "  ".repeat(depth))).join("")
    + "  ".repeat(V1_LIMITS.componentDepth) + "type: divider\n";
  assert.ok(collapse.read({ yaml: deep }).diagnostics.some(item => item.code === "schema.component-depth-limit"));

  const wide = "type: stack\nchildren:\n" + "  - type: divider\n".repeat(V1_LIMITS.componentInstances);
  assert.ok(read(wide).diagnostics.some(item => item.code === "schema.component-count-limit"));
  const unknown = "type: divider\n" + Array.from({ length: 110 }, (_, index) => `field${index}: true\n`).join("");
  const diagnostics = read(unknown).diagnostics;
  assert.equal(diagnostics.length, V1_LIMITS.diagnostics);
  assert.equal(diagnostics.at(-1)?.code, "diagnostics.truncated");
});

test("nested expressions inherit repeat aliases and interactive layouts keep an independent scope", () => {
  const fixture = phase1Fixture(v1Components, { expressions: expressionFixture });
  const scoped = fixture.read({ yaml:
    "type: interactive\ndata: { rows: [one] }\nlayout:\n" +
    "  type: svg\n  viewBox: '0 0 10 10'\n  elements:\n" +
    "    - kind: group\n      repeat: { items: rows, as: row }\n      when: row\n" +
    "      elements: [{kind: text, x: 1, y: 1, text: '{{row}}'}]\n",
  });
  const layout = unwrap(scoped).root.slots["/layout"]?.[0];
  assert.equal(layout?.expressions["/elements/0/repeat/items"]?.source, "rows");
  assert.equal(layout?.expressions["/elements/0/when"]?.source, "row");

  const nested = fixture.read({ yaml:
    "type: interactive\ndata: { parent: [one] }\nlayout:\n" +
    "  type: interactive\n  when: parent\n  layout: { type: text, body: '{{parent}}' }\n",
  });
  assert.equal(nested.ok, false);
  assert.deepEqual(nested.diagnostics.filter(item => item.code === "semantic.unknown-identifier").map(item => item.path),
    [["layout", "layout", "body"]]);
});
