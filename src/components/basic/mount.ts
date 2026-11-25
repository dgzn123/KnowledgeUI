import type {
  ComponentMountRequest, ComponentValidationInput, Diagnostic, FieldPath, JsonObject, JsonValue, Lifetime, ValueGuard,
} from "#contracts";

export interface BasicMount extends ComponentMountRequest {
  readonly lifetime: Lifetime;
}

export function own<T>(object: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);
}

export function append<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement, tag: K, className?: string,
): HTMLElementTagNameMap[K] {
  const element = parent.ownerDocument.createElement(tag);
  if (className) element.className = className;
  parent.append(element);
  return element;
}

export function rootElement<K extends keyof HTMLElementTagNameMap>(
  mount: BasicMount, tag: K, labelRole?: "group" | "region",
): HTMLElementTagNameMap[K] {
  const root = append(mount.container, tag, "kui-basic kui-" + mount.node.type);
  mount.lifetime.add(() => root.remove());
  if (mount.node.ariaLabel !== undefined) {
    if (labelRole) root.setAttribute("role", labelRole);
    root.setAttribute("aria-label", mount.node.ariaLabel);
  }
  return root;
}

export function labelFrom(root: HTMLElement, heading: HTMLElement | undefined, id: string): void {
  if (!heading || root.hasAttribute("aria-label")) return;
  heading.id = id;
  root.setAttribute("aria-labelledby", id);
}

const tones = ["neutral", "info", "success", "warning", "danger"] as const;
type Tone = (typeof tones)[number];
const isTone = (value: JsonValue): value is Tone => tones.some(tone => tone === value);

export function setTone(mount: BasicMount, element: HTMLElement): void {
  element.dataset.tone = "neutral";
  watch(mount, own(mount.node.props, "tone"), ["tone"], isTone, "a semantic tone",
    tone => { element.dataset.tone = tone; });
}

export function listen<K extends keyof HTMLElementEventMap>(
  mount: BasicMount, element: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void,
): void {
  element.addEventListener(type, listener);
  mount.lifetime.add(() => element.removeEventListener(type, listener));
}

export function diagnostic(
  { node, context }: ComponentMountRequest, code: string, message: string, field: FieldPath = [],
): Diagnostic {
  const range = field.length ? node.locate(field) : node.source.range;
  return {
    phase: code.startsWith("host.") ? "host" : "render",
    code,
    severity: "error",
    message,
    path: [...node.source.path, ...field],
    ...(range && { range }),
    ...(context.sourceId !== undefined && { sourceId: context.sourceId }),
  };
}

export function semanticIssue(
  { node, sourceId }: ComponentValidationInput, code: string, message: string, field: FieldPath,
): Diagnostic {
  const range = node.locate(field) ?? node.source.range;
  return {
    phase: "semantic", severity: "error", code, message, path: [...node.source.path, ...field],
    ...(range && { range }), ...(sourceId !== undefined && { sourceId }),
  };
}

export function mountSlot(mount: BasicMount, container: HTMLElement, pointer: string): void {
  const children = own(mount.node.slots, pointer);
  if (!children) throw new Error("Missing normalized slot " + pointer);

  for (const child of children) {
    if (mount.lifetime.signal.aborted) break;
    const result = mount.context.mountChild(child, container);
    if (result.ok) mount.lifetime.add(() => result.value.dispose());
    for (const item of result.diagnostics) mount.context.report(item);
  }
}

export function watch<T extends JsonValue>(
  mount: BasicMount, value: JsonValue | undefined, field: FieldPath, accepts: ValueGuard<T>,
  expected: string, apply: (value: T) => void, invalidate?: () => void,
): void {
  if (value === undefined || mount.lifetime.signal.aborted) return;

  const { bindings } = mount.context;
  if (bindings) {
    const range = mount.node.locate(field);
    const subscription = bindings.observe({
      value, accepts, expected,
      source: { path: [...mount.node.source.path, ...field], ...(range && { range }) },
    }, result => {
      if (mount.lifetime.signal.aborted) return;
      if (result.ok) apply(result.value);
      else invalidate?.();
      for (const item of result.diagnostics) mount.context.report(item);
    });
    mount.lifetime.add(() => subscription.dispose());
  } else if (accepts(value)) {
    apply(value);
  } else {
    invalidate?.();
    mount.context.report(diagnostic(mount, "render.basic-property", "Expected " + expected, field));
  }
}

const isString = (value: JsonValue): value is string => typeof value === "string";

export function watchText(
  mount: BasicMount, value: JsonValue | undefined, field: FieldPath, apply: (text: string) => void,
): void {
  watch(mount, value, field, isString, "text", apply);
}

export function textField<K extends keyof HTMLElementTagNameMap>(
  mount: BasicMount, parent: HTMLElement, tag: K, className: string, field: string,
): HTMLElementTagNameMap[K] | undefined {
  const value = own(mount.node.props, field);
  if (value === undefined) return;
  const element = append(parent, tag, className);
  watchText(mount, value, [field], text => { element.textContent = text; });
  return element;
}
