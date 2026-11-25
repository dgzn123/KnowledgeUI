import { controlRegistrations } from "../../../src/components/controls/index.ts";
import { basicRegistrations } from "../../../src/components/basic/index.ts";
import { bindingFactory, expressionEngine } from "../../../src/core/expression/index.ts";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../../../src/core/protocol/index.ts";
import { createComponentRegistry } from "../../../src/core/registry/index.ts";
import { createBlockRenderer } from "../../../src/core/renderer/index.ts";
import { stateFactory } from "../../../src/core/state/index.ts";

const registrations = [...basicRegistrations, ...controlRegistrations];
const catalog = createProtocolCatalog(registrations.map(entry => entry.definition));
if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));

export const protocol = createProtocolReader({ catalog: catalog.value, yaml: yamlReader, expressions: expressionEngine });
const registry = createComponentRegistry();
for (const registration of registrations) {
  const result = registry.register(registration);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
}

export function renderer(host, collectStore) {
  const state = {
    create(...args) {
      const result = stateFactory.create(...args);
      if (result.ok) collectStore(result.value);
      return result;
    },
  };
  return createBlockRenderer({ protocol, registry, host, state, bindings: bindingFactory });
}
