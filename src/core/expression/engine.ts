import { V1_LIMITS } from "#contracts";
import type {
  CompiledExpression, ExpressionBudget, ExpressionEngine, JsonObject, JsonValue, Result, SourceLocation,
} from "#contracts";
import { checkKey, constants, ExpressionError, parse, refuse } from "./grammar.ts";
import type { Binary, Tree } from "./grammar.ts";

function finite(value: number): number {
  if (!Number.isFinite(value)) refuse("non-finite", "Expected a finite numeric result.");
  return value;
}

function number(value: JsonValue): number {
  if (typeof value !== "number") refuse("type", "Expected a number.");
  return finite(value);
}

function boolean(value: JsonValue): boolean {
  if (typeof value !== "boolean") refuse("type", "Expected a boolean condition.");
  return value;
}

function precision(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    refuse("precision", "Precision must be an integer from 0 through 100.");
  }
  return value;
}

type BuiltIn = (args: readonly JsonValue[]) => JsonValue;

function arity(min: number, max: number, apply: BuiltIn): BuiltIn {
  return args => {
    if (args.length < min || args.length > max) refuse("arity", "Invalid number of function arguments.");
    return apply(args);
  };
}

function math(min: number, max: number, apply: (...args: number[]) => number): BuiltIn {
  return arity(min, max, args => finite(apply(...args.map(number))));
}

const functions = new Map<string, BuiltIn>([
  ["abs", math(1, 1, Math.abs)], ["sqrt", math(1, 1, Math.sqrt)], ["pow", math(2, 2, Math.pow)],
  ["exp", math(1, 1, Math.exp)], ["ln", math(1, 1, Math.log)], ["log10", math(1, 1, Math.log10)],
  ["sin", math(1, 1, Math.sin)], ["cos", math(1, 1, Math.cos)], ["tan", math(1, 1, Math.tan)],
  ["asin", math(1, 1, Math.asin)], ["acos", math(1, 1, Math.acos)], ["atan", math(1, 1, Math.atan)],
  ["floor", math(1, 1, Math.floor)], ["ceil", math(1, 1, Math.ceil)],
  ["min", math(1, V1_LIMITS.expressionLength, Math.min)], ["max", math(1, V1_LIMITS.expressionLength, Math.max)],
  ["clamp", math(3, 3, (value, min, max) => {
    if (min > max) refuse("range", "Clamp minimum must be at most its maximum.");
    return Math.min(max, Math.max(min, value));
  })],
  ["round", math(1, 2, (value, digits = 0) =>
    digits === 0 ? Math.round(value) : Number(value.toFixed(precision(digits))))],
  ["fmt", arity(1, 2, args => number(args[0]!).toFixed(precision(args[1] === undefined ? 0 : number(args[1]))))],
  ["len", arity(1, 1, ([value]) => {
    if (typeof value === "string" || Array.isArray(value)) return value.length;
    return refuse("type", "Length requires a string or an array.");
  })],
]);

export function isReservedName(name: string): boolean {
  return constants.has(name) || functions.has(name);
}

function scalar(value: JsonValue): boolean {
  return value === null || typeof value !== "object";
}

function binary(op: Binary, left: JsonValue, right: JsonValue): JsonValue {
  if (op === "==" || op === "!=") {
    if (typeof left !== typeof right || !scalar(left) || !scalar(right)) {
      refuse("type", "Equality requires scalars of the same type.");
    }
    return op === "==" ? left === right : left !== right;
  }
  switch (op) {
    case "<": case "<=": case ">": case ">=": {
      const [a, b]: readonly [string, string] | readonly [number, number] =
        typeof left === "string" && typeof right === "string" ? [left, right] : [number(left), number(right)];
      if (op === "<") return a < b;
      if (op === "<=") return a <= b;
      if (op === ">") return a > b;
      return a >= b;
    }
    case "+": return finite(number(left) + number(right));
    case "-": return finite(number(left) - number(right));
    case "*": return finite(number(left) * number(right));
    case "/": case "%": {
      const a = number(left);
      const b = number(right);
      if (b === 0) refuse("division-by-zero", "Cannot divide by zero.");
      return finite(op === "/" ? a / b : a % b);
    }
    case "^": return finite(number(left) ** number(right));
    case "&&": case "||": return boolean(right);
  }
}

function readValue(target: object, key: string, absentCode: string): JsonValue {
  const property = Object.getOwnPropertyDescriptor(target, key);
  if (!property) refuse(absentCode, "No own data property " + JSON.stringify(key) + ".");
  if (!("value" in property)) refuse("property", "Accessor properties are unavailable.");
  const value: unknown = property.value;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return finite(value);
  if (typeof value === "object" && (Array.isArray(value) || plainObject(value))) return value as JsonValue;
  return refuse("type", "Expected a JSON value.");
}

function plainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function lookup(target: JsonValue, key: JsonValue): JsonValue {
  if (Array.isArray(target)) {
    if (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0) {
      refuse("index", "Array indexes must be nonnegative integers.");
    }
    if (key >= target.length) refuse("index", "Array index is out of bounds.");
    return readValue(target, String(key), "index");
  }
  if (typeof target !== "object" || target === null || !plainObject(target) || typeof key !== "string") {
    return refuse("type", "Object lookup requires a data object and a string key.");
  }
  checkKey(key);
  return readValue(target, key, "property");
}

function evaluate(tree: Tree, values: JsonObject, maxSteps: number): JsonValue {
  let steps = 0;
  function visit(node: Tree): JsonValue {
    if (++steps > maxSteps) refuse("step-limit", "Expression exceeds the allowed " + maxSteps + " evaluation steps.");
    switch (node.kind) {
      case "literal": return node.value;
      case "variable": return readValue(values, node.name, "unknown-identifier");
      case "lookup": return lookup(visit(node.target), visit(node.key));
      case "unary": {
        const value = visit(node.operand);
        if (node.op === "!") return !boolean(value);
        return node.op === "-" ? -number(value) : number(value);
      }
      case "binary": {
        const left = visit(node.left);
        if (node.op === "&&" && !boolean(left)) return false;
        if (node.op === "||" && boolean(left)) return true;
        return binary(node.op, left, visit(node.right));
      }
      case "condition": return boolean(visit(node.test)) ? visit(node.yes) : visit(node.no);
      case "call": return functions.get(node.name)!(node.args.map(visit));
    }
  }
  return visit(tree);
}

const compiled = new WeakMap<CompiledExpression, { readonly tree: Tree; readonly budget: ExpressionBudget }>();

function limits(budget?: ExpressionBudget): ExpressionBudget {
  function limit(requested: number | undefined, maximum: number): number {
    if (requested === undefined) return maximum;
    if (!Number.isSafeInteger(requested) || requested < 0) refuse("budget", "Expected a nonnegative integer budget.");
    return Math.min(requested, maximum);
  }
  return {
    maxLength: limit(budget?.maxLength, V1_LIMITS.expressionLength),
    maxDepth: limit(budget?.maxDepth, V1_LIMITS.expressionDepth),
    maxSteps: limit(budget?.maxSteps, V1_LIMITS.expressionSteps),
  };
}

function result<T>(location: SourceLocation, run: () => T): Result<T> {
  try {
    return { ok: true, value: run(), diagnostics: [] };
  } catch (error) {
    const failure = error instanceof ExpressionError
      ? error : new ExpressionError("invalid-data", "Expression received invalid data.");
    return {
      ok: false,
      diagnostics: [{ ...location, phase: "expression", severity: "error",
        code: "expression." + failure.code, message: failure.message }],
    };
  }
}

export const expressionEngine: ExpressionEngine = {
  compile(source, location, budget) {
    return result(location, () => {
      const cap = limits(budget);
      if (source.length > cap.maxLength) refuse("length-limit", "Expression exceeds " + cap.maxLength + " characters.");
      const { tree, dependencies } = parse(source, cap.maxDepth, functions);
      const expression: CompiledExpression = Object.freeze({
        source, location, get dependencies() { return new Set(dependencies); },
      });
      compiled.set(expression, { tree, budget: cap });
      return expression;
    });
  },
  evaluate(expression, values, budget) {
    return result(expression.location, () => {
      const entry = compiled.get(expression);
      if (!entry) return refuse("invalid-compiled", "Expected an expression compiled by this service.");
      const cap = limits(budget);
      if (expression.source.length > cap.maxLength) refuse("length-limit", "Expression exceeds " + cap.maxLength + " characters.");
      if (entry.tree.depth > cap.maxDepth) refuse("depth-limit", "Expression exceeds the allowed depth of " + cap.maxDepth + ".");
      return evaluate(entry.tree, values, Math.min(cap.maxSteps, entry.budget.maxSteps));
    });
  },
};
