import type {
  ComponentMountRequest, Diagnostic, FieldPath, JsonValue, Lifetime, Result, SourceLocation, StateStore,
} from "#contracts";
import { frameTask } from "../../core/expression/frame.ts";
import { ownData } from "../../core/state/constraints.ts";

export type Mount = ComponentMountRequest & { readonly lifetime: Lifetime };
const isText = (value: JsonValue): value is string => typeof value === "string";

export function append<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = parent.ownerDocument.createElement(tag);
  if (className) element.className = className;
  parent.append(element);
  return element;
}

export function root<K extends keyof HTMLElementTagNameMap>(mount: Mount, tag: K): HTMLElementTagNameMap[K] {
  const element = append(mount.container, tag, "kui-basic kui-control kui-" + mount.node.type);
  mount.lifetime.add(() => element.remove());
  return element;
}

export function listen(mount: Mount, element: HTMLElement, event: string, handle: EventListener): void {
  element.addEventListener(event, handle);
  mount.lifetime.add(() => element.removeEventListener(event, handle));
}

export function location(mount: ComponentMountRequest, field: FieldPath): SourceLocation {
  const range = field.length === 0 ? mount.node.source.range : mount.node.locate(field) ?? mount.node.source.range;
  return { path: [...mount.node.source.path, ...field], ...(range && { range }) };
}

export function error(mount: ComponentMountRequest, field: FieldPath, code: string, message: string): Diagnostic {
  return { ...location(mount, field), code: "render." + code, phase: "render", severity: "error", message };
}

export function report(mount: Mount, result: Result<unknown>): void {
  for (const diagnostic of result.diagnostics) mount.context.report(diagnostic);
}

export function watchText(mount: Mount, value: JsonValue, field: FieldPath, apply: (text: string) => void): void {
  const bindings = mount.context.bindings;
  if (!bindings) {
    if (isText(value)) apply(value);
    return;
  }
  const observer = bindings.observe({ value, source: location(mount, field), accepts: isText, expected: "text" }, result => {
    if (mount.lifetime.signal.aborted) return;
    if (result.ok) apply(result.value);
    report(mount, result);
  });
  mount.lifetime.add(() => observer.dispose());
}

export function watchState(mount: Mount, store: StateStore, name: string, apply: (value: JsonValue | undefined) => void): void {
  const task = frameTask(() => apply(store.get(name)));
  const subscription = store.subscribe(new Set([name]), () => task.schedule());
  mount.lifetime.add(() => {
    subscription.dispose();
    task.dispose();
  });
  apply(store.get(name));
}

export function label(mount: Mount, element: HTMLElement, bind: string, labelElement: HTMLElement): void {
  const fallback = ownData(mount.context.state!.definitions, bind)?.label ?? bind;
  labelElement.textContent = fallback;
  if (mount.node.props.label !== undefined) {
    watchText(mount, mount.node.props.label, ["label"], value => { labelElement.textContent = value || fallback; });
  }
  if (mount.node.ariaLabel !== undefined) element.setAttribute("aria-label", mount.node.ariaLabel);
}

export function controlLabel(mount: Mount, wrapper: HTMLElement, input: HTMLInputElement | HTMLSelectElement, bind: string): void {
  input.id = mount.context.instanceId + "-input";
  const text = append(wrapper, "label", "kui-control-label");
  text.htmlFor = input.id;
  label(mount, input, bind, text);
  wrapper.insertBefore(text, input);
}
