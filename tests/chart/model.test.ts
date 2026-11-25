import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { V1_LIMITS } from "#contracts";
import { axis, Axis, Extent, formatNumber, sample } from "../../src/components/chart/geometry.ts";
import { chartRegistrations } from "../../src/components/chart/index.ts";
import { basicRegistrations } from "../../src/components/basic/index.ts";
import { controlRegistrations } from "../../src/components/controls/index.ts";
import { bindingFactory, expressionEngine } from "../../src/core/expression/index.ts";
import { createProtocolCatalog, createProtocolReader, markdownBlockScanner, yamlReader } from "../../src/core/protocol/index.ts";

const registrations = [...basicRegistrations, ...controlRegistrations, ...chartRegistrations];
const catalog = createProtocolCatalog(registrations.map(registration => registration.definition));
assert.ok(catalog.ok);
const protocol = createProtocolReader({ catalog: catalog.value, yaml: yamlReader, expressions: expressionEngine });

const read = (value: unknown) => protocol.read({ yaml: JSON.stringify(value), sourceId: "chart.md" });
const chart = (fields: object) => ({ version: 1, type: "chart", xAxis: {}, yAxis: {}, ...fields });

test("chart schema, aggregate sample budget and source ranges", () => {
  const series = Array.from({ length: 4 }, () => ({ type: "function", expr: "x", samples: V1_LIMITS.chartSamplesPerSeries }));
  assert.ok(read(chart({ series })).ok);
  const exceeded = read(chart({ series: [...series, { type: "scatter", points: [{ x: 1, y: 2 }] }] }));
  assert.equal(exceeded.ok, false);
  assert.equal(exceeded.diagnostics[0]?.code, "semantic.chart-sample-budget");
  assert.deepEqual(exceeded.diagnostics[0]?.path, ["series"]);
  assert.equal(exceeded.diagnostics[0]?.sourceId, "chart.md");
  assert.ok(exceeded.diagnostics[0]?.range);
  assert.equal(read(chart({ series: [{ ...series[0], samples: V1_LIMITS.chartSamplesPerSeries + 1 }] })).ok, false);
  assert.equal(read(chart({ series: [{ type: "line", points: [{ x: 1, y: 2, extra: true }] }] })).ok, false);
});

test("protocol rejects literal non-positive log coordinates and reversed bounds", () => {
  const result = read(chart({
    xAxis: { scale: "log", min: 0 },
    yAxis: { min: 2, max: 1 },
    series: [{ type: "bar", points: [{ x: -1, y: 1 }] }],
    referenceLines: [{ axis: "x", value: 0 }],
    markers: [{ x: 0, y: 1 }],
    regions: [{ axis: "x", from: 2, to: 1 }],
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map(item => [item.code, item.path]), [
    ["semantic.chart-log-value", ["xAxis", "min"]],
    ["semantic.chart-axis-range", ["yAxis"]],
    ["semantic.chart-log-value", ["series", 0, "points", 0, "x"]],
    ["semantic.chart-log-value", ["markers", 0, "x"]],
    ["semantic.chart-log-value", ["referenceLines", 0, "value"]],
    ["semantic.chart-region-range", ["regions", 0]],
  ]);
});

test("function sampling uses the ProtocolReader expression and a lexical x", () => {
  const accepted = read(chart({ series: [{ type: "function", expr: "x^2", samples: 5 }] }));
  assert.ok(accepted.ok);
  const expression = accepted.value.root.expressions["/series/0/expr"];
  assert.ok(expression);
  const bindings = bindingFactory.create(undefined);
  assert.deepEqual(sample(bindings, expression, new Axis("linear", -2, 2), "linear", 5).points,
    [{ x: -2, y: 4 }, { x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 4 }]);
  const logarithmic = sample(bindings, expression, new Axis("log", 1, 1000), "log", 4);
  assert.deepEqual(logarithmic.points.map(point => formatNumber(point!.x)), ["1", "10", "100", "1000"]);
  assert.deepEqual(logarithmic.points.map(point => formatNumber(point!.y)), ["1", "100", "10000", "1000000"]);
  assert.equal(Object.hasOwn(bindings.snapshot(), "x"), false);
  const wrongScope = read(chart({ series: [{ type: "function", expr: "x", label: "{{x}}" }] }));
  assert.equal(wrongScope.ok, false);
  assert.deepEqual(wrongScope.diagnostics[0]?.path, ["series", 0, "label"]);
});

test("axes retain finite projections at numeric extremes and expand singular domains", () => {
  const huge = new Axis("linear", -Number.MAX_VALUE, Number.MAX_VALUE);
  assert.equal(huge.fraction(0), 0.5);
  assert.equal(huge.value(0.5), 0);
  assert.match(formatNumber(huge.max, 5), /^1\.7977e\+308$/);
  const tiny = new Axis("log", Number.MIN_VALUE, Number.MIN_VALUE * 2);
  assert.ok(tiny.fraction(tiny.value(0.5)) >= 0 && tiny.fraction(tiny.value(0.5)) <= 1);
  const broad = new Axis("log", Number.MIN_VALUE, Number.MAX_VALUE);
  const middle = broad.value(0.5);
  assert.ok(Number.isFinite(middle) && middle > 0);
  assert.ok(Math.abs(broad.fraction(middle) - 0.5) < 1e-12);
  const single = new Extent();
  single.include(30);
  const automatic = axis("log", undefined, undefined, single);
  assert.deepEqual([automatic?.min, automatic?.max], [3, 300]);
  assert.equal(axis("log", undefined, undefined, single, automatic), automatic);
  assert.equal(axis("linear", 5, undefined, new Extent())?.min, 5);
  assert.equal(axis("linear", undefined, -10, new Extent())?.max, -10);
  assert.equal(axis("linear", 4, 4, new Extent()), undefined);
});

test("every chart Gallery block passes the injected shared protocol", async () => {
  const markdown = await readFile(new URL("../../examples/gallery/chart.md", import.meta.url), "utf8");
  const scanned = markdownBlockScanner.scan(markdown, "chart.md");
  assert.ok(scanned.ok);
  assert.equal(scanned.value.length, 3);
  for (const block of scanned.value) {
    const result = protocol.read(block);
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
  }
});
