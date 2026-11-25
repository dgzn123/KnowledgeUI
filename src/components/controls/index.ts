import type { ComponentRegistration } from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";
import { append, error, report, root, watchText } from "./dom.ts";
import type { Mount } from "./dom.ts";
import { actionButton, numeric, select, toggle } from "./inputs.ts";
import { quiz } from "./quiz.ts";
import { stepper } from "./stepper.ts";
import { validateControl } from "./validation.ts";

function interactive(mount: Mount): HTMLElement {
  const wrapper = root(mount, "section");
  if (mount.node.props.title !== undefined) {
    const title = append(wrapper, "h2", "kui-interactive-title");
    title.id = mount.context.instanceId + "-title";
    if (mount.node.ariaLabel === undefined) wrapper.setAttribute("aria-labelledby", title.id);
    watchText(mount, mount.node.props.title, ["title"], value => { title.textContent = value; });
  }
  const layout = mount.node.slots["/layout"]?.[0];
  if (!layout) throw new Error("Missing normalized interactive layout.");
  const child = mount.context.mountChild(layout, wrapper);
  if (child.ok) mount.lifetime.add(() => child.value.dispose());
  report(mount, child);
  return wrapper;
}

const renderers = { interactive, slider: numeric, "number-input": numeric, select, toggle, button: actionButton, stepper, quiz } as const;
type ControlType = keyof typeof renderers;
const types = Object.keys(renderers) as ControlType[];

export const controlRegistrations: readonly ComponentRegistration[] = Object.freeze(types.map<ComponentRegistration>(type => ({
  definition: { ...v1ComponentSchema(type), validate: validateControl },
  mount(request) {
    const { context } = request;
    if ((!context.state && type !== "quiz") || (type === "interactive" && !context.bindings)) {
      return { ok: false, diagnostics: [error(request, [], "control-scope", "This control requires its interactive scope.")] };
    }
    const lifetime = context.lifetime.child();
    try {
      const element = renderers[type]({ ...request, lifetime });
      if (type !== "interactive") context.host.isolateInteraction(element, lifetime);
      return { ok: true, value: { root: element, dispose: () => lifetime.dispose() }, diagnostics: [] };
    } catch {
      lifetime.dispose();
      return { ok: false, diagnostics: [error(request, [], "control-mount", "The control could not be mounted.")] };
    }
  },
})));
