import type { ComponentRegistration, Diagnostic, Disposable, JsonObject, JsonValue, Result } from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";
import { frameTask } from "../expression/frame.ts";
import { record } from "../protocol/support.ts";
import { validateTemplateCall } from "./expansion.ts";

export { createTemplateExpander } from "./expansion.ts";
export { createExtensionRegistry } from "./registry.ts";

type ParameterValue = number | string | boolean;

const acceptsScalar = (value: JsonValue): value is ParameterValue =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

export const templateRegistration: ComponentRegistration = {
  definition: { ...v1ComponentSchema("template"), validate: validateTemplateCall },

  mount({ node, container, context }) {
    const { templates, bindings } = context;
    const supplied = (node.props.params ?? {}) as JsonObject;
    const entries = Object.entries(supplied);
    if (!templates || (!bindings && entries.some(([, value]) => typeof value === "string" && value.includes("{{")))) {
      const diagnostic: Diagnostic = {
        ...node.source, phase: "semantic", severity: "error", code: "semantic.capability-unavailable",
        message: "Template calls require the template service and bindings for dynamic parameters.",
      };
      return { ok: false, diagnostics: [diagnostic] };
    }

    const lifetime = context.lifetime.child();
    const root = container.ownerDocument.createElement("div");
    root.className = "kui-template";
    if (node.ariaLabel !== undefined) root.setAttribute("role", "group");
    container.append(root);
    lifetime.add(() => root.remove());

    let child: Disposable | undefined;
    let previous: JsonObject | undefined;
    const values = new Map<string, Result<ParameterValue>>();
    const clear = () => {
      child?.dispose();
      child = undefined;
      previous = undefined;
    };
    lifetime.add(clear);

    const apply = () => {
      const params = record<ParameterValue>();
      let valid = true;
      for (const [name, result] of values) {
        result.diagnostics.forEach(context.report);
        if (result.ok) params[name] = result.value;
        else valid = false;
      }
      if (lifetime.signal.aborted) return;
      if (!valid) {
        clear();
        return;
      }
      const last = previous;
      if (last && entries.every(([name]) => Object.is(last[name], params[name]))) return;

      const expanded = templates.expand({
        id: node.props.name as string, params, source: node.source, ancestry: context.templateAncestry,
      });
      for (const diagnostic of expanded.diagnostics) {
        const relative = diagnostic.path.slice(node.source.path.length);
        const range = node.locate(relative);
        context.report(range ? { ...diagnostic, range } : diagnostic);
      }
      clear();
      if (!expanded.ok) return;

      const { node: body, locals, ancestry } = expanded.value;
      const mounted = context.mountChild(body, root, { templateLocals: locals, templateAncestry: ancestry });
      mounted.diagnostics.forEach(context.report);
      if (mounted.ok) {
        child = mounted.value;
        previous = params;
      }
    };

    // Parameter observers notify synchronously once and then independently. Apply
    // their combined frame results together so sibling parameters never mix snapshots.
    const update = frameTask(apply);
    lifetime.add(() => update.dispose());
    let observing = false;
    for (const [name, value] of entries) {
      const path = ["params", name];
      const range = node.locate(path) ?? node.source.range;
      const source = { path: [...node.source.path, ...path], ...(range && { range }) };
      if (bindings) {
        const subscription = bindings.observe({ value, source, accepts: acceptsScalar, expected: "a scalar template parameter" }, result => {
          values.set(name, result);
          if (observing) update.schedule();
        });
        lifetime.add(() => subscription.dispose());
      } else if (acceptsScalar(value)) {
        values.set(name, { ok: true, value, diagnostics: [] });
      }
    }
    observing = true;
    apply();
    return { ok: true, value: { root, dispose: () => lifetime.dispose() }, diagnostics: [] };
  },
};
