import { v1ComponentSchema } from "#protocol-schema";
import { basicRegistrations } from "../../../src/components/basic/index.ts";
import { controlRegistrations } from "../../../src/components/controls/index.ts";
import { expressionEngine } from "../../../src/core/expression/index.ts";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../../../src/core/protocol/index.ts";
import { createExtensionRegistry, templateRegistration } from "../../../src/core/templates/index.ts";
import { bundledExtensions } from "../../../src/extensions/index.ts";

export function unwrap(result) {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

// Agent 06 owns SVG geometry and rendering. This fixture exercises the common
// SVG structure schema and read-only directory lookup through both contracts.
const svgFixture = {
  definition: {
    ...v1ComponentSchema("svg"),
    validate({ node, extensions, sourceId }) {
      const diagnostics = [];
      for (const [index, item] of node.props.elements.entries()) {
        if (item.kind !== "use-symbol" || extensions?.symbol(item.symbol)) continue;
        const path = ["elements", index, "symbol"];
        diagnostics.push({
          phase: "extension", code: "fixture.symbol-missing", severity: "error", message: "Symbol not registered.",
          path: [...node.source.path, ...path], sourceId, range: node.locate(path),
        });
      }
      return diagnostics;
    },
  },
  mount({ node, container, context }) {
    const root = container.ownerDocument.createElement("div");
    root.className = "kui-svg-directory-fixture";
    for (const element of node.props.elements) {
      if (element.kind !== "use-symbol") continue;
      const definition = context.extensions.symbol(element.symbol);
      const entry = root.appendChild(container.ownerDocument.createElement("span"));
      entry.dataset.symbol = element.symbol;
      entry.textContent = String(definition.elements.length);
    }
    container.append(root);
    return { ok: true, value: { root, dispose: () => root.remove() }, diagnostics: [] };
  },
};

export function extensionFixture(extra = []) {
  const extensions = createExtensionRegistry();
  for (const extension of [...bundledExtensions, ...extra]) unwrap(extensions.register(extension));

  const registrations = [...basicRegistrations, ...controlRegistrations, templateRegistration, svgFixture];
  const catalog = unwrap(createProtocolCatalog(registrations.map(item => item.definition)));
  const protocol = createProtocolReader({ catalog, yaml: yamlReader, extensions, expressions: expressionEngine });
  return { extensions, registrations, protocol };
}
