import type { ComponentRegistration, JsonObject, JsonValue } from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";
import { isArray } from "../../core/protocol/support.ts";
import { frameTask } from "../../core/expression/frame.ts";
import { arrowHead, attr, figure, isPaint, issue, mountDiagram, paint, setText, svg, watch, watchWhen } from "./diagram.ts";
import type { Mount } from "./diagram.ts";
import { clipTarget, planSvg } from "./plan.ts";
import type { ElementPlan } from "./plan.ts";
import { elementFields } from "./values.ts";

const tags = {
  line: "line", arrow: "path", rect: "rect", circle: "circle", ellipse: "ellipse", path: "path",
  text: "text", polygon: "polygon", polyline: "polyline", group: "g", clip: "clipPath", "use-symbol": "svg",
} as const;

function drawElement(mount: Mount, plan: ElementPlan, parent: SVGElement | DocumentFragment): SVGElement {
  const { value, path, bindings, children, localId, symbolBox } = plan;
  const kind = value.kind as keyof typeof tags;
  const element = svg(parent, tags[kind]);
  const prefix = mount.context.instanceId + "-svg-";
  if (localId) attr(element, "id", prefix + localId.index);
  if (typeof value.ariaLabel === "string") attr(element, "aria-label", value.ariaLabel);
  if (value.transition === "fast" || value.transition === "normal") attr(element, "data-kui-transition", value.transition);

  if (kind === "text") {
    attr(element, "fill", "currentColor");
    attr(element, "stroke", "none");
    attr(element, "text-anchor", typeof value.align === "string" ? value.align : "start");
    attr(element, "dominant-baseline", "central");
  }
  if (symbolBox) attr(element, "viewBox", symbolBox.join(" "));

  const coordinates: Partial<Record<string, number>> = {};
  const pointValues: Partial<Record<"x" | "y", number>>[] = isArray(value.points) ? value.points.map(() => ({})) : [];
  const transforms = isArray(value.transform) ? value.transform as readonly JsonObject[] : [];
  const parameters = transforms.map<Partial<Record<string, number>>>(() => ({}));
  const compound = kind === "arrow" || pointValues.length > 0 || transforms.length > 0
    ? frameTask(writeCompound) : undefined;
  if (compound) mount.lifetime.add(() => compound.dispose());
  let ready = false;

  function writeCompound(): void {
    if (transforms.length) writeTransform();
    if (pointValues.length) writePoints(pointValues);
    if (kind === "arrow") writeArrow();
  }

  function writeTransform(): void {
    const parts: string[] = [];
    for (const [i, transform] of transforms.entries()) {
      const values = parameters[i]!;
      if (transform.kind === "rotate") {
        const degrees = values.degrees;
        if (degrees === undefined) return;
        parts.push(`rotate(${degrees})`);
      } else {
        const x = values.x;
        const y = values.y;
        if (x === undefined || y === undefined) return;
        const operation = transform.kind === "scale" ? "scale" : "translate";
        parts.push(`${operation}(${x} ${y})`);
      }
    }
    attr(element, "transform", parts.join(" "));
  }

  function writeArrow(): void {
    const { x1, y1, x2, y2 } = coordinates;
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return;
    const from = { x: x1, y: y1 };
    const to = { x: x2, y: y2 };
    const start = value.heads === "both" ? arrowHead(from, to) : "";
    attr(element, "d", `M ${x1} ${y1} L ${x2} ${y2} ${arrowHead(to, from)} ${start}`.trim());
  }

  function writePoints(points: readonly { readonly x?: JsonValue; readonly y?: JsonValue }[]): void {
    if (points.every(point => typeof point.x === "number" && typeof point.y === "number")) {
      attr(element, "points", points.map(point => `${point.x},${point.y}`).join(" "));
    }
  }

  elementFields(value, (field, raw, accepts, expected) => {
    const key = field[0];
    watch(mount, bindings, [...path, ...field], raw, accepts, expected, resolved => {
      if (key === "clip" && typeof resolved === "string") {
        const target = clipTarget(plan.scope, resolved);
        if (target) attr(element, "clip-path", `url(#${prefix}${target.index})`);
        else mount.report(issue(mount.node, [...path, ...field], "render", "svg-clip-target",
          `SVG clip "${resolved}" is not defined in this scope.`));
      } else if ((key === "stroke" || key === "fill") && isPaint(resolved)) {
        attr(element, key, paint(resolved));
      } else if (key === "transform" && typeof resolved === "number") {
        parameters[field[1] as number]![field[2] as string] = resolved;
        if (ready) compound?.schedule();
      } else if (key === "points") {
        if (typeof resolved === "number") {
          pointValues[field[1] as number]![field[2] as "x" | "y"] = resolved;
          if (ready) compound?.schedule();
        } else if (isArray(resolved)) writePoints(resolved as readonly JsonObject[]);
      } else if (key === "text" && typeof resolved === "string") {
        setText(element, resolved);
      } else if (kind === "arrow" && typeof key === "string" && /^([xy][12])$/.test(key) && typeof resolved === "number") {
        coordinates[key] = resolved;
        if (ready) compound?.schedule();
      } else if (typeof key === "string" && (typeof resolved === "string" || typeof resolved === "number")) {
        attr(element, key === "strokeWidth" ? "stroke-width" : key, resolved);
      }
    });
  });
  if (compound) writeCompound();
  ready = true;
  for (const child of children) drawOccurrence(mount, child, element);
  return element;
}

function drawOccurrence(mount: Mount, plan: ElementPlan, parent: SVGElement): void {
  if (plan.value.when === undefined) {
    drawElement(mount, plan, parent);
    return;
  }
  const anchor = parent.ownerDocument.createComment("kui-svg-when");
  parent.append(anchor);
  let active: Mount["lifetime"] | undefined;
  watchWhen(mount, plan, visible => {
    if (visible && !active) {
      const lifetime = mount.lifetime.child();
      active = lifetime;
      const fragment = parent.ownerDocument.createDocumentFragment();
      try {
        const element = drawElement({ ...mount, lifetime }, plan, fragment);
        parent.insertBefore(element, anchor);
        lifetime.add(() => element.remove());
      } catch {
        lifetime.dispose();
        active = undefined;
        mount.report(issue(mount.node, plan.path, "render", "svg-element-mount", "The SVG element could not be mounted."));
      }
    } else if (!visible && active) {
      active.dispose();
      active = undefined;
    }
  });
}

export const svgRegistrations: readonly ComponentRegistration[] = [{
  definition: {
    ...v1ComponentSchema("svg"),
    validate: ({ node, extensions }) => planSvg(node, extensions).diagnostics,
  },
  mount: mountDiagram(mount => {
    const { context } = mount;
    const plan = planSvg(mount.node, context.extensions, {
      ...(context.bindings && { bindings: context.bindings }), report: mount.report,
    });
    if (!plan.ok) return plan.diagnostics;
    const { drawing, root } = figure(mount, "Vector diagram", false);
    attr(drawing, "viewBox", plan.value.viewBox.join(" "));
    attr(drawing, "fill", "none");
    attr(drawing, "stroke", "currentColor");
    for (const element of plan.value.elements) drawOccurrence(mount, element, drawing);
    return root;
  }),
}];
