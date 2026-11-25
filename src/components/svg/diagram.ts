import { V1_LIMITS } from "#contracts";
import type {
  BindingContext, CompiledExpression, ComponentMount, ComponentMountRequest, ComponentNode,
  Diagnostic, FieldPath, JsonObject, JsonValue, Lifetime, SourceLocation, ValueGuard,
} from "#contracts";
import { isArray, isObject, pointer } from "../../core/protocol/support.ts";

export const isText = (value: JsonValue): value is string => typeof value === "string";
// SVG coordinates use single-precision floats in browser layout and path parsing.
export const isNumber = (value: JsonValue): value is number =>
  typeof value === "number" && Math.abs(value) <= 3.4028234663852886e38;
export const isPositive = (value: JsonValue): value is number => isNumber(value) && value > 0 && Math.fround(value) > 0;
export const isNonnegative = (value: JsonValue): value is number => isNumber(value) && value >= 0;
export const isStep = (value: JsonValue): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
export const isId = (value: JsonValue): value is string =>
  typeof value === "string" && /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value);

const tones = ["neutral", "info", "success", "warning", "danger"] as const;
type Tone = typeof tones[number];
export const isTone = (value: JsonValue): value is Tone => tones.some(tone => tone === value);
type Paint = Tone | "none" | "current";
export const isPaint = (value: JsonValue): value is Paint => isTone(value) || value === "current" || value === "none";
export function paint(value: Paint): string {
  if (value === "none") return value;
  if (value === "neutral" || value === "current") return "currentColor";
  return "var(--kui-" + value + ")";
}

export function hasBinding(value: JsonValue): boolean {
  if (typeof value !== "string") return false;
  for (let index = value.indexOf("{{"); index !== -1; index = value.indexOf("{{", index + 2)) {
    if (value[index - 1] !== "\\") return true;
  }
  return false;
}

export function location(node: ComponentNode, path: FieldPath): SourceLocation {
  const range = node.locate(path) ?? node.source.range;
  return { path: [...node.source.path, ...path], ...(range && { range }) };
}

export function issue(node: ComponentNode, path: FieldPath, phase: "semantic" | "render", code: string, message: string): Diagnostic {
  return { ...location(node, path), phase, code: phase + "." + code, message, severity: "error" };
}

export interface Mount extends ComponentMountRequest {
  readonly lifetime: Lifetime;
  report(diagnostic: Diagnostic): void;
}

export function mountDiagram(
  draw: (mount: Mount) => HTMLElement | readonly Diagnostic[],
): ComponentMount {
  return request => {
    const { context, container } = request;
    const lifetime = context.lifetime.child();
    const reported = new Set<string>();
    const mount: Mount = {
      ...request, lifetime,
      report(diagnostic) {
        const key = JSON.stringify([diagnostic.code, diagnostic.path, diagnostic.message]);
        if (lifetime.signal.aborted || reported.has(key) || reported.size > V1_LIMITS.diagnostics) return;
        reported.add(key);
        context.report(diagnostic);
      },
    };
    let attached = false;
    try {
      const root = draw(mount);
      if (Array.isArray(root)) return { ok: false, diagnostics: root };
      const element = root as HTMLElement;
      container.append(element);
      lifetime.add(() => element.remove());
      attached = true;
      return { ok: true, value: { root: element, dispose: () => lifetime.dispose() }, diagnostics: [] };
    } finally {
      if (!attached) lifetime.dispose();
    }
  };
}

export function watch<T extends JsonValue>(
  mount: Mount, bindings: BindingContext | undefined, path: FieldPath, value: JsonValue,
  accepts: ValueGuard<T>, expected: string, apply: (value: T) => void,
): void {
  if (typeof value === "string" && value.includes("{{") && bindings) {
    const subscription = bindings.observe({ value, accepts, expected, source: location(mount.node, path) }, result => {
      if (mount.lifetime.signal.aborted) return;
      for (const diagnostic of result.diagnostics) mount.report(diagnostic);
      if (result.ok) apply(result.value);
    });
    mount.lifetime.add(() => subscription.dispose());
  } else {
    const literal = typeof value === "string" ? value.replaceAll("\\{{", "{{") : value;
    if (!hasBinding(value) && accepts(literal)) apply(literal);
    else mount.report(issue(mount.node, path, "render", "diagram-value", "Expected " + expected + "."));
  }
}

export interface Occurrence {
  readonly value: JsonObject;
  readonly path: FieldPath;
  readonly bindings: BindingContext | undefined;
  readonly condition: CompiledExpression | undefined;
}

export function compiled(node: ComponentNode, path: FieldPath): CompiledExpression | undefined {
  const key = pointer(path);
  return Object.hasOwn(node.expressions, key) ? node.expressions[key] : undefined;
}

/** Repeat inputs only depend on immutable data and inherited locals. */
export function expand(
  node: ComponentNode, value: JsonObject, path: FieldPath, bindings: BindingContext | undefined,
  report: (diagnostic: Diagnostic) => void,
): Occurrence[] {
  const condition = compiled(node, [...path, "when"]);
  if (value.repeat === undefined) return [{ value, path, bindings, condition }];

  const repeat = value.repeat;
  const itemsPath = [...path, "repeat", "items"];
  const expression = compiled(node, itemsPath);
  if (!expression || !bindings || !isObject(repeat) || typeof repeat.as !== "string") {
    report(issue(node, itemsPath, "render", "diagram-repeat", "Repeat requires its compiled expression and binding scope."));
    return [];
  }
  const result = bindings.evaluate(expression);
  for (const diagnostic of result.diagnostics) report(diagnostic);
  if (!result.ok) return [];
  if (!isArray(result.value)) {
    report(issue(node, itemsPath, "render", "diagram-repeat-type", "Repeat items must be an array."));
    return [];
  }
  if (result.value.length > V1_LIMITS.repeatIterations) {
    report(issue(node, itemsPath, "render", "diagram-repeat-limit", "The repeat iteration limit was reached."));
    return [];
  }
  const alias = repeat.as;
  const index = typeof repeat.index === "string" ? repeat.index : undefined;
  return result.value.map((item, i) => ({
    value, path, condition,
    bindings: bindings.withLocals({ [alias]: item, ...(index !== undefined && { [index]: i }) }),
  }));
}

export function watchWhen(mount: Mount, occurrence: Occurrence, show: (visible: boolean) => void): void {
  const { condition, bindings, value, path } = occurrence;
  if (value.when === undefined) {
    show(true);
    return;
  }
  const field = [...path, "when"];
  if (!condition || !bindings) {
    mount.report(issue(mount.node, field, "render", "diagram-condition", "A condition requires a compiled expression and bindings."));
    return;
  }
  const subscription = bindings.observeExpression(condition, result => {
    if (mount.lifetime.signal.aborted) return;
    for (const diagnostic of result.diagnostics) mount.report(diagnostic);
    if (result.ok && typeof result.value !== "boolean") {
      mount.report(issue(mount.node, field, "render", "diagram-condition-type", "A condition must evaluate to a boolean."));
    }
    show(result.ok && result.value === true);
  });
  mount.lifetime.add(() => subscription.dispose());
}

export function svg<K extends keyof SVGElementTagNameMap>(parent: Element | DocumentFragment, tag: K): SVGElementTagNameMap[K] {
  const element = parent.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
  parent.append(element);
  return element;
}

export function attr(element: Element, name: string, value: number | string): void {
  const text = String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
}

export function setText(element: Element, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

export function figure(mount: Mount, label: string, scroll: boolean) {
  const { container, node, context } = mount;
  const doc = container.ownerDocument;
  const root = doc.createElement("figure");
  root.className = "kui-basic kui-" + node.type;
  const title = node.props.title;
  const caption = title === undefined ? undefined : doc.createElement("figcaption");
  if (caption && title !== undefined) {
    caption.className = "kui-" + node.type + "-title";
    caption.id = context.instanceId + "-caption";
    root.append(caption);
    watch(mount, context.bindings, ["title"], title, isText, "text", value => setText(caption, value));
  }
  let canvas: HTMLElement = root;
  if (scroll) {
    canvas = doc.createElement("div");
    canvas.className = "kui-" + node.type + "-scroll";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "group");
    canvas.setAttribute("aria-label", label);
    root.append(canvas);
  }
  const drawing = svg(canvas, "svg");
  drawing.setAttribute("class", "kui-" + node.type + "-drawing");
  drawing.setAttribute("role", "img");
  if (caption && !node.ariaLabel) drawing.setAttribute("aria-labelledby", caption.id);
  else drawing.setAttribute("aria-label", node.ariaLabel ?? label);
  return { root, drawing };
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function arrowHead(tip: Point, from: Point, size = 8): string {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return "";
  const depth = Math.min(size, length * 0.45);
  const x = depth * dx / length;
  const y = depth * dy / length;
  return `M ${tip.x - x - y / 2} ${tip.y - y + x / 2} L ${tip.x} ${tip.y} L ${tip.x - x + y / 2} ${tip.y - y - x / 2}`;
}

export function occurrences(mount: Mount, key: string, limit: number): Occurrence[] | Diagnostic {
  const records = mount.node.props[key] as readonly JsonObject[];
  const result: Occurrence[] = [];
  for (const [index, record] of records.entries()) {
    const path = [key, index];
    const entries = expand(mount.node, record, path, mount.context.bindings, mount.report);
    if (result.length + entries.length > limit) {
      return issue(mount.node, path, "render", "diagram-count-limit", `Only ${limit} expanded ${key} are allowed.`);
    }
    result.push(...entries);
  }
  return result;
}

export function watchField<T extends JsonValue>(
  mount: Mount, occurrence: Occurrence, key: string,
  accepts: ValueGuard<T>, expected: string, apply: (value: T) => void,
): void {
  const raw = occurrence.value[key];
  if (raw !== undefined) watch(mount, occurrence.bindings, [...occurrence.path, key], raw, accepts, expected, apply);
}
