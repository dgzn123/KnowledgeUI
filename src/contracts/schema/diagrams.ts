import { V1_LIMITS } from "../shared.ts";
import {
  bound, choice, component, identifier, label, list, nonnegative, number, object, positive,
  qualifiedName, structure, tagged, text, tone, union,
} from "./fields.ts";

const geometry = bound(number);
const extent = bound(positive);
const viewBox = {
  type: "string",
  pattern: "^\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?(?:[ ,]+[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?){3}\\s*$",
} as const;
const svgId = bound(identifier);
const svgElement = { $ref: "#/$defs/SvgElement" };
const svgElements = list(svgElement, 1, V1_LIMITS.svgElements);
const paint = bound(choice("none", "current", "neutral", "info", "success", "danger", "warning"));
const transform = union(
  tagged("kind", "translate", { x: geometry, y: geometry }, ["x", "y"]),
  tagged("kind", "scale", { x: geometry, y: geometry }, ["x", "y"]),
  tagged("kind", "rotate", { degrees: geometry }, ["degrees"]),
);
const svgCommon = {
  ...structure, id: identifier, clip: svgId, stroke: paint, fill: paint,
  strokeWidth: bound(nonnegative), opacity: bound({ type: "number", minimum: 0, maximum: 1 }),
  transform: list(transform, 1, 8), transition: choice("none", "fast", "normal"), ariaLabel: label,
};
const coords = { x: geometry, y: geometry };
const line = { x1: geometry, y1: geometry, x2: geometry, y2: geometry };
const lineFields = ["x1", "y1", "x2", "y2"];
const coordinatePair = object(coords, ["x", "y"]);

export const svgElementSchema = union(
  tagged("kind", "line", { ...svgCommon, ...line }, lineFields),
  tagged("kind", "arrow", { ...svgCommon, ...line, heads: choice("end", "both") }, lineFields),
  tagged("kind", "polyline", { ...svgCommon, points: bound(list(coordinatePair, 2, 512)) }, ["points"]),
  tagged("kind", "polygon", { ...svgCommon, points: bound(list(coordinatePair, 3, 512)) }, ["points"]),
  tagged("kind", "rect", { ...svgCommon, ...coords, width: extent, height: extent, rx: bound(nonnegative) }, ["x", "y", "width", "height"]),
  tagged("kind", "circle", { ...svgCommon, cx: geometry, cy: geometry, r: extent }, ["cx", "cy", "r"]),
  tagged("kind", "ellipse", { ...svgCommon, cx: geometry, cy: geometry, rx: extent, ry: extent }, ["cx", "cy", "rx", "ry"]),
  tagged("kind", "path", { ...svgCommon, d: text }, ["d"]),
  tagged("kind", "text", { ...svgCommon, ...coords, text, align: choice("start", "middle", "end") }, ["x", "y", "text"]),
  tagged("kind", "group", { ...svgCommon, elements: svgElements }, ["elements"]),
  tagged("kind", "clip", { id: identifier, elements: svgElements }, ["id", "elements"]),
  tagged("kind", "use-symbol", {
    ...svgCommon, ...coords, symbol: qualifiedName, width: extent, height: extent,
  }, ["symbol", "x", "y", "width", "height"]),
);

const gridIndex = bound({ type: "integer", minimum: 0, maximum: 128 });
const graphNode = object({
  ...structure, id: bound(identifier), label: text, tone,
  position: union(coordinatePair, object({ row: gridIndex, column: gridIndex }, ["row", "column"])),
  width: extent, height: extent,
}, ["id", "label", "position"]);
const graphEdge = object({
  ...structure, from: bound(identifier), to: bound(identifier), label: text, tone,
  route: choice("straight", "orthogonal", "curve"), arrow: choice("none", "end", "both"),
}, ["from", "to"]);
const participant = object({ id: identifier, label: text }, ["id", "label"]);
const rowNumber = bound({ type: "integer", minimum: 0 });
const message = object({
  ...structure, from: bound(identifier), to: bound(identifier), label: text, tone,
  kind: choice("message", "return"), step: rowNumber,
}, ["from", "to", "label"]);

export const diagramComponents = [
  component("svg", "Whitelisted SVG primitives in a fixed coordinate space", {
    title: text, viewBox, elements: svgElements,
  }, ["viewBox", "elements"]),
  component("graph", "Explicit-coordinate node and edge diagram", {
    title: text, nodes: list(graphNode, 1, 200), edges: list(graphEdge, 0, 500),
    viewBox, grid: object({ columnWidth: positive, rowHeight: positive }, ["columnWidth", "rowHeight"]),
  }, ["nodes", "edges"]),
  component("sequence", "Participants and messages in deterministic rows", {
    title: text, participants: list(participant, 2, 16),
    messages: list(message, 1, 200), activeStep: rowNumber,
  }, ["participants", "messages"]),
] as const;
