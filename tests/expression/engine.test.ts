import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExpressionBudget, JsonObject, Result, SourceLocation } from "#contracts";
import { V1_LIMITS } from "#contracts";
import { bindingFactory, expressionEngine } from "../../src/core/expression/index.ts";

const location: SourceLocation = { path: ["layout", "children", 2, "value"], range: {
  start: { line: 3, column: 5, offset: 11 }, end: { line: 3, column: 20, offset: 26 },
} };

function value<T>(result: Result<T>): T {
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.value;
}

function rejects(result: Result<unknown>, code: string) {
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0]?.code, "expression." + code);
  assert.deepEqual(result.diagnostics[0]?.path, location.path);
  assert.deepEqual(result.diagnostics[0]?.range, location.range);
}

function run(source: string, values: JsonObject = {}, budget?: ExpressionBudget) {
  return expressionEngine.evaluate(value(expressionEngine.compile(source, location)), values, budget);
}

test("precedence, signed powers, right associativity and free identifiers", () => {
  assert.equal(value(run("2 + 3 * 4 % 5")), 4);
  assert.equal(value(run("-2^2 + 2^3^2 + 2^-2")), 508.25);
  assert.equal(value(run("(-2)^2")), 4);
  assert.equal(value(run("true ? false ? 1 : 2 : 3")), 2);
  assert.equal(value(run(".5e+1 + 2.")), 7);
  const expression = value(expressionEngine.compile("abs(amount) > PI ? steps[index].title : other", location));
  assert.deepEqual([...expression.dependencies], ["amount", "steps", "index", "other"]);
});

test("logical branches short circuit and operands keep their types", () => {
  assert.equal(value(run("false && 1/0 > 0")), false);
  assert.equal(value(run("true || missing")), true);
  assert.equal(value(run("false ? absent : null")), null);
  assert.equal(value(run("'one' != 'two' && null == null")), true);
  assert.equal(value(run("'one' < 'two'")), true);
  for (const source of ["1 && true", "true && 1", "1 ? 2 : 3", "!'one'", "'2'+2", "2<'1'", "null==false", "rows==rows"]) {
    rejects(run(source, { rows: [] }), "type");
  }
});

test("math functions, numeric formatting, and structured errors for invalid results", () => {
  assert.equal(value(run("max(abs(-2), clamp(10, 0, 3), sqrt(4), ln(E), sin(PI/2))")), 3);
  assert.equal(value(run("round(2.3456, 2)")), 2.35);
  assert.equal(value(run("fmt(2, 3)")), "2.000");
  assert.equal(value(run("len('a\\u0062') + len(rows)", { rows: [1, 2] })), 4);
  rejects(run("4 % 0"), "division-by-zero");
  rejects(run("sqrt(-1)"), "non-finite");
  rejects(run("10^900"), "non-finite");
  rejects(run("min()"), "arity");
  rejects(run("round(1, -2)"), "precision");
  rejects(run("len(3)"), "type");
});

test("lookups require own data properties and valid indexes", () => {
  const values = { rows: [{ title: "Ready", 3: "three" }], i: 0 };
  assert.equal(value(run("rows[i]['title']", values)), "Ready");
  assert.equal(value(run("rows[0]['3']", values)), "three");
  for (const source of ["rows[-1]", "rows[0.5]", "rows[1]", "rows['0']", "rows.length"]) rejects(run(source, values), "index");
  rejects(run("rows[0].missing", values), "property");
  rejects(run("missing"), "unknown-identifier");
  rejects(run("rows[0].toString", values), "property");
  let read = false;
  const object = Object.defineProperty({}, "value", { get() { read = true; return 3; } });
  rejects(run("object.value", { object }), "property");
  rejects(run("value", object), "property");
  assert.equal(read, false);
});

test("only whitelisted calls and nonreserved own field names are accepted", () => {
  for (const source of ["value.constructor", "value['prototype']", "__proto__"]) {
    rejects(expressionEngine.compile(source, location), "property");
  }
  rejects(run("value[key]", { value: {}, key: "constructor" }), "property");
  rejects(expressionEngine.compile("unknown(1)", location), "function");
  rejects(expressionEngine.compile("sqrt", location), "function");
  for (const source of ["value.method()", "1;2", "value=2", "{}", "a..b", "'' ''", "1e"]) {
    rejects(expressionEngine.compile(source, location), "syntax");
  }
});

test("v1 caps override relaxed caller budgets and smaller budgets apply at both stages", () => {
  const budget = { maxLength: V1_LIMITS.expressionLength, maxDepth: V1_LIMITS.expressionDepth, maxSteps: 3 };
  const exact = "1" + " ".repeat(budget.maxLength - 1);
  assert.equal(value(run(exact)), 1);
  rejects(expressionEngine.compile(exact + " ", location, { ...budget, maxLength: 2000 }), "length-limit");
  const nested = "(".repeat(budget.maxDepth - 1) + "1" + ")".repeat(budget.maxDepth - 1);
  assert.equal(value(run(nested)), 1);
  rejects(expressionEngine.compile("(" + nested + ")", location, { ...budget, maxDepth: 90 }), "depth-limit");
  rejects(expressionEngine.compile("1" + "+1".repeat(budget.maxDepth), location), "depth-limit");
  assert.equal(value(run("1+2", {}, budget)), 3);
  rejects(run("1+2", {}, { ...budget, maxSteps: 2 }), "step-limit");
  const restricted = value(expressionEngine.compile("1+2", location, { ...budget, maxSteps: 2 }));
  rejects(expressionEngine.evaluate(restricted, {}, budget), "step-limit");
  assert.equal(value(run("false && 1/0 > 0", {}, { ...budget, maxSteps: 2 })), false);
  rejects(expressionEngine.compile("1", location, { ...budget, maxDepth: Number.NaN }), "budget");
  rejects(expressionEngine.evaluate({ source: "1", location, dependencies: new Set() }, {}), "invalid-compiled");
});

test("typed interpolation, mixed scalars, quoted delimiters and escaped openers", () => {
  const row = Object.freeze({ title: "Ready" });
  const bindings = bindingFactory.create(undefined).withLocals({ count: 2, row });
  const text = (source: string) => bindings.resolve({ source: location, value: source, expected: "text",
    accepts: (item): item is string => typeof item === "string" });
  const number = (source: string) => bindings.resolve({ source: location, value: source, expected: "a number",
    accepts: (item): item is number => typeof item === "number" });
  assert.equal(value(number("{{count}}")), 2);
  assert.equal(value(text(" {{count}} ")), " 2 ");
  assert.equal(value(text("{{'closing }} delimiter'}}")), "closing }} delimiter");
  assert.equal(value(text("\\{{literal}} {{count}}: {{null}}{{true}}")), "{{literal}} 2: true");
  assert.equal(value(text("{{row.title}}")), "Ready");
  rejects(text("{{count}}"), "binding-type");
  rejects(text("Row {{row}}"), "binding-scalar");
  rejects(text("{{' }} '"), "unclosed-binding");
});
