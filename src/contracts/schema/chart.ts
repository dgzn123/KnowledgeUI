import { V1_LIMITS } from "../shared.ts";
import { bound, choice, component, expression, list, number, object, tagged, text, tone, union } from "./fields.ts";

const axis = object({
  label: text, unit: text, scale: choice("linear", "log"), min: bound(number), max: bound(number),
});
const point = object({ x: bound(number), y: bound(number), label: text }, ["x", "y"]);
const samples = { type: "integer", minimum: 2, maximum: V1_LIMITS.chartSamplesPerSeries } as const;
const dataSeries = { label: text, tone, points: bound(list(point, 1, V1_LIMITS.chartSamplesPerSeries)) };
const series = union(
  ...["line", "bar", "scatter", "area"].map(type => tagged("type", type, dataSeries, ["points"])),
  tagged("type", "function", { label: text, tone, expr: expression, samples }, ["expr"]),
);
const referenceLine = object(
  { axis: choice("x", "y"), value: bound(number), label: text, tone },
  ["axis", "value"],
);
const region = object(
  { axis: choice("x", "y"), from: bound(number), to: bound(number), label: text, tone },
  ["axis", "from", "to"],
);

export const chartComponent = component("chart", "Vector data and function plots", {
  title: text, xAxis: axis, yAxis: axis, series: list(series, 1, 16),
  referenceLines: list(referenceLine, 0, 32), regions: list(region, 0, 32),
  markers: list(point, 0, 32), legend: choice("auto", "show", "hide"),
}, ["xAxis", "yAxis", "series"]);
