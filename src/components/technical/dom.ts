import type {
  ComponentMountRequest, ComponentNode, Diagnostic, FieldPath, JsonValue, Lifetime, SourceLocation, ValueGuard,
} from "#contracts";

export type Mount = ComponentMountRequest & { readonly lifetime: Lifetime };

export const isText = (value: JsonValue): value is string => typeof value === "string";

export function append<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement, tag: K, className?: string,
): HTMLElementTagNameMap[K] {
  const element = parent.ownerDocument.createElement(tag);
  if (className) element.className = className;
  parent.append(element);
  return element;
}

export function location(node: ComponentNode, field: FieldPath): SourceLocation {
  let range = node.locate(field);
  // A member of a bound list maps back to the binding field in the YAML.
  for (let length = field.length - 1; !range && length > 0; length--) {
    range = node.locate(field.slice(0, length));
  }
  range ??= node.source.range;
  return { path: [...node.source.path, ...field], ...(range && { range }) };
}

export function lineIssue(
  node: ComponentNode, sourceId: string | undefined, phase: "semantic" | "render",
  field: FieldPath, issue: "code-line-out-of-range" | "code-range-order", message: string,
): Diagnostic {
  return {
    ...location(node, field), phase, code: phase + "." + issue, severity: "error", message,
    ...(sourceId !== undefined && { sourceId }),
  };
}

export function watch<T extends JsonValue>(
  { node, context, lifetime }: Mount, value: JsonValue, field: FieldPath, accepts: ValueGuard<T>,
  expected: string, apply: (value: T | undefined) => void,
): void {
  const source = location(node, field);
  if (context.bindings) {
    const observer = context.bindings.observe({ value, source, accepts, expected }, result => {
      if (lifetime.signal.aborted) return;
      for (const diagnostic of result.diagnostics) context.report(diagnostic);
      apply(result.ok ? result.value : undefined);
    });
    lifetime.add(() => observer.dispose());
  } else if (accepts(value)) {
    apply(value);
  } else {
    context.report({ ...source, phase: "render", code: "render.technical-property", severity: "error",
      message: "Expected " + expected + "." });
    apply(undefined);
  }
}

export function watchText(
  mount: Mount, value: JsonValue, field: FieldPath, apply: (value: string) => void,
): void {
  watch(mount, value, field, isText, "text", text => {
    if (text !== undefined) apply(text);
  });
}

export function scrollSurface(mount: Mount, parent: HTMLElement, fallbackLabel: string): HTMLPreElement {
  const surface = append(parent, "pre", "kui-technical-scroll");
  surface.tabIndex = 0;
  surface.setAttribute("role", "region");
  surface.setAttribute("aria-label", mount.node.ariaLabel ?? fallbackLabel);
  mount.context.host.isolateInteraction(surface, mount.lifetime);
  return surface;
}
