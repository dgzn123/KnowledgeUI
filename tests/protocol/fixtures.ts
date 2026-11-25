import assert from "node:assert/strict";
import type { ComponentSchema, ExpressionEngine, ProtocolDependencies, Result } from "#contracts";
import { phase1ComponentTypes, v1ComponentSchema } from "#protocol-schema";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../../src/core/protocol/index.ts";

export function unwrap<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  if (!result.ok) throw new Error("Invalid fixture result");
  return result.value;
}

export function phase1Fixture(
  definitions: readonly ComponentSchema[] = phase1ComponentTypes.map(v1ComponentSchema),
  dependencies: Pick<ProtocolDependencies, "expressions" | "extensions"> = {},
) {
  return createProtocolReader({ catalog: unwrap(createProtocolCatalog(definitions)), yaml: yamlReader, ...dependencies });
}

/** Exercise the protocol's dependency handling with explicit fixture identifiers. */
export const expressionFixture: ExpressionEngine = {
  compile(source, location) {
    const names = /^[A-Za-z_][A-Za-z0-9_]*(?: [A-Za-z_][A-Za-z0-9_]*)*$/.test(source)
      ? source.split(" ").filter(name => name !== "true")
      : [];
    return { ok: true, value: { source, location, dependencies: new Set(names) }, diagnostics: [] };
  },
  evaluate() {
    throw new Error("Protocol validation must not evaluate expressions.");
  },
};
