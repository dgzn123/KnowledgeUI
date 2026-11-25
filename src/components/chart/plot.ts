import type { AxisKey, SeriesKind } from "./data.ts";
import { boundedFraction, breaksBetween, formatNumber } from "./geometry.ts";
import type { Axis, Point, Points } from "./geometry.ts";

export function element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, name: string): HTMLElementTagNameMap[K] {
  const node = parent.ownerDocument.createElement(tag);
  node.className = name;
  parent.append(node);
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, name?: string): SVGElementTagNameMap[K] {
  const node = parent.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
  if (name) node.setAttribute("class", name);
  parent.append(node);
  return node;
}

export function attr(node: Element, name: string, value: string | number): void {
  const string = String(value);
  if (node.getAttribute(name) !== string) node.setAttribute(name, string);
}

export function textContent(node: Element, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Axes {
  readonly x: Axis;
  readonly y: Axis;
}

export class Projection {
  readonly axes: Axes;
  readonly rect: Rect;

  constructor(axes: Axes, rect: Rect) {
    this.axes = axes;
    this.rect = rect;
  }

  x(value: number): number {
    return this.rect.left + boundedFraction(this.axes.x, value) * this.rect.width;
  }

  y(value: number): number {
    return this.rect.top + (1 - boundedFraction(this.axes.y, value)) * this.rect.height;
  }

  contains(point: Point): boolean {
    return this.axes.x.contains(point.x) && this.axes.y.contains(point.y);
  }
}

function setRect(node: SVGRectElement, x: number, y: number, width: number, height: number): void {
  attr(node, "x", x);
  attr(node, "y", y);
  attr(node, "width", width);
  attr(node, "height", height);
}

function setLine(node: SVGLineElement, x1: number, y1: number, x2: number, y2: number): void {
  attr(node, "x1", x1);
  attr(node, "y1", y1);
  attr(node, "x2", x2);
  attr(node, "y2", y2);
}

function logTicks(axis: Axis, count: number): number[] {
  const first = Math.floor(Math.log10(axis.min)) + 1;
  const last = Math.ceil(Math.log10(axis.max)) - 1;
  const step = Math.max(1, Math.ceil((last - first + 1) / (count - 2)));
  const values = [axis.min];
  for (let exponent = first; exponent <= last; exponent += step) {
    const value = 10 ** exponent;
    if (value > axis.min && value < axis.max) values.push(value);
  }
  values.push(axis.max);
  return values;
}

function ticks(axis: Axis, count: number): readonly { label: string; fraction: number }[] {
  const decades = axis.scale === "log" ? logTicks(axis, count) : [];
  const values = decades.length > 2 ? decades : Array.from({ length: count }, (_, index) => axis.value(index / (count - 1)));
  const distinct = [...new Set(values)];
  const precision = distinct.some((value, index) =>
    index > 0 && formatNumber(value) === formatNumber(distinct[index - 1]!)
  ) ? 17 : 5;
  return distinct.map(value => ({ label: formatNumber(value, precision), fraction: axis.fraction(value) }));
}

export class Plot {
  readonly svg: SVGSVGElement;
  readonly layers: Readonly<Record<"regions" | "referenceLines" | "series" | "markers", SVGGElement>>;
  readonly cursor: SVGCircleElement;
  readonly #clip: SVGRectElement;
  readonly #grid: SVGGElement;
  readonly #ticks;

  #projection: Projection | undefined;
  #width = 0;
  #height = 0;

  constructor(surface: HTMLElement, clipId: string) {
    this.svg = svg(surface, "svg", "kui-chart-svg");
    attr(this.svg, "aria-hidden", "true");
    attr(this.svg, "preserveAspectRatio", "none");
    const clipPath = svg(svg(this.svg, "defs"), "clipPath");
    clipPath.id = clipId;
    this.#clip = svg(clipPath, "rect");
    this.#grid = svg(this.svg, "g", "kui-chart-grid");
    this.#ticks = Array.from({ length: 10 }, () => {
      const group = svg(this.#grid, "g");
      return { group, line: svg(group, "line"), text: svg(group, "text") };
    });
    const viewport = svg(this.svg, "g");
    attr(viewport, "clip-path", "url(#" + clipId + ")");
    this.layers = {
      regions: svg(viewport, "g"),
      referenceLines: svg(viewport, "g"),
      series: svg(viewport, "g"),
      markers: svg(viewport, "g"),
    };
    this.cursor = svg(this.svg, "circle", "kui-chart-cursor");
    attr(this.cursor, "r", 5);
  }

  layout(axes: Axes | undefined, width: number, height: number): Projection | undefined {
    if (!axes) {
      this.#projection = undefined;
      attr(this.svg, "opacity", 0);
      return undefined;
    }
    const last = this.#projection;
    if (last?.axes.x === axes.x && last.axes.y === axes.y && width === this.#width && height === this.#height) return last;
    this.#width = width;
    this.#height = height;
    const xTicks = ticks(axes.x, width < 440 ? (axes.x.scale === "log" ? 4 : 3) : 5);
    const yTicks = ticks(axes.y, 5);
    const longest = Math.max(...yTicks.map(tick => tick.label.length));
    const left = Math.min(width * 0.37, Math.max(44, longest * 6.5 + 10));
    const right = Math.min(width * 0.23, Math.max(22, xTicks.at(-1)!.label.length * 3.25 + 6));
    const rect = { left, top: 12, width: width - left - right, height: Math.max(1, height - 38) };
    this.#projection = new Projection(axes, rect);
    attr(this.svg, "opacity", 1);
    attr(this.svg, "viewBox", `0 0 ${width} ${height}`);
    setRect(this.#clip, rect.left, rect.top, rect.width, rect.height);

    for (const [index, tick] of this.#ticks.entries()) {
      const horizontal = index < 5;
      const labels = horizontal ? yTicks : xTicks;
      const at = horizontal ? index : index - 5;
      const value = labels[at];
      attr(tick.group, "visibility", value === undefined ? "hidden" : "visible");
      if (!value) continue;
      const { label, fraction } = value;
      const bottom = rect.top + rect.height;
      if (horizontal) {
        const y = bottom - fraction * rect.height;
        setLine(tick.line, left, y, left + rect.width, y);
        attr(tick.text, "x", left - 6);
        attr(tick.text, "y", y);
        attr(tick.text, "dy", "0.35em");
        attr(tick.text, "text-anchor", "end");
      } else {
        const x = left + fraction * rect.width;
        setLine(tick.line, x, rect.top, x, bottom);
        attr(tick.text, "x", x);
        attr(tick.text, "y", bottom + 17);
        attr(tick.text, "text-anchor", "middle");
      }
      textContent(tick.text, label);
    }
    return this.#projection;
  }
}

export function placePoint(node: SVGCircleElement, x: number, y: number): void {
  attr(node, "cx", x);
  attr(node, "cy", y);
}

export function placeReference(node: SVGLineElement, plot: Projection, axis: AxisKey, value: number): void {
  const { left, top, width, height } = plot.rect;
  if (axis === "x") setLine(node, plot.x(value), top, plot.x(value), top + height);
  else setLine(node, left, plot.y(value), left + width, plot.y(value));
}

export function placeRegion(node: SVGRectElement, plot: Projection, axis: AxisKey, from: number, to: number): void {
  const { left, top, width, height } = plot.rect;
  if (axis === "x") setRect(node, plot.x(from), top, plot.x(to) - plot.x(from), height);
  else setRect(node, left, plot.y(to), width, plot.y(from) - plot.y(to));
}

export interface BarLayout {
  readonly width: number;
  readonly offset: number;
}

export function barSlot(plot: Projection, points: readonly Points[], count: number): number {
  const positions = points.flatMap(series => series.flatMap(point => point && plot.axes.x.contains(point.x) ? [plot.x(point.x)] : []));
  positions.sort((first, second) => first - second);
  let spacing = plot.rect.width;
  for (let index = 1; index < positions.length; index++) {
    const delta = positions[index]! - positions[index - 1]!;
    if (delta > 0) spacing = Math.min(spacing, delta);
  }
  return Math.min(24, spacing * 0.8 / count);
}

export interface Hit {
  readonly key: string;
  readonly point: Point;
  readonly x: number;
  readonly y: number;
  readonly group: string;
}

function baseline(axis: Axis): number {
  return axis.scale === "log" ? axis.min : Math.max(axis.min, Math.min(axis.max, 0));
}

export class SeriesLayer {
  readonly group: SVGGElement;
  readonly #outline: SVGPathElement;
  readonly #fill: SVGPathElement | undefined;
  readonly #kind: SeriesKind;
  readonly #index: number;
  #plot: Projection | undefined;
  #points: Points | undefined;
  #bar: BarLayout | undefined;
  #label: string | undefined;
  #hits: Hit[] = [];

  constructor(parent: SVGGElement, kind: SeriesKind, index: number) {
    this.#kind = kind;
    this.#index = index;
    this.group = svg(parent, "g", "kui-chart-series");
    attr(this.group, "data-type", kind);
    if (kind === "area") this.#fill = svg(this.group, "path", "kui-chart-area");
    this.#outline = svg(this.group, "path", "kui-chart-shape");
  }

  draw(plot: Projection, points: Points, label: string, bar?: BarLayout): readonly Hit[] {
    if (plot === this.#plot && points === this.#points && label === this.#label && bar?.width === this.#bar?.width && bar?.offset === this.#bar?.offset) return this.#hits;
    this.#plot = plot;
    this.#points = points;
    this.#label = label;
    this.#bar = bar;
    const base = plot.y(baseline(plot.axes.y));
    const coordinates = points.map(point => point && ({ x: plot.x(point.x), y: plot.y(point.y) }));
    const ordinates = this.#kind === "function" ? points.map(point => point && plot.axes.y.fraction(point.y)) : [];
    const hits: Hit[] = [];
    const outline: string[] = [];
    const fills: string[] = [];
    let start: number | undefined;
    let end = 0;
    let length = 0;
    const closeSegment = () => {
      if (start === undefined) return;
      if (length === 1) outline.push("h0");
      else if (this.#fill) fills.push(`L${end},${base}H${start}Z`);
      start = undefined;
      length = 0;
    };

    for (const [index, point] of points.entries()) {
      const position = coordinates[index];
      if (!point || !position) {
        closeSegment();
        continue;
      }
      const { x, y } = position;
      const hitX = x + (bar?.offset ?? 0);
      if (plot.contains(point)) hits.push({ key: `s${this.#index}/${index}`, point, x: hitX, y, group: label });
      if (bar) {
        if (plot.axes.x.contains(point.x)) {
          outline.push(`M${hitX - bar.width / 2},${base}v${y - base}h${bar.width}V${base}Z`);
        }
      } else if (this.#kind === "scatter") {
        if (plot.contains(point)) outline.push(`M${x},${y}h0`);
      } else {
        if (breaksBetween(ordinates, index)) closeSegment();
        const command = `${start === undefined ? "M" : "L"}${x},${y}`;
        outline.push(command);
        if (this.#fill) {
          if (start === undefined) fills.push(`M${x},${base}L${x},${y}`);
          else fills.push(command);
        }
        start ??= x;
        end = x;
        length++;
      }
    }
    closeSegment();
    attr(this.#outline, "d", outline.join(""));
    if (this.#fill) attr(this.#fill, "d", fills.join(""));
    this.#hits = hits;
    return hits;
  }
}
