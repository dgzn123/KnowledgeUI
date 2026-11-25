import { basicRegistrations } from "../../../src/components/basic/index.ts";
import { chartRegistrations } from "../../../src/components/chart/index.ts";
import { controlRegistrations } from "../../../src/components/controls/index.ts";
import { bindingFactory, expressionEngine } from "../../../src/core/expression/index.ts";
import { createProtocolCatalog, createProtocolReader, markdownBlockScanner, yamlReader } from "../../../src/core/protocol/index.ts";
import { createComponentRegistry } from "../../../src/core/registry/index.ts";
import { createBlockRenderer } from "../../../src/core/renderer/index.ts";
import { stateFactory } from "../../../src/core/state/index.ts";

export function unwrap(result) {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const registrations = [...basicRegistrations, ...controlRegistrations, ...chartRegistrations];
const catalog = unwrap(createProtocolCatalog(registrations.map(entry => entry.definition)));
export const protocol = createProtocolReader({ catalog, yaml: yamlReader, expressions: expressionEngine });
export { markdownBlockScanner };

export function renderer(host, collectStore, countSample) {
  const registry = createComponentRegistry();
  for (const registration of registrations) unwrap(registry.register(registration));
  const state = {
    create(...args) {
      const result = stateFactory.create(...args);
      if (result.ok) collectStore(result.value);
      return result;
    },
  };
  const bindings = {
    create(store) {
      const context = bindingFactory.create(store);
      return {
        expressions: context.expressions,
        snapshot: () => context.snapshot(),
        resolve: input => context.resolve(input),
        observe: (input, listener) => context.observe(input, listener),
        evaluate: expression => context.evaluate(expression),
        observeExpression: (expression, listener) => context.observeExpression(expression, listener),
        withLocals(values) {
          const local = context.withLocals(values);
          if (!Object.hasOwn(values, "x")) return local;
          return {
            evaluate(expression) {
              countSample(expression.source, values.x);
              return local.evaluate(expression);
            },
          };
        },
      };
    },
  };
  return createBlockRenderer({ protocol, registry, host, state, bindings });
}
