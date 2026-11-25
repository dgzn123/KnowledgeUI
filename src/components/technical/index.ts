import type { ComponentRegistration } from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";
import { mountCode } from "./code.ts";
import { append, watchText } from "./dom.ts";
import { mountFileTree } from "./file-tree.ts";
import { mountTerminal } from "./terminal.ts";
import { validateCode } from "./validation.ts";

const renderers = { code: mountCode, terminal: mountTerminal, "file-tree": mountFileTree } as const;
type TechnicalType = keyof typeof renderers;

export const technicalRegistrations: readonly ComponentRegistration[] = Object.freeze(
  (Object.keys(renderers) as TechnicalType[]).map<ComponentRegistration>(type => ({
    definition: type === "code" ? { ...v1ComponentSchema(type), validate: validateCode } : v1ComponentSchema(type),
    mount(request) {
      const { node, context, container } = request;
      const lifetime = context.lifetime.child();
      const mount = { ...request, lifetime };
      try {
        const root = append(container, "figure", "kui-basic kui-technical kui-" + type);
        lifetime.add(() => root.remove());
        if (node.props.title !== undefined) {
          const title = append(root, "figcaption", "kui-technical-title");
          watchText(mount, node.props.title, ["title"], value => { title.textContent = value; });
        }
        renderers[type](mount, root);
        return { ok: true, value: { root, dispose: () => lifetime.dispose() }, diagnostics: [] };
      } catch (error) {
        lifetime.dispose();
        throw error;
      }
    },
  })),
);
