import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { activeRegistrations } from "../../src/composition/protocol.ts";
import { createProtocolCatalog } from "../../src/core/protocol/index.ts";
import { renderReference } from "../../skills/knowledge-ui/scripts/component-reference.mjs";

const script = new URL("../../skills/knowledge-ui/scripts/component-reference.mjs", import.meta.url);
const reference = new URL("../../skills/knowledge-ui/references/components.md", import.meta.url);
const definitions = activeRegistrations.map(({ definition }) => definition);

function catalogOf(components) {
  const catalog = createProtocolCatalog(components);
  assert.equal(catalog.ok, true, JSON.stringify(catalog.diagnostics));
  return catalog.value;
}

test("component reference matches the production catalog and the v1 build source", () => {
  execFileSync(process.execPath, [fileURLToPath(script), "--check"], { encoding: "utf8" });
  const referenceText = readFileSync(reference, "utf8").replaceAll("\r\n", "\n");
  const catalog = catalogOf(definitions);
  const headings = [...referenceText.matchAll(/^## ([a-z-]+)$/gm)].map(([, name]) => name);
  assert.deepEqual(headings, [...catalog.components.keys()].sort());
  assert.equal(renderReference(catalogOf(definitions.toReversed())), referenceText);
});

test("generated rows expose property, required, slot and expression changes", () => {
  const changed = definitions.map(definition => {
    const schema = structuredClone(definition.schema);
    if (definition.type === "metric") {
      schema.properties.precision = { type: "integer" };
      schema.required.push("precision");
    }
    if (definition.type === "interactive") {
      schema.properties.layout = structuredClone(
        definitions.find(candidate => candidate.type === "stack").schema.properties.children,
      );
      delete schema.properties.computed.additionalProperties["x-kui-value"];
    }
    return { ...definition, schema };
  });
  const before = renderReference(catalogOf(definitions));
  const after = renderReference(catalogOf(changed));
  const row = (document, name) => document.split("\n").find(line => line.startsWith("| `" + name + "` |"));
  assert.equal(row(before, "precision"), undefined);
  assert.match(row(after, "precision"), /\| 是 \| `integer`/);
  assert.match(row(before, "layout"), /单节点插槽/);
  assert.match(row(after, "layout"), /节点列表插槽/);
  assert.match(row(before, "computed{值}"), /原始表达式/);
  assert.doesNotMatch(row(after, "computed{值}"), /原始表达式/);
});
