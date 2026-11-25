import type { ComponentRegistration, ComponentSemanticValidator, Diagnostic, FieldPath, JsonObject } from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";
import { frameTask } from "../../core/expression/frame.ts";
import {
  arrowHead, attr, figure, hasBinding, isId, isNumber, isPositive, isText, isTone, issue,
  mountDiagram, occurrences, paint, setText, svg, watch, watchField, watchWhen,
} from "../svg/diagram.ts";
import type { Mount, Occurrence, Point } from "../svg/diagram.ts";
import { readViewBox } from "../svg/geometry.ts";
import {
  defaultGrid, fittedViewBox, isGridIndex, literalRectangle, nodeHeight, nodeWidth, overlap, rectangle, routeEdge,
} from "./layout.ts";
import type { Rectangle } from "./layout.ts";

const validate: ComponentSemanticValidator = ({ node }) => {
  const { props } = node;
  const diagnostics: Diagnostic[] = [];
  const report = (path: FieldPath, code: string, message: string) =>
    diagnostics.push(issue(node, path, "semantic", code, message));
  if (props.viewBox !== undefined && !readViewBox(props.viewBox)) {
    report(["viewBox"], "graph-view-box", "A viewBox requires four finite coordinates and positive dimensions.");
  }
  const grid = (props.grid ?? defaultGrid) as JsonObject;
  for (const key of ["columnWidth", "rowHeight"]) {
    if (!isPositive(grid[key] ?? null)) report(["grid", key], "graph-grid", "Grid dimensions must be positive SVG dimensions.");
  }
  const authoredNodes = props.nodes as readonly JsonObject[];
  const ids = new Set<string>();
  const fixedIds = new Set<string>();
  let dynamicIds = false;
  const fixedBoxes: { id: string; box: Rectangle }[] = [];
  for (const [index, entry] of authoredNodes.entries()) {
    const path = ["nodes", index];
    const id = entry.id as string;
    if (hasBinding(id)) dynamicIds = true;
    else ids.add(id);
    const position = entry.position as JsonObject;
    const coordinates = Object.hasOwn(position, "x") ? ["x", "y"] : ["row", "column"];
    const dynamic = [...Object.values(position), entry.width ?? 0, entry.height ?? 0].some(hasBinding);
    const box = literalRectangle(entry, grid);
    for (const key of coordinates) {
      const raw = position[key] ?? null;
      const accepts = key === "x" || key === "y" ? isNumber : isGridIndex;
      if (!hasBinding(raw) && !accepts(raw)) report([...path, "position", key], "graph-position", "Invalid graph position.");
    }
    for (const key of ["width", "height"]) {
      const raw = entry[key];
      if (raw !== undefined && !hasBinding(raw) && !isPositive(raw)) {
        report([...path, key], "graph-dimension", "Node dimensions must be positive SVG dimensions.");
      }
    }
    if (!dynamic && !box) report([...path, "position"], "graph-geometry", "Node bounds cannot be represented in the SVG coordinate space.");
    if (entry.when !== undefined || entry.repeat !== undefined) continue;
    if (!hasBinding(id)) {
      if (fixedIds.has(id)) report([...path, "id"], "graph-duplicate-id", `Duplicate graph node "${id}".`);
      fixedIds.add(id);
    }
    if (box) {
      const collision = fixedBoxes.find(previous => overlap(previous.box, box));
      if (collision) report([...path, "position"], "graph-overlap", `Graph node "${id}" overlaps "${collision.id}".`);
      fixedBoxes.push({ id, box });
    }
  }

  for (const [index, edge] of (props.edges as readonly JsonObject[]).entries()) {
    for (const key of ["from", "to"]) {
      const id = edge[key] as string;
      if (!dynamicIds && !hasBinding(id) && !ids.has(id)) {
        report(["edges", index, key], "graph-endpoint", `Unknown graph node "${id}".`);
      }
    }
  }
  return diagnostics;
};

function setVisible(element: SVGElement, visible: boolean): void {
  attr(element, "display", visible ? "inline" : "none");
}

function graphNode(mount: Mount, drawing: SVGElement, occurrence: Occurrence, change: () => void) {
  const group = svg(drawing, "g");
  attr(group, "class", "kui-graph-node");
  const rectangleElement = svg(group, "rect");
  attr(rectangleElement, "rx", 7);
  const viewport = svg(group, "svg");
  attr(viewport, "overflow", "hidden");
  const label = svg(viewport, "text");
  attr(label, "text-anchor", "middle");
  attr(label, "dominant-baseline", "central");
  const tooltip = svg(group, "title");
  let id: string | undefined;
  let visible = false;
  let x: number | undefined;
  let y: number | undefined;
  let width = occurrence.value.width === undefined ? nodeWidth : undefined;
  let height = occurrence.value.height === undefined ? nodeHeight : undefined;

  watchWhen(mount, occurrence, value => { visible = value; change(); });
  watchField(mount, occurrence, "id", isId, "a graph node ID", value => { id = value; change(); });
  watchField(mount, occurrence, "width", isPositive, "a positive SVG dimension", value => { width = value; change(); });
  watchField(mount, occurrence, "height", isPositive, "a positive SVG dimension", value => { height = value; change(); });
  watchField(mount, occurrence, "label", isText, "text", value => { setText(label, value); setText(tooltip, value); });
  watchField(mount, occurrence, "tone", isTone, "a semantic tone", value => { group.style.color = value === "neutral" ? "" : paint(value); });

  const position = occurrence.value.position as JsonObject;
  const grid = (mount.node.props.grid ?? defaultGrid) as JsonObject;
  const gridPosition = Object.hasOwn(position, "column");
  for (const [index, key] of (gridPosition ? ["column", "row"] : ["x", "y"]).entries()) {
    watch(mount, occurrence.bindings, [...occurrence.path, "position", key], position[key] as number | string,
      gridPosition ? isGridIndex : isNumber, gridPosition ? "an integer grid position from zero to 128" : "a finite SVG coordinate", value => {
        const coordinate = gridPosition ? value * (grid[index === 0 ? "columnWidth" : "rowHeight"] as number) : value;
        if (index === 0) x = coordinate;
        else y = coordinate;
        change();
      });
  }

  return {
    group, occurrence,
    get visible() { return visible && id !== undefined && x !== undefined && y !== undefined && width !== undefined && height !== undefined; },
    get id() { return id!; },
    geometry() {
      return x !== undefined && y !== undefined && width !== undefined && height !== undefined
        ? rectangle(x, y, width, height) : undefined;
    },
    draw(box: Rectangle) {
      attr(group, "transform", `translate(${box.x} ${box.y})`);
      attr(rectangleElement, "width", box.width);
      attr(rectangleElement, "height", box.height);
      const inset = Math.min(8, box.width / 4);
      attr(viewport, "x", inset);
      attr(viewport, "width", box.width - 2 * inset);
      attr(viewport, "height", box.height);
      attr(label, "x", box.width / 2 - inset);
      attr(label, "y", box.height / 2);
    },
  };
}

function graphEdge(mount: Mount, drawing: SVGElement, occurrence: Occurrence, change: () => void) {
  const group = svg(drawing, "g");
  attr(group, "class", "kui-graph-edge");
  const path = svg(group, "path");
  const label = svg(group, "text");
  attr(label, "text-anchor", "middle");
  let from: string | undefined;
  let to: string | undefined;
  let visible = false;
  watchWhen(mount, occurrence, value => { visible = value; change(); });
  watchField(mount, occurrence, "from", isId, "a graph node ID", value => { from = value; change(); });
  watchField(mount, occurrence, "to", isId, "a graph node ID", value => { to = value; change(); });
  watchField(mount, occurrence, "label", isText, "text", value => setText(label, value));
  watchField(mount, occurrence, "tone", isTone, "a semantic tone", value => { group.style.color = value === "neutral" ? "" : paint(value); });

  return {
    group, occurrence,
    get visible() { return visible && from !== undefined && to !== undefined; },
    get from() { return from!; },
    get to() { return to!; },
    draw(edge: ReturnType<typeof routeEdge>) {
      let d = edge.d;
      const { points } = edge;
      if (occurrence.value.arrow !== "none") {
        const end = points.at(-1)!;
        const before = [...points].reverse().find(point => point.x !== end.x || point.y !== end.y);
        if (before) d += " " + arrowHead(end, before);
      }
      if (occurrence.value.arrow === "both") {
        const start = points[0];
        const after = points.find(point => point.x !== start.x || point.y !== start.y);
        if (after) d += " " + arrowHead(start, after);
      }
      attr(path, "d", d);
      attr(label, "x", edge.label.x);
      attr(label, "y", edge.label.y);
    },
  };
}

export const graphRegistrations: readonly ComponentRegistration[] = [{
  definition: { ...v1ComponentSchema("graph"), validate },
  mount: mountDiagram(mount => {
    const nodes = occurrences(mount, "nodes", 200);
    if (!Array.isArray(nodes)) return [nodes];
    const edges = occurrences(mount, "edges", 500);
    if (!Array.isArray(edges)) return [edges];
    const { drawing, root } = figure(mount, "Node and edge diagram", true);
    const edgeLayer = svg(drawing, "g");
    const nodeLayer = svg(drawing, "g");
    let ready = false;
    const task = frameTask(sync);
    mount.lifetime.add(() => task.dispose());
    const change = () => { if (ready) task.schedule(); };
    const nodeViews = nodes.map(node => graphNode(mount, nodeLayer, node, change));
    const edgeViews = edges.map(edge => graphEdge(mount, edgeLayer, edge, change));
    const explicitBox = readViewBox(mount.node.props.viewBox);

    function report(path: FieldPath, code: string, message: string) {
      mount.report(issue(mount.node, path, "render", code, message));
    }

    function sync(): void {
      const boxes = new Map<string, Rectangle>();
      for (const node of nodeViews) {
        let accepted = false;
        if (node.visible) {
          const box = node.geometry();
          const collision = box && [...boxes].find(([, previous]) => overlap(previous, box));
          if (!box) report([...node.occurrence.path, "position"], "graph-geometry", "Node bounds cannot be represented in the SVG coordinate space.");
          else if (boxes.has(node.id)) report([...node.occurrence.path, "id"], "graph-duplicate-id", `Duplicate graph node "${node.id}".`);
          else if (collision) report([...node.occurrence.path, "position"], "graph-overlap", `Graph node "${node.id}" overlaps "${collision[0]}".`);
          else {
            boxes.set(node.id, box);
            node.draw(box);
            accepted = true;
          }
        }
        setVisible(node.group, accepted);
      }
      const extras: Point[] = [];
      for (const edge of edgeViews) {
        let accepted = false;
        if (edge.visible) {
          const from = boxes.get(edge.from);
          const to = boxes.get(edge.to);
          if (!from || !to) report([...edge.occurrence.path, from ? "to" : "from"], "graph-endpoint",
            `No visible graph node "${from ? edge.to : edge.from}".`);
          else {
            const path = routeEdge(from, to, edge.occurrence.value.route);
            if ([...path.points, path.label].every(point => isNumber(point.x) && isNumber(point.y))) {
              edge.draw(path);
              extras.push(...path.points, path.label);
              accepted = true;
            } else report(edge.occurrence.path, "graph-geometry", "Edge bounds cannot be represented in the SVG coordinate space.");
          }
        }
        setVisible(edge.group, accepted);
      }
      const box = explicitBox ?? fittedViewBox([...boxes.values()], extras);
      if (box) {
        attr(drawing, "viewBox", box.join(" "));
        attr(drawing, "width", Math.min(1600, Math.max(420, box[2])));
      } else report(["nodes"], "graph-view-box", "Combined graph bounds cannot be represented as a viewBox.");
    }

    sync();
    ready = true;
    return root;
  }),
}];
