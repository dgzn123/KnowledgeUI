import { V1_LIMITS } from "#contracts";
import type {
  ComponentNode, ComponentSemanticValidator, Diagnostic, FieldPath, JsonValue, SourceLocation,
} from "#contracts";

export type Scale = "linear" | "log";
export type AxisKey = "x" | "y";
export type Tone = "neutral" | "info" | "success" | "danger" | "warning";
export type SeriesKind = "line" | "bar" | "scatter" | "area" | "function";

type NumberInput = string | number;
interface AxisInput {
  readonly scale?: Scale;
  readonly min?: NumberInput;
  readonly max?: NumberInput;
  readonly label?: string;
  readonly unit?: string;
}
interface PointInput {
  readonly x: NumberInput;
  readonly y: NumberInput;
  readonly label?: string;
}
interface StyledInput {
  readonly label?: string;
  readonly tone?: Tone | string;
}
export type SeriesInput = StyledInput & (
  | { readonly type: Exclude<SeriesKind, "function">; readonly points: string | readonly PointInput[] }
  | { readonly type: "function"; readonly samples?: number }
);
interface ReferenceInput extends StyledInput {
  readonly axis: AxisKey;
  readonly value: NumberInput;
}
interface RegionInput extends StyledInput {
  readonly axis: AxisKey;
  readonly from: NumberInput;
  readonly to: NumberInput;
}
export interface ChartInput {
  readonly title?: string;
  readonly xAxis: AxisInput;
  readonly yAxis: AxisInput;
  readonly series: readonly SeriesInput[];
  readonly legend?: "auto" | "show" | "hide";
  readonly referenceLines?: readonly ReferenceInput[];
  readonly regions?: readonly RegionInput[];
  readonly markers?: readonly PointInput[];
}

export function chartInput(node: ComponentNode): ChartInput {
  // ProtocolReader already validated the literal fields. Bound values are checked after resolution.
  return node.props as unknown as ChartInput;
}

export const finite = (value: JsonValue): value is number => typeof value === "number" && Number.isFinite(value);
export const text = (value: JsonValue): value is string => typeof value === "string";
export const tone = (value: JsonValue): value is Tone =>
  value === "neutral" || value === "info" || value === "success" || value === "danger" || value === "warning";

export function pointArray(value: JsonValue): value is readonly JsonValue[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > V1_LIMITS.chartSamplesPerSeries) return false;
  return (value as readonly JsonValue[]).every(point => {
    if (point === null || typeof point !== "object" || Array.isArray(point)) return false;
    const keys = Object.keys(point);
    const x = Object.getOwnPropertyDescriptor(point, "x")?.value as JsonValue;
    const y = Object.getOwnPropertyDescriptor(point, "y")?.value as JsonValue;
    const label = Object.getOwnPropertyDescriptor(point, "label")?.value as JsonValue;
    return keys.every(key => key === "x" || key === "y" || key === "label") &&
      finite(x) && finite(y) && (!keys.includes("label") || text(label));
  });
}

export function location(node: ComponentNode, field: FieldPath): SourceLocation {
  let range = node.source.range;
  for (let length = field.length; length > 0; length--) {
    const located = node.locate(field.slice(0, length));
    if (located) {
      range = located;
      break;
    }
  }
  return { path: [...node.source.path, ...field], ...(range && { range }) };
}

export function issue(
  node: ComponentNode, field: FieldPath, phase: "semantic" | "render", code: string, message: string,
): Diagnostic {
  return { ...location(node, field), phase, code: phase + ".chart-" + code, message, severity: "error" };
}

export function badLogValue(scale: Scale | undefined, value: NumberInput | undefined): boolean {
  return scale === "log" && typeof value === "number" && value <= 0;
}

export function sampleCount(series: Extract<SeriesInput, { type: "function" }>): number {
  return series.samples ?? 128;
}

export const budgetMessage = "A chart allows at most " + V1_LIMITS.chartSamplesPerChart + " series points and samples in total.";
export const logMessage = "Logarithmic axes require positive values.";

export const validateChart: ComponentSemanticValidator = ({ node, sourceId }) => {
  const { xAxis, yAxis, series, markers, referenceLines, regions } = chartInput(node);
  const axes = { x: xAxis, y: yAxis };
  const diagnostics: Diagnostic[] = [];
  const add = (field: FieldPath, code: string, message: string) => {
    if (diagnostics.length <= V1_LIMITS.diagnostics) {
      diagnostics.push({ ...issue(node, field, "semantic", code, message), ...(sourceId !== undefined && { sourceId }) });
    }
  };
  const checkLog = (key: AxisKey, value: NumberInput | undefined, field: FieldPath) => {
    if (badLogValue(axes[key].scale, value)) add(field, "log-value", logMessage);
  };
  const checkPoint = (point: PointInput, field: FieldPath) => {
    checkLog("x", point.x, [...field, "x"]);
    checkLog("y", point.y, [...field, "y"]);
  };

  for (const key of ["x", "y"] as const) {
    const path = [key + "Axis"];
    const { min, max } = axes[key];
    checkLog(key, min, [...path, "min"]);
    checkLog(key, max, [...path, "max"]);
    if (typeof min === "number" && typeof max === "number" && min >= max) {
      add(path, "axis-range", "The axis minimum must be smaller than its maximum.");
    }
  }
  let total = 0;
  for (const [index, item] of series.entries()) {
    if (item.type === "function") total += sampleCount(item);
    else if (typeof item.points !== "string") {
      total += item.points.length;
      item.points.forEach((point, at) => checkPoint(point, ["series", index, "points", at]));
    }
  }
  if (total > V1_LIMITS.chartSamplesPerChart) add(["series"], "sample-budget", budgetMessage);
  markers?.forEach((point, index) => checkPoint(point, ["markers", index]));
  referenceLines?.forEach(({ axis, value }, index) => checkLog(axis, value, ["referenceLines", index, "value"]));
  regions?.forEach(({ axis, from, to }, index) => {
    const path = ["regions", index];
    checkLog(axis, from, [...path, "from"]);
    checkLog(axis, to, [...path, "to"]);
    if (typeof from === "number" && typeof to === "number" && from >= to) {
      add(path, "region-range", "The region start must be smaller than its end.");
    }
  });
  return diagnostics;
};
