import type { Disposable, JsonObject, JsonValue, Result, SourceLocation } from "./shared.ts";
import type { StateStore } from "./state.ts";

export interface ExpressionBudget {
  readonly maxLength: number;
  readonly maxDepth: number;
  readonly maxSteps: number;
}

export interface CompiledExpression {
  readonly source: string;
  readonly location: SourceLocation;
  /** Top-level free identifiers, excluding built-in functions and constants. */
  readonly dependencies: ReadonlySet<string>;
}

export interface ExpressionEngine {
  compile(source: string, location: SourceLocation, budget?: ExpressionBudget): Result<CompiledExpression>;
  evaluate(expression: CompiledExpression, values: JsonObject, budget?: ExpressionBudget): Result<JsonValue>;
}

export type ValueGuard<T extends JsonValue> = (value: JsonValue) => value is T;

export interface BindingInput<T extends JsonValue> {
  readonly value: JsonValue;
  readonly source: SourceLocation;
  readonly accepts: ValueGuard<T>;
  readonly expected: string;
}

export interface BindingContext {
  readonly expressions: ExpressionEngine;
  /** Current state/computed/data merged with read-only lexical locals. */
  snapshot(): JsonObject;
  /** Full interpolation preserves the result type. Mixed interpolation produces text. */
  resolve<T extends JsonValue>(input: BindingInput<T>): Result<T>;
  /** Delivers the initial result synchronously, then only when dependencies change. */
  observe<T extends JsonValue>(input: BindingInput<T>, listener: (result: Result<T>) => void): Disposable;
  evaluate(expression: CompiledExpression): Result<JsonValue>;
  observeExpression(expression: CompiledExpression, listener: (result: Result<JsonValue>) => void): Disposable;
  /** Creates a child view for repeat items or a chart sample environment. */
  withLocals(values: JsonObject): BindingContext;
}

export interface BindingFactory {
  create(store: StateStore | undefined): BindingContext;
}
