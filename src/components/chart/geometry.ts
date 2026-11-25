import type { BindingContext, CompiledExpression, Diagnostic } from "#contracts";
import { finite } from "./data.ts";
import type { Scale } from "./data.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}
export type Points = readonly (Point | undefined)[];

export class Extent {
  min = Infinity;
  max = -Infinity;

  include(value: number): void {
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
  }
}

function nearby(value: number, scale: Scale, direction: -1 | 1): number {
  if (scale === "log") {
    return Math.max(Number.MIN_VALUE, Math.min(Number.MAX_VALUE, direction < 0 ? value / 10 : value * 10));
  }
  const distance = Math.max(Number.MIN_VALUE, Math.abs(value) * 0.1 || 1);
  return Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value + direction * distance));
}

export class Axis {
  readonly min: number;
  readonly max: number;
  readonly scale: Scale;
  readonly #span: number;

  constructor(scale: Scale, min: number, max: number) {
    this.min = min;
    this.max = max;
    this.scale = scale;
    this.#span = scale === "log" ? this.#logDistance(max) : max - min;
  }

  #logDistance(value: number): number {
    const relative = (value - this.min) / this.min;
    return Math.abs(relative) < 0.5 ? Math.log1p(relative) : Math.log(value) - Math.log(this.min);
  }

  fraction(value: number): number {
    if (value === this.min) return 0;
    if (value === this.max) return 1;
    if (this.scale === "log") return this.#logDistance(value) / this.#span;
    const distance = value - this.min;
    return Number.isFinite(this.#span)
      ? distance / this.#span
      : (value * 0.5 - this.min * 0.5) / (this.max * 0.5 - this.min * 0.5);
  }

  value(fraction: number): number {
    if (fraction === 0) return this.min;
    if (fraction === 1) return this.max;
    if (this.scale === "log") {
      const step = this.#span * fraction;
      const candidate = step < 0.5
        ? this.min + this.min * Math.expm1(step)
        : Math.exp(Math.log(this.min) + step);
      return Math.max(this.min, Math.min(this.max, candidate));
    }
    const candidate = Number.isFinite(this.#span)
      ? this.min + this.#span * fraction
      : this.min * (1 - fraction) + this.max * fraction;
    return Math.max(this.min, Math.min(this.max, candidate));
  }

  contains(value: number): boolean {
    return value >= this.min && value <= this.max;
  }
}

export function axis(scale: Scale, min: number | undefined, max: number | undefined, extent: Extent, previous?: Axis): Axis | undefined {
  const hasData = extent.min <= extent.max;
  let low = min ?? (hasData ? extent.min : scale === "log" ? 1 : 0);
  let high = max ?? (hasData ? extent.max : scale === "log" ? 10 : 1);
  if (low >= high) {
    if (min === undefined) low = nearby(high, scale, -1);
    if (max === undefined) high = nearby(min ?? extent.max, scale, 1);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) return undefined;
  return previous?.min === low && previous.max === high ? previous : new Axis(scale, low, high);
}

export function sample(
  binding: BindingContext, expression: CompiledExpression, xAxis: Axis, yScale: Scale, count: number,
): { points: Points; diagnostic?: Diagnostic } {
  const points: (Point | undefined)[] = [];
  let firstFailure: string | undefined;
  let invalid = 0;
  for (let index = 0; index < count; index++) {
    const x = xAxis.value(index / (count - 1));
    const result = binding.withLocals({ x }).evaluate(expression);
    if (result.ok && finite(result.value) && (yScale !== "log" || result.value > 0)) {
      points.push({ x, y: result.value });
      continue;
    }
    points.push(undefined);
    invalid++;
    firstFailure ??= result.ok
      ? finite(result.value) ? "Logarithmic axes require positive values." : "The function must produce a finite number."
      : result.diagnostics[0]?.message;
  }
  if (invalid === 0) return { points };
  return { points, diagnostic: {
    ...expression.location, phase: "render", code: "render.chart-function-sample",
    severity: invalid === count ? "error" : "warning",
    message: `Skipped ${invalid} of ${count} function samples. ${firstFailure ?? "Function evaluation failed."}`,
  } };
}

export function formatNumber(value: number, precision = 6): string {
  const short = value.toPrecision(precision);
  const rounded = Number(short);
  return Number.isFinite(rounded) ? rounded.toString() : short;
}

export function boundedFraction(axis: Axis, value: number): number {
  return Math.max(-1e4, Math.min(1e4, axis.fraction(value)));
}

/** Detect isolated jumps between finite samples. Smaller or unresolved jumps can remain between samples. */
export function breaksBetween(ordinates: readonly (number | undefined)[], index: number): boolean {
  const before = ordinates[index - 2];
  const left = ordinates[index - 1];
  const right = ordinates[index];
  const after = ordinates[index + 1];
  if (before === undefined || left === undefined || right === undefined || after === undefined) return false;
  const jump = right - left;
  const leading = left - before;
  const trailing = after - right;
  return Math.abs(jump) > 0.25 && (
    Math.abs(jump) > 8 * Math.max(Math.abs(leading), Math.abs(trailing)) ||
    (Math.sign(jump) !== Math.sign(leading) && Math.sign(leading) === Math.sign(trailing)
      && Math.abs(jump) > 2 * Math.max(Math.abs(leading), Math.abs(trailing)))
  );
}
