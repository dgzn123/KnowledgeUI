import { basicRegistrations } from "../../../src/components/basic/index.ts";
import { controlRegistrations } from "../../../src/components/controls/index.ts";
import { technicalRegistrations } from "../../../src/components/technical/index.ts";
import { bindingFactory, expressionEngine } from "../../../src/core/expression/index.ts";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../../../src/core/protocol/index.ts";
import { createComponentRegistry } from "../../../src/core/registry/index.ts";
import { createBlockRenderer } from "../../../src/core/renderer/index.ts";
import { stateFactory } from "../../../src/core/state/index.ts";

const registrations = [...basicRegistrations, ...controlRegistrations, ...technicalRegistrations];
const catalog = createProtocolCatalog(registrations.map(registration => registration.definition));
if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
export const protocol = createProtocolReader({ catalog: catalog.value, yaml: yamlReader, expressions: expressionEngine });

const registry = createComponentRegistry();
for (const registration of registrations) {
  const result = registry.register(registration);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
}

export function renderer(host, stores) {
  return createBlockRenderer({
    host, protocol, registry, bindings: bindingFactory,
    state: {
      create(...input) {
        const result = stateFactory.create(...input);
        if (result.ok) stores.push(result.value);
        return result;
      },
    },
  });
}
