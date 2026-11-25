import { V1_LIMITS } from "#contracts";
import type {
  ComponentMountRequest, ComponentRegistration, Diagnostic, FieldPath, JsonValue, Lifetime, ValueGuard,
} from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";
import { frameTask } from "../../core/expression/frame.ts";
import {
  badLogValue, budgetMessage, chartInput, finite, issue, location, logMessage, pointArray, sampleCount, text, tone, validateChart,
} from "./data.ts";
import type { AxisKey, ChartInput } from "./data.ts";
import { axis, Extent, sample } from "./geometry.ts";
import type { Axis, Point, Points } from "./geometry.ts";
import { ChartInteraction } from "./interaction.ts";
import {
  attr, barSlot, element, placePoint, placeReference, placeRegion, Plot, SeriesLayer, svg, textContent,
} from "./plot.ts";
import type { Hit } from "./plot.ts";

const empty: Points = Object.freeze([]);
const axisKeys = ["x", "y"] as const;
type Read<T> = () => T | undefined;
type AnnotationKey = "regions" | "referenceLines" | "markers";

function mountChart(request: ComponentMountRequest, lifetime: Lifetime): HTMLElement {
  const { node, context, container } = request;
  const { bindings, state } = context;
  const options = chartInput(node);
  const scales = { x: options.xAxis.scale ?? "linear", y: options.yAxis.scale ?? "linear" } as const;
  const figure = element(container, "figure", "kui-basic kui-chart");
  lifetime.add(() => figure.remove());
  const heading = element(figure, "figcaption", "kui-chart-title");
  const yLabel = element(figure, "div", "kui-chart-axis-label");
  const surface = element(figure, "div", "kui-chart-surface");
  context.host.isolateInteraction(surface, lifetime);
  const plot = new Plot(surface, context.instanceId + "-chart-clip");
  const xLabel = element(figure, "div", "kui-chart-axis-label kui-chart-axis-x");
  const interaction = new ChartInteraction(figure, surface, plot.cursor, context.instanceId + "-chart-hint", lifetime);
  const legend = element(figure, "ul", "kui-chart-keys");
  const notes = element(figure, "ul", "kui-chart-keys");
  attr(legend, "aria-label", "Chart legend");
  attr(notes, "aria-label", "Chart annotations");

  let x: Axis | undefined;
  let y: Axis | undefined;
  let width = 360;
  let height = 244;
  let ready = false;
  const task = frameTask(render);
  lifetime.add(() => task.dispose());
  const schedule = () => { if (ready) task.schedule(); };

  const reported = new Set<string>();
  function report(diagnostic: Diagnostic): void {
    const key = JSON.stringify([diagnostic.code, diagnostic.severity, diagnostic.path]);
    if (reported.size <= V1_LIMITS.diagnostics && !reported.has(key)) {
      reported.add(key);
      context.report(diagnostic);
    }
  }
  function invalid(field: FieldPath, code: string, message: string): void {
    report(issue(node, field, "render", code, message));
  }

  function watch<T extends JsonValue>(
    value: JsonValue | undefined, field: FieldPath, accepts: ValueGuard<T>, expected: string,
    change: () => void = schedule,
  ): Read<T> {
    if (value === undefined) return () => undefined;
    if (typeof value !== "string" || !value.includes("{{")) {
      const checked = accepts(value) ? value : undefined;
      if (checked === undefined) invalid(field, "value", "Expected " + expected + ".");
      return () => checked;
    }
    if (!bindings) {
      invalid(field, "bindings", "This chart binding requires the expression service.");
      return () => undefined;
    }
    let current: T | undefined;
    const subscription = bindings.observe({ value, source: location(node, field), accepts, expected }, result => {
      for (const diagnostic of result.diagnostics) report(diagnostic);
      const next = result.ok ? result.value : undefined;
      if (!Object.is(current, next)) {
        current = next;
        change();
      }
    });
    lifetime.add(() => subscription.dispose());
    return () => current;
  }

  function checkedLog(value: number | undefined, key: AxisKey, field: FieldPath): number | undefined {
    if (!badLogValue(scales[key], value)) return value;
    invalid(field, "log-value", logMessage);
    return undefined;
  }

  function watchNumber(raw: ChartInput["xAxis"]["min"], key: AxisKey, field: FieldPath, change?: () => void): Read<number> {
    const read = watch(raw, field, finite, "a finite number", change);
    return () => checkedLog(read(), key, field);
  }

  function watchPoint(raw: NonNullable<ChartInput["markers"]>[number], field: FieldPath, change?: () => void): Read<Point> {
    const getX = watchNumber(raw.x, "x", [...field, "x"], change);
    const getY = watchNumber(raw.y, "y", [...field, "y"], change);
    const getLabel = watch(raw.label, [...field, "label"], text, "text", change);
    return () => {
      const x = getX();
      const y = getY();
      const label = getLabel();
      return x === undefined || y === undefined ? undefined : { x, y, ...(label && { label }) };
    };
  }

  function watchAxis(key: AxisKey) {
    const path = [key + "Axis"];
    const input = key === "x" ? options.xAxis : options.yAxis;
    const readMin = watchNumber(input.min, key, [...path, "min"]);
    const readMax = watchNumber(input.max, key, [...path, "max"]);
    return {
      label: watch(input.label, [...path, "label"], text, "text"),
      unit: watch(input.unit, [...path, "unit"], text, "text"),
      domain(extent: Extent, previous?: Axis): Axis | undefined {
        const min = readMin();
        const max = readMax();
        if ((input.min !== undefined && min === undefined) || (input.max !== undefined && max === undefined)) return undefined;
        const domain = axis(scales[key], min, max, extent, previous);
        if (!domain) invalid(path, "axis-range", "The axis needs an increasing, finite range.");
        return domain;
      },
    };
  }

  const title = watch(options.title, ["title"], text, "text");
  const axes = { x: watchAxis("x"), y: watchAxis("y") };
  const layers = options.series.map((entry, index) => {
    const field = ["series", index];
    const layer = new SeriesLayer(plot.layers.series, entry.type, index);
    const key = legendItem(legend, entry.type);
    const label = watch(entry.label, [...field, "label"], text, "text");
    const getTone = watch(entry.tone, [...field, "tone"], tone, "a chart tone");
    let points = empty;
    let dirty = true;
    const reset = () => {
      dirty = true;
      schedule();
    };
    const common = { layer, key, label, getTone, type: entry.type };
    if (entry.type === "function") {
      const count = sampleCount(entry);
      const expression = node.expressions[`/series/${index}/expr`];
      const expressionPath = [...field, "expr"];
      let sampledAxis: Axis | undefined;
      if (!expression || !bindings) {
        invalid(expressionPath, "function", "The chart requires a compiled function expression and its binding service.");
      } else if (state) {
        const dependencies = new Set([...expression.dependencies].filter(name => name !== "x"));
        if (dependencies.size > 0) {
          const invalidate = frameTask(reset);
          const subscription = state.subscribe(dependencies, () => invalidate.schedule());
          lifetime.add(() => {
            subscription.dispose();
            invalidate.dispose();
          });
        }
      }
      return {
        ...common, count: () => count, data: () => empty,
        points(domain: Axis): Points {
          if (!expression || !bindings) return empty;
          if (dirty || sampledAxis !== domain) {
            const result = sample(bindings, expression, domain, scales.y, count);
            points = result.points;
            if (result.diagnostic) report(result.diagnostic);
            sampledAxis = domain;
            dirty = false;
          }
          return points;
        },
      };
    }

    const pointsPath = [...field, "points"];
    const source = entry.points;
    const inline = typeof source === "string" ? undefined
      : source.map((point, index) => watchPoint(point, [...pointsPath, index], reset));
    const bound = typeof source === "string"
      ? watch(source, pointsPath, pointArray, `an array of 1 to ${V1_LIMITS.chartSamplesPerSeries} points with finite x and y, and optional text labels`, reset)
      : undefined;
    const data = (): Points => {
      if (dirty) {
        points = inline?.map(read => read()) ?? (bound?.() as readonly Point[] | undefined)?.map((point, index) => {
          const x = checkedLog(point.x, "x", [...pointsPath, index, "x"]);
          const y = checkedLog(point.y, "y", [...pointsPath, index, "y"]);
          return x === undefined || y === undefined ? undefined : point;
        }) ?? empty;
        dirty = false;
      }
      return points;
    };
    return { ...common, count: () => inline?.length ?? bound?.()?.length ?? 0, data, points: data };
  });

  const regions = (options.regions ?? []).map((entry, index) => {
    const field = ["regions", index];
    const from = watchNumber(entry.from, entry.axis, [...field, "from"]);
    const to = watchNumber(entry.to, entry.axis, [...field, "to"]);
    return {
      ...annotation("regions", index, "region", entry.label, entry.tone, "rect"), axis: entry.axis,
      interval(): readonly [number, number] | undefined {
        const low = from();
        const high = to();
        if (low === undefined || high === undefined) return undefined;
        if (low < high) return [low, high];
        invalid(field, "region-range", "The region start must be smaller than its end.");
        return undefined;
      },
    };
  });
  const references = (options.referenceLines ?? []).map((entry, index) => ({
    ...annotation("referenceLines", index, "reference", entry.label, entry.tone, "line"), axis: entry.axis,
    value: watchNumber(entry.value, entry.axis, ["referenceLines", index, "value"]),
  }));
  const markers = (options.markers ?? []).map((entry, index) => {
    const marker = annotation("markers", index, "marker", entry.label, undefined, "circle");
    attr(marker.shape, "r", 4);
    return { ...marker, value: watchPoint({ x: entry.x, y: entry.y }, ["markers", index]) };
  });

  function annotation<K extends "rect" | "line" | "circle">(
    key: AnnotationKey, index: number, kind: string, label: string | undefined, inputTone: string | undefined, tag: K,
  ) {
    const path = [key, index];
    const shape = svg(plot.layers[key], tag, "kui-chart-" + kind);
    const item = legendItem(notes, kind);
    const name = watch(label, [...path, "label"], text, "text");
    const style = watch(inputTone, [...path, "tone"], tone, "a chart tone");
    return {
      shape, path, name,
      draw(visible: boolean): string {
        const label = name() ?? "";
        const value = style() ?? "neutral";
        attr(shape, "data-tone", value);
        attr(shape, "visibility", visible ? "visible" : "hidden");
        drawKey(item, label, value, visible && label !== "");
        return label;
      },
    };
  }

  function render(): void {
    const extents = { x: new Extent(), y: new Extent() };
    const labels = {
      x: axes.x.label() ?? "", y: axes.y.label() ?? "", xUnit: axes.x.unit() ?? "", yUnit: axes.y.unit() ?? "",
    };
    const name = title() ?? "";
    textContent(heading, name);
    setHidden(heading, name === "");
    textContent(xLabel, axisCaption(labels.x, labels.xUnit));
    textContent(yLabel, axisCaption(labels.y, labels.yUnit));
    setHidden(xLabel, xLabel.textContent === "");
    setHidden(yLabel, yLabel.textContent === "");

    let total = 0;
    const enabled = layers.map((series, index) => {
      const count = series.count();
      if (total + count > V1_LIMITS.chartSamplesPerChart) {
        invalid(["series", index], "sample-budget", budgetMessage);
        return false;
      }
      total += count;
      const data = series.data();
      for (const point of data) {
        if (point) for (const key of axisKeys) extents[key].include(point[key]);
      }
      if (scales.y === "linear" && (series.type === "bar" || series.type === "area") && data.some(Boolean)) {
        extents.y.include(0);
      }
      return true;
    });
    const markerPoints = markers.map(marker => {
      const point = marker.value();
      if (point) for (const key of axisKeys) extents[key].include(point[key]);
      return point;
    });
    const referenceValues = references.map(reference => {
      const value = reference.value();
      if (value !== undefined) extents[reference.axis].include(value);
      return value;
    });
    const intervals = regions.map(region => {
      const interval = region.interval();
      if (interval) for (const value of interval) extents[region.axis].include(value);
      return interval;
    });

    x = axes.x.domain(extents.x, x);
    const points = layers.map((series, index) => {
      if (!enabled[index] || !x) return empty;
      const values = series.points(x);
      if (series.type === "function") for (const point of values) {
        if (point) extents.y.include(point.y);
      }
      return values;
    });
    y = axes.y.domain(extents.y, y);
    const projection = plot.layout(x && y ? { x, y } : undefined, width, height);
    const hits: Hit[] = [];

    regions.forEach((region, index) => {
      const interval = intervals[index];
      const domain = projection?.axes[region.axis];
      const visible = !!(interval && domain && interval[0] < domain.max && interval[1] > domain.min);
      region.draw(visible);
      if (visible && projection && interval && domain) {
        placeRegion(region.shape, projection, region.axis, Math.max(domain.min, interval[0]), Math.min(domain.max, interval[1]));
      } else if (interval && domain) invalid(region.path, "region-range", "The region is outside the current axis range.");
    });
    references.forEach((reference, index) => {
      const value = referenceValues[index];
      const domain = projection?.axes[reference.axis];
      const visible = value !== undefined && domain?.contains(value) === true;
      reference.draw(visible);
      if (visible && projection) placeReference(reference.shape, projection, reference.axis, value);
      else if (domain && value !== undefined) invalid([...reference.path, "value"], "axis-value", "The reference is outside the current axis range.");
    });
    markers.forEach((marker, index) => {
      const point = markerPoints[index];
      const visible = !!(point && projection?.contains(point));
      const label = marker.draw(visible);
      if (visible && point && projection) {
        const x = projection.x(point.x);
        const y = projection.y(point.y);
        placePoint(marker.shape, x, y);
        hits.push({ key: "m" + index, point: { x: point.x, y: point.y }, x, y, group: label || "Marker " + (index + 1) });
      } else if (point && projection) {
        for (const key of axisKeys) if (!projection.axes[key].contains(point[key])) {
          invalid([...marker.path, key], "axis-value", "The marker is outside the current axis range.");
        }
      }
    });

    const barPoints = points.filter((_, index) => layers[index]!.type === "bar" && enabled[index]);
    const widthPerBar = projection && barPoints.length > 0 ? barSlot(projection, barPoints, barPoints.length) : 0;
    let barIndex = 0;
    const showLegend = options.legend === "show" ||
      (options.legend !== "hide" && (layers.length > 1 || layers.some(series => series.label())));
    layers.forEach((series, index) => {
      const label = series.label() || series.type[0]!.toUpperCase() + series.type.slice(1) + " " + (index + 1);
      const color = series.getTone() ?? "neutral";
      attr(series.layer.group, "data-tone", color);
      drawKey(series.key, label, color, showLegend && enabled[index]!);
      if (!projection || !enabled[index]) {
        attr(series.layer.group, "visibility", "hidden");
        return;
      }
      attr(series.layer.group, "visibility", "visible");
      const bar = series.type === "bar" ? {
        width: widthPerBar * 0.9, offset: (barIndex++ - (barPoints.length - 1) / 2) * widthPerBar,
      } : undefined;
      for (const hit of series.layer.draw(projection, points[index]!, label, bar)) hits.push(hit);
    });
    setHidden(legend, !legend.querySelector("li:not([hidden])"));
    setHidden(notes, !notes.querySelector("li:not([hidden])"));
    // Markers precede series at an identical pointer position. Keyboard navigation follows x.
    hits.sort((left, right) => left.point.x - right.point.x);
    interaction.update(hits, labels, node.ariaLabel ?? name);
  }

  function resize(nextWidth: number, nextHeight: number): void {
    if (nextWidth <= 0 || nextHeight <= 0 || (nextWidth === width && nextHeight === height)) return;
    width = nextWidth;
    height = nextHeight;
    schedule();
  }
  const bounds = surface.getBoundingClientRect();
  resize(bounds.width, bounds.height);
  const Observer = container.ownerDocument.defaultView?.ResizeObserver;
  if (Observer) {
    const observer = new Observer(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) resize(rect.width, rect.height);
    });
    observer.observe(surface);
    lifetime.add(() => observer.disconnect());
  }
  ready = true;
  render();
  return figure;
}

function axisCaption(label: string, unit: string): string {
  return label && unit ? `${label} (${unit})` : label || unit;
}

function legendItem(list: HTMLElement, type: string) {
  const item = element(list, "li", "kui-chart-key");
  attr(item, "data-type", type);
  const swatch = element(item, "span", "kui-chart-swatch");
  attr(swatch, "aria-hidden", "true");
  return { item, label: element(item, "span", "kui-chart-key-label") };
}

function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

function drawKey(key: ReturnType<typeof legendItem>, label: string, tone: string, visible: boolean): void {
  setHidden(key.item, !visible);
  attr(key.item, "data-tone", tone);
  textContent(key.label, label);
}

export const chartRegistrations: readonly ComponentRegistration[] = Object.freeze([{
  definition: { ...v1ComponentSchema("chart"), validate: validateChart },
  mount(request) {
    const lifetime = request.context.lifetime.child();
    try {
      const root = mountChart(request, lifetime);
      return { ok: true, value: { root, dispose: () => lifetime.dispose() }, diagnostics: [] };
    } catch {
      lifetime.dispose();
      return { ok: false, diagnostics: [issue(request.node, [], "render", "mount", "The chart could not be mounted.")] };
    }
  },
}]);
