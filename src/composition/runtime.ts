import type { BlockRenderer, HostAdapter } from "#contracts";
import { bindingFactory } from "../core/expression/index.ts";
import { createComponentRegistry } from "../core/registry/index.ts";
import { createBlockRenderer } from "../core/renderer/index.ts";
import { stateFactory } from "../core/state/index.ts";
import { createTemplateExpander } from "../core/templates/index.ts";
import { activeExtensions, activeRegistrations, createActiveProtocol } from "./protocol.ts";

const protocol = createActiveProtocol();
const templates = createTemplateExpander(activeExtensions, protocol);
const registry = createComponentRegistry();
for (const registration of activeRegistrations) {
  const result = registry.register(registration);
  if (!result.ok) {
    throw new Error(result.diagnostics.map(({ message }) => message).join("\n"));
  }
}

export function createActiveRenderer(host: HostAdapter): BlockRenderer {
  return createBlockRenderer({
    host, protocol, registry, state: stateFactory, bindings: bindingFactory, extensions: activeExtensions, templates,
  });
}
