import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { createProtocolSchema, phase1ComponentTypes, v1ComponentSchema } from "#protocol-schema";
import { basicRegistrations } from "../../src/components/basic/index.ts";
import { readGallery } from "./fixtures/protocol.mjs";

test("basic registrations retain Phase 1 and implement all five supplemental schemas", () => {
  assert.deepEqual(basicRegistrations.map(({ definition }) => definition.type),
    [...phase1ComponentTypes, "table", "formula", "progress", "tabs", "collapse"]);
  for (const { definition, mount } of basicRegistrations) {
    const declared = v1ComponentSchema(definition.type);
    assert.equal(definition.schema, declared.schema);
    if (phase1ComponentTypes.includes(definition.type)) assert.equal(definition, declared);
    assert.equal(typeof mount, "function");
  }
});

test("every Gallery block uses only static Phase 1 fields and the Gallery covers all 11 components", () => {
  const source = readFileSync(new URL("../../examples/gallery/basic.md", import.meta.url), "utf8");
  const blocks = readGallery(source);
  assert.ok(blocks.length > 0);
  assert.equal(blocks.length, [...source.matchAll(/^```kui$/gm)].length);

  const ajv = new Ajv2020({ strict: true });
  ajv.addKeyword({ keyword: "x-kui-value", schemaType: "string", valid: true });
  ajv.addKeyword({ keyword: "x-kui-slot", schemaType: "string", valid: true });
  const validate = ajv.compile(createProtocolSchema(phase1ComponentTypes.map(v1ComponentSchema)));

  const covered = new Set();
  for (const block of blocks) {
    assert.equal(block.version, 1);
    assert.equal(validate(block), true, JSON.stringify(validate.errors));
    inspect(block);
  }
  assert.deepEqual([...covered].sort(), [...phase1ComponentTypes].sort());

  function inspect(value) {
    if (typeof value === "string") assert.doesNotMatch(value, /\{\{/);
    if (!value || typeof value !== "object") return;
    assert.equal(Object.hasOwn(value, "when"), false);
    assert.equal(Object.hasOwn(value, "repeat"), false);
    if (Object.hasOwn(value, "type")) covered.add(value.type);
    Object.values(value).forEach(inspect);
  }
});
