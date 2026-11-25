import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { v1Components } from "#protocol-schema";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../../src/core/protocol/index.ts";
import { expressionFixture, unwrap } from "./fixtures.ts";

test("the runtime interpreter and catalog JSON Schema agree on static v1 structures", () => {
  const ajv = new Ajv2020({ strict: true });
  ajv.addKeyword({ keyword: "x-kui-value", schemaType: "string", valid: true });
  ajv.addKeyword({ keyword: "x-kui-slot", schemaType: "string", valid: true });
  const catalog = unwrap(createProtocolCatalog(v1Components));
  const validate = ajv.compile(catalog.schema);
  const protocol = createProtocolReader({ catalog, yaml: yamlReader, expressions: expressionFixture });
  const divider = { type: "divider" };
  const svg = { type: "svg", viewBox: "0 0 12 12" };
  const circle = { kind: "circle", cx: 6, cy: 6, r: 5 };
  const interactive = { type: "interactive", layout: divider };
  const panel = { title: "Panel", children: [divider] };
  const cases = [
    { version: 1, ...divider },
    { version: "1", ...divider },
    { type: "text", body: "Sample", tone: "info" },
    { type: "text", body: "Sample", tone: "blue" },
    { type: "text", body: "Sample", ariaLabel: "字".repeat(257) },
    { type: "text", body: "Sample", ariaLabel: "𠮷".repeat(256) },
    { type: "grid", columns: { desktop: 2, mobile: 1 }, children: [divider] },
    { type: "grid", columns: "2", children: [divider] },
    { type: "grid", columns: 2, children: [{ version: 1, ...divider }] },
    { type: "compare", panels: [panel, panel] },
    { type: "compare", panels: [panel] },
    { type: "compare", panels: [panel, { ...panel, unexpected: true }] },
    { type: "table", columns: [{ label: "Measure" }], rows: [[null, 1, "label"]] },
    { type: "file-tree", entries: [{ kind: "directory", name: "Folder", children: [{ kind: "file", name: "Note" }] }] },
    { ...svg, elements: [{ kind: "group", elements: [circle] }] },
    { ...svg, elements: [{ ...circle, r: 0 }] },
    { ...svg, elements: [{ ...circle, href: "image.svg" }] },
    { ...svg, elements: [{ kind: "unrecognized" }] },
    { ...interactive, data: { rows: [[{ detail: null }], "text", true] } },
    { ...interactive, data: { "invalid-key": true } },
    { ...interactive, state: { ready: { type: "boolean", default: "true" } } },
  ];
  for (const value of cases) {
    const result = protocol.read({ yaml: JSON.stringify(value) });
    assert.equal(result.ok, validate(value), JSON.stringify({ value, diagnostics: result.diagnostics }));
  }
});
