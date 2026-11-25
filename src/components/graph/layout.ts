import type { JsonObject, JsonValue } from "#contracts";
import { isNumber, isPositive } from "../svg/diagram.ts";
import type { Point } from "../svg/diagram.ts";
import type { ViewBox } from "../svg/geometry.ts";

export const nodeWidth = 132;
export const nodeHeight = 48;
export const defaultGrid = { columnWidth: 180, rowHeight: 100 };

export const isGridIndex = (value: JsonValue): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 0 && value <= 128;

export interface Rectangle extends Point {
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export function rectangle(x: number, y: number, width: number, height: number): Rectangle | undefined {
  const right = x + width;
  const bottom = y + height;
  if (![x, y, right, bottom].every(isNumber) || ![width, height].every(isPositive)
    || Math.fround(right) <= Math.fround(x) || Math.fround(bottom) <= Math.fround(y)) return;
  return { x, y, width, height, right, bottom };
}

export function overlap(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

export function literalRectangle(node: JsonObject, grid: JsonObject): Rectangle | undefined {
  const position = node.position as JsonObject;
  const column = position.column ?? null;
  const row = position.row ?? null;
  const x = Object.hasOwn(position, "x") ? position.x ?? null : isGridIndex(column)
    ? column * (grid.columnWidth as number) : null;
  const y = Object.hasOwn(position, "y") ? position.y ?? null : isGridIndex(row)
    ? row * (grid.rowHeight as number) : null;
  const width = node.width ?? nodeWidth;
  const height = node.height ?? nodeHeight;
  return isNumber(x) && isNumber(y) && isPositive(width) && isPositive(height)
    ? rectangle(x, y, width, height) : undefined;
}

type Route = "straight" | "orthogonal" | "curve";
const middle = (a: Rectangle): Point => ({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
const xy = (point: Point) => `${point.x} ${point.y}`;

function port(box: Rectangle, towards: Point): Point {
  const center = middle(box);
  const dx = towards.x - center.x;
  const dy = towards.y - center.y;
  const factor = Math.max(Math.abs(dx) / box.width, Math.abs(dy) / box.height) * 2;
  return { x: center.x + dx / factor, y: center.y + dy / factor };
}

interface EdgePath {
  readonly d: string;
  /** First and last adjacent points give arrowhead direction. */
  readonly points: readonly [Point, Point, ...Point[]];
  readonly label: Point;
}

function routed(points: EdgePath["points"], label: Point, curve = false): EdgePath {
  return { points, label, d: `M ${xy(points[0])} ${curve ? "C" : "L"} ${points.slice(1).map(xy).join(" ")}` };
}

function selfRoute(box: Rectangle, route: Route): EdgePath {
  const center = middle(box);
  const start = { x: box.right, y: center.y };
  const end = { x: center.x, y: box.y };
  const x = box.right + 30;
  const y = box.y - 30;
  const label = { x, y: y - 8 };
  if (route === "curve") return routed([start, { x, y: center.y }, { x: center.x, y }, end], label, true);
  return routed([start, { x, y: center.y }, { x, y }, { x: center.x, y }, end], label);
}

export function routeEdge(from: Rectangle, to: Rectangle, route: JsonValue | undefined): EdgePath {
  if (from === to) return selfRoute(from, route === "curve" ? "curve" : "orthogonal");
  const a = middle(from);
  const b = middle(to);
  if (route !== "orthogonal" && route !== "curve") {
    return routed([port(from, b), port(to, a)], { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 9 });
  }

  // Transpose the calculation for vertically separated nodes.
  const horizontal = (from.right <= to.x || to.right <= from.x)
    && (!(from.bottom <= to.y || to.bottom <= from.y) || Math.abs(a.x - b.x) >= Math.abs(a.y - b.y));
  const point = (u: number, v: number) => horizontal ? { x: u, y: v } : { x: v, y: u };
  const forward = horizontal ? a.x < b.x : a.y < b.y;
  const startU = horizontal ? (forward ? from.right : from.x) : (forward ? from.bottom : from.y);
  const endU = horizontal ? (forward ? to.x : to.right) : (forward ? to.y : to.bottom);
  const startV = horizontal ? a.y : a.x;
  const endV = horizontal ? b.y : b.x;
  const midU = (startU + endU) / 2;
  const start = point(startU, startV);
  const end = point(endU, endV);
  if (route === "curve") {
    const bend = Math.min(36, Math.max(12, Math.abs(endU - startU) / 3));
    return routed([start, point(midU, startV - bend), point(midU, endV - bend), end],
      point(midU, (startV + endV) / 2 - bend * 0.75 - 9), true);
  }
  return routed([start, point(midU, startV), point(midU, endV), end],
    point(midU, (startV + endV) / 2 - 9));
}

export function fittedViewBox(nodes: readonly Rectangle[], extras: readonly Point[]): ViewBox | undefined {
  if (nodes.length === 0) return [0, 0, 240, 92];
  const points = [...extras];
  for (const box of nodes) points.push(box, { x: box.right, y: box.bottom });
  const padding = 24;
  const x = Math.min(...points.map(p => p.x)) - padding;
  const y = Math.min(...points.map(p => p.y)) - padding;
  const width = Math.max(...points.map(p => p.x)) - x + padding;
  const height = Math.max(...points.map(p => p.y)) - y + padding;
  return isNumber(x) && isNumber(y) && isPositive(width) && isPositive(height) ? [x, y, width, height] : undefined;
}
