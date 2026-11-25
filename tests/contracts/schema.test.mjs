import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { V1_LIMITS } from "#contracts";
import { createProtocolSchema, phase1ComponentTypes, v1Components, v1ComponentSchema } from "#protocol-schema";

const ajv = new Ajv2020({ strict: true });
ajv.addKeyword({ keyword: "x-kui-value", schemaType: "string", valid: true });
ajv.addKeyword({ keyword: "x-kui-slot", schemaType: "string", valid: true });

const fullSchema = createProtocolSchema(v1Components);
const validate = ajv.compile(fullSchema);
const phase1Schema = ajv.compile(createProtocolSchema(phase1ComponentTypes.map(v1ComponentSchema)));
const valid = (input) => assert.equal(validate(input), true, JSON.stringify(validate.errors));
const invalid = (input) => assert.equal(validate(input), false);

const minimal = {
  hero: { title: "Main idea" },
  text: { body: "Body" },
  markdown: { body: "**Evidence**" },
  metric: { label: "Count", value: 2 },
  badge: { label: "State" },
  callout: { body: "Constraint" },
  divider: {},
  stack: { children: [{ type: "divider" }] },
  grid: { columns: { desktop: 2, mobile: 1 }, children: [{ type: "divider" }] },
  section: { children: [{ type: "divider" }] },
  compare: { panels: Array.from({ length: 2 }, () => ({ title: "Panel", children: [{ type: "divider" }] })) },
  formula: { latex: "a=b" },
  table: { columns: [{ label: "Column" }], rows: [[1]] },
  progress: { value: 0.5 },
  tabs: { tabs: [{ title: "Tab", children: [{ type: "divider" }] }] },
  collapse: { label: "Details", content: { type: "divider" } },
  interactive: { layout: { type: "divider" } },
  slider: { bind: "n" },
  "number-input": { bind: "n" },
  select: { bind: "mode", options: [{ label: "A", value: "a" }] },
  toggle: { bind: "enabled" },
  button: { label: "Reset", action: { type: "reset", bind: "n" } },
  stepper: { bind: "step", labels: ["Initial"] },
  quiz: { question: "Continue?", options: [{ label: "Yes", correct: true }, { label: "No", correct: false }] },
  chart: { xAxis: {}, yAxis: {}, series: [{ type: "line", points: [{ x: 0, y: 1 }] }] },
  svg: { viewBox: "0 0 12 12", elements: [{ kind: "circle", cx: 6, cy: 6, r: 5 }] },
  graph: { nodes: [{ id: "a", label: "A", position: { x: 1, y: 2 } }], edges: [] },
  sequence: {
    participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    messages: [{ from: "a", to: "b", label: "Message" }],
  },
  code: { code: "sum = a + b" },
  terminal: { lines: [{ kind: "output", text: "ready" }] },
  "file-tree": { entries: [{ kind: "directory", name: "src", children: [{ kind: "file", name: "index.ts" }] }] },
  template: { name: "docs:summary" },
};

test("draft has a valid structural example for every v1 component", () => {
  assert.deepEqual(v1Components.map(({ type }) => type).sort(), Object.keys(minimal).sort());
  for (const [type, fields] of Object.entries(minimal)) {
    valid({ version: 1, type, ...fields });
    invalid({ version: 1, type, ...fields, unknown: true });
  }
});

test("root version compatibility and strict nested nodes", () => {
  valid({ type: "divider" });
  for (const version of [0, 2, "1", null]) invalid({ version, type: "divider" });
  invalid({ version: 1, type: "section", children: [{ version: 1, type: "divider" }] });
  invalid({ version: 1, type: "section", children: [{ type: "unknown", text: "invalid" }] });
  invalid({ version: 1, type: "grid", columns: "2", children: [{ type: "divider" }] });
});

test("phase 1 catalog generates a schema for its registered subset", () => {
  assert.equal(phase1Schema({ type: "stack", children: [{ type: "callout", body: "Note" }] }), true);
  assert.equal(phase1Schema({ type: "stack", children: [{ type: "svg", ...minimal.svg }] }), false);
  assert.equal(phase1Schema({ type: "interactive", ...minimal.interactive }), false);
});

test("draft restrictions cover drawing, sampling and action structure", () => {
  const svg = { version: 1, type: "svg", viewBox: "0 0 12 12" };
  invalid({ ...svg, elements: [{ kind: "foreignObject", x: 0, y: 0 }] });
  invalid({ ...svg, elements: [{ kind: "rect", x: 0, y: 0, width: 5, height: 5, href: "https://example.com" }] });
  invalid({ ...svg, elements: [{ kind: "rect", x: 0, y: 0, width: 5, height: 5, fill: "url(file.svg)" }] });
  valid({ ...svg, elements: [{ kind: "rect", x: "{{offset}}", y: 0, width: 5, height: 5, fill: "info" }] });
  invalid({
    type: "chart", xAxis: {}, yAxis: {},
    series: [{ type: "function", expr: "x", samples: V1_LIMITS.chartSamplesPerSeries + 1 }],
  });
  invalid({ type: "button", label: "Invalid", action: { type: "set", bind: "prototype", value: 1 } });
});

test("the interactive layout and SVG stepper examples conform structurally", () => {
  const layout = parse(readFileSync(new URL("fixtures/interactive-layout.yaml", import.meta.url), "utf8"));
  const stepper = parse(readFileSync(new URL("fixtures/svg-stepper.yaml", import.meta.url), "utf8"));
  assert.equal(layout.layout.children[1].series[0].expr, "...");
  valid(layout);
  valid(stepper);
});
