import type { ComponentRegistration, ExtensionRegistry, ProtocolReader } from "#contracts";
import { basicRegistrations } from "../components/basic/index.ts";
import { chartRegistrations } from "../components/chart/index.ts";
import { controlRegistrations } from "../components/controls/index.ts";
import { graphRegistrations } from "../components/graph/index.ts";
import { sequenceRegistrations } from "../components/sequence/index.ts";
import { svgRegistrations } from "../components/svg/index.ts";
import { technicalRegistrations } from "../components/technical/index.ts";
import { expressionEngine } from "../core/expression/index.ts";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../core/protocol/index.ts";
import { createExtensionRegistry, templateRegistration } from "../core/templates/index.ts";
import { bundledExtensions } from "../extensions/index.ts";

export const activeRegistrations: readonly ComponentRegistration[] = [
  ...basicRegistrations, ...controlRegistrations, ...chartRegistrations, ...svgRegistrations,
  ...graphRegistrations, ...sequenceRegistrations, ...technicalRegistrations, templateRegistration,
];

const extensions = createExtensionRegistry();
for (const extension of bundledExtensions) {
  const result = extensions.register(extension);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(({ message }) => message).join("\n"));
  }
}
export const activeExtensions: ExtensionRegistry = extensions;

export function createActiveProtocol(): ProtocolReader {
  const catalog = createProtocolCatalog(activeRegistrations.map(({ definition }) => definition));
  if (!catalog.ok) {
    throw new Error(catalog.diagnostics.map(({ message }) => message).join("\n"));
  }
  return createProtocolReader({
    catalog: catalog.value, yaml: yamlReader, expressions: expressionEngine, extensions: activeExtensions,
  });
}
