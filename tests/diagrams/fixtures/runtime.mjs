import { basicRegistrations } from "../../../src/components/basic/index.ts";
import { controlRegistrations } from "../../../src/components/controls/index.ts";
import { graphRegistrations } from "../../../src/components/graph/index.ts";
import { sequenceRegistrations } from "../../../src/components/sequence/index.ts";
import { svgRegistrations } from "../../../src/components/svg/index.ts";
import { bindingFactory, expressionEngine } from "../../../src/core/expression/index.ts";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../../../src/core/protocol/index.ts";
import { createComponentRegistry } from "../../../src/core/registry/index.ts";
import { createBlockRenderer } from "../../../src/core/renderer/index.ts";
import { stateFactory } from "../../../src/core/state/index.ts";

const registrations = [...basicRegistrations, ...controlRegistrations, ...svgRegistrations, ...graphRegistrations, ...sequenceRegistrations];
const catalog = createProtocolCatalog(registrations.map(entry => entry.definition));
if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));

// Pure-data fixtures only. The production extension catalog belongs to Agent 08.
export const line = Object.freeze({ kind: "line", x1: 0, y1: 0, x2: 24, y2: 0 });
export const symbol = id => ({ kind: "use-symbol", symbol: id, x: 0, y: 0, width: 40, height: 40 });
const symbols = new Map([
  ["fixture:tile", {
    viewBox: "0 0 40 40",
    elements: [
      { kind: "clip", id: "mask", elements: [{ kind: "circle", cx: 20, cy: 20, r: 12 }] },
      { kind: "rect", id: "swatch", x: 0, y: 0, width: 40, height: 40, clip: "mask", fill: "info" },
    ],
  }],
  ["fixture:rows", { viewBox: "0 0 40 40", elements: Array.from({ length: 4 }, () => line) }],
  ["fixture:bad", { viewBox: "0 0 40 40", elements: [{ ...line, href: "data:text/html,fixture" }] }],
  ["fixture:cycle", { viewBox: "0 0 40 40", elements: [symbol("fixture:cycle")] }],
  ["fixture:dynamic", { viewBox: "0 0 40 40", elements: [{ ...line, x2: "{{offset}}" }] }],
  ["fixture:zero", { viewBox: "0 0 0 40", elements: [line] }],
]);
export const extensions = { symbol: id => symbols.get(id), template: () => undefined };

export function protocolWith(catalogue = extensions) {
  return createProtocolReader({ catalog: catalog.value, yaml: yamlReader, expressions: expressionEngine, extensions: catalogue });
}
export const protocol = protocolWith();

const registry = createComponentRegistry();
for (const registration of registrations) {
  const result = registry.register(registration);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
}

export function renderer(host, collectStore, runtimeExtensions = extensions) {
  const state = {
    create(...args) {
      const result = stateFactory.create(...args);
      if (result.ok) collectStore(result.value);
      return result;
    },
  };
  return createBlockRenderer({ protocol, registry, host, state, bindings: bindingFactory, extensions: runtimeExtensions });
}
