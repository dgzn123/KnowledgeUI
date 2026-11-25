import type {
  BindingContext, BindingFactory, BindingInput, CompiledExpression, Disposable, JsonObject,
  JsonValue, Result, SourceLocation, StateStore, ValueGuard,
} from "#contracts";
import { isReservedKey, record } from "../protocol/support.ts";
import { disposedStores } from "../state/disposal.ts";
import { expressionEngine } from "./engine.ts";
import { frameTask } from "./frame.ts";

interface BindingPlan {
  readonly dependencies: ReadonlySet<string>;
  resolve(values: JsonObject): Result<JsonValue>;
}

type Segment = string | CompiledExpression;
const empty = Object.freeze(record<JsonValue>());
const noop: Disposable = { dispose() {} };

function success<T>(value: T): Result<T> {
  return { ok: true, value, diagnostics: [] };
}

function failure(source: SourceLocation, code: string, message: string): Result<never> {
  return { ok: false, diagnostics: [{ ...source, code: "expression." + code, message,
    phase: "expression", severity: "error" }] };
}

// Quoted delimiters and escaped openers follow the ProtocolReader's v1 annotation scan.
function closingDelimiter(text: string, opening: number): number {
  let quote: string | undefined;
  for (let index = opening + 2; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\") index++;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "}" && text[index + 1] === "}") {
      return index;
    }
  }
  return -1;
}

function compileBinding(value: JsonValue, source: SourceLocation): Result<BindingPlan> {
  const dependencies = new Set<string>();
  if (typeof value !== "string" || !value.includes("{{")) {
    return success({ dependencies, resolve: () => success(value) });
  }
  const segments: Segment[] = [];
  let cursor = 0;
  let literal = "";
  for (let start = value.indexOf("{{"); start !== -1; start = value.indexOf("{{", cursor)) {
    if (value[start - 1] === "\\") {
      literal += value.slice(cursor, start - 1) + "{{";
      cursor = start + 2;
      continue;
    }
    const end = closingDelimiter(value, start);
    if (end < 0) return failure(source, "unclosed-binding", "Binding is missing its closing delimiter.");

    literal += value.slice(cursor, start);
    if (literal) segments.push(literal);
    literal = "";
    const expression = expressionEngine.compile(value.slice(start + 2, end), source);
    if (!expression.ok) return expression;
    segments.push(expression.value);
    for (const name of expression.value.dependencies) dependencies.add(name);
    cursor = end + 2;
  }
  literal += value.slice(cursor);
  if (literal) segments.push(literal);
  return success({
    dependencies,
    resolve(values) {
      const only = segments[0];
      if (segments.length === 1 && typeof only === "object") {
        return expressionEngine.evaluate(only, values);
      }
      let output = "";
      for (const segment of segments) {
        if (typeof segment === "string") {
          output += segment;
          continue;
        }
        const result = expressionEngine.evaluate(segment, values);
        if (!result.ok) return result;
        if (result.value !== null && typeof result.value === "object") {
          return failure(source, "binding-scalar", "Mixed bindings require scalar results.");
        }
        output += result.value === null ? "" : String(result.value);
      }
      return success(output);
    },
  });
}

function guard<T extends JsonValue>(value: Result<JsonValue>, input: BindingInput<T>): Result<T> {
  if (!value.ok) return value;
  const accepts: ValueGuard<T> = input.accepts;
  if (!accepts(value.value)) return failure(input.source, "binding-type", "Binding must produce " + input.expected + ".");
  return { ok: true, value: value.value, diagnostics: value.diagnostics };
}

function merge(base: JsonObject, locals: JsonObject): JsonObject {
  const values = record<JsonValue>();
  for (const group of [base, locals]) {
    for (const name of Object.keys(group)) {
      if (isReservedKey(name) || Object.hasOwn(values, name)) continue;
      const property = Object.getOwnPropertyDescriptor(group, name);
      if (property && "value" in property) values[name] = property.value as JsonValue;
    }
  }
  return Object.freeze(values);
}

class Bindings implements BindingContext {
  readonly expressions = expressionEngine;

  readonly #store: StateStore | undefined;
  readonly #locals: JsonObject;

  constructor(store: StateStore | undefined, locals: JsonObject = empty) {
    this.#store = store;
    this.#locals = locals;
  }

  snapshot(): JsonObject {
    const values = this.#store?.snapshot() ?? empty;
    return this.#locals === empty ? values : merge(values, this.#locals);
  }

  resolve<T extends JsonValue>(input: BindingInput<T>): Result<T> {
    const plan = compileBinding(input.value, input.source);
    return plan.ok ? guard(plan.value.resolve(this.snapshot()), input) : plan;
  }

  observe<T extends JsonValue>(input: BindingInput<T>, listener: (result: Result<T>) => void): Disposable {
    const plan = compileBinding(input.value, input.source);
    if (!plan.ok) {
      listener(plan);
      return noop;
    }
    return this.#observe(plan.value.dependencies, () => listener(guard(plan.value.resolve(this.snapshot()), input)));
  }

  evaluate(expression: CompiledExpression): Result<JsonValue> {
    return this.expressions.evaluate(expression, this.snapshot());
  }

  observeExpression(expression: CompiledExpression, listener: (result: Result<JsonValue>) => void): Disposable {
    return this.#observe(expression.dependencies, () => listener(this.evaluate(expression)));
  }

  withLocals(values: JsonObject): BindingContext {
    return new Bindings(this.#store, merge(this.#locals, values));
  }

  #observe(dependencies: ReadonlySet<string>, notify: () => void): Disposable {
    const store = this.#store;
    if (!store || dependencies.size === 0) {
      notify();
      return noop;
    }
    const task = frameTask(() => { if (!disposedStores.has(store)) notify(); });
    const subscription = store.subscribe(dependencies, () => task.schedule());
    const observer = {
      dispose() {
        subscription.dispose();
        task.dispose();
      },
    };
    try {
      notify();
      return observer;
    } catch (error) {
      observer.dispose();
      throw error;
    }
  }
}

export const bindingFactory: BindingFactory = {
  create: store => new Bindings(store),
};
