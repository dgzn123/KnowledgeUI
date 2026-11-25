import type { ExpressionEngine } from "./expression.ts";
import type { Disposable, JsonObject, JsonValue, Result, SourceLocation } from "./shared.ts";

export type StateValue = number | string | boolean;

interface StateMetadata {
  readonly label?: string;
}

export type StateDefinition =
  | (StateMetadata & {
      readonly type: "number";
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly unit?: string;
    })
  | (StateMetadata & { readonly type: "string"; readonly default: string })
  | (StateMetadata & { readonly type: "boolean"; readonly default: boolean });

export type StateDefinitions = Readonly<Record<string, StateDefinition>>;

export interface InteractiveModel {
  readonly state: StateDefinitions;
  readonly data: JsonObject;
  readonly computed: Readonly<Record<string, string>>;
}

export type StateAction =
  | { readonly type: "set"; readonly bind: string; readonly value: StateValue }
  | { readonly type: "reset"; readonly bind: string }
  | { readonly type: "toggle"; readonly bind: string }
  | { readonly type: "increment"; readonly bind: string; readonly by: number };

export interface StateChange {
  readonly changed: ReadonlySet<string>;
  readonly values: JsonObject;
}

export interface StateStore extends Disposable {
  readonly definitions: StateDefinitions;
  snapshot(): JsonObject;
  get(name: string): JsonValue | undefined;
  set(name: string, value: StateValue): Result<void>;
  dispatch(action: StateAction): Result<void>;
  subscribe(names: ReadonlySet<string>, listener: (change: StateChange) => void): Disposable;
}

export interface StateFactory {
  create(
    model: InteractiveModel,
    expressions: ExpressionEngine,
    source: SourceLocation,
    templateLocals?: JsonObject,
  ): Result<StateStore>;
}
