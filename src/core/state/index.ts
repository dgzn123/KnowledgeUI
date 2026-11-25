import { V1_LIMITS } from "#contracts";
import type {
  CompiledExpression, Disposable, ExpressionEngine, FieldPath, InteractiveModel, JsonObject, JsonValue, Result,
  SourceLocation, StateAction, StateChange, StateDefinition, StateDefinitions, StateFactory, StateStore, StateValue,
} from "#contracts";
import { isReservedKey, record } from "../protocol/support.ts";
import { isReservedName } from "../expression/engine.ts";
import { actionIssue, actionValue, definitionIssue, ownData, readAction, valueIssue } from "./constraints.ts";
import { disposedStores } from "./disposal.ts";

const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function success<T>(value: T): Result<T> {
  return { ok: true, value, diagnostics: [] };
}

function failure(source: SourceLocation, code: string, message: string, field: FieldPath = []): Result<never> {
  return {
    ok: false,
    diagnostics: [{ ...source, path: [...source.path, ...field], code: "state." + code, message,
      phase: "state", severity: "error" }],
  };
}

function readOnlyData(input: unknown, source: SourceLocation, field: FieldPath): Result<JsonValue> {
  const active = new Set<object>();
  let nodes = 0;

  function visit(value: unknown, path: FieldPath, depth: number): Result<JsonValue> {
    if (++nodes > V1_LIMITS.yamlNodes || depth > V1_LIMITS.yamlDepth) {
      return failure(source, "data-limit", "Read-only data exceeds the structural value budget.", path);
    }
    if (value === null || typeof value === "string" || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))) return success(value);

    if (value === null || typeof value !== "object" || active.has(value)) {
      return failure(source, "invalid-data", "Expected acyclic JSON-compatible data.", path);
    }
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (!array && prototype !== null && prototype !== Object.prototype) {
      return failure(source, "invalid-data", "Expected a plain data object.", path);
    }

    active.add(value);
    const list: JsonValue[] = [];
    const mapping = record<JsonValue>();
    const fields = value as Readonly<Record<string, unknown>>;
    const put = (key: string | number): Result<void> => {
      const entry = ownData(fields, String(key));
      const next = [...path, key];
      if (entry === undefined || (typeof key === "string" && (isReservedKey(key) || key === "<<"))) {
        return failure(source, "invalid-data", "Expected a safe, own data property.", next);
      }
      const nested = visit(entry, next, depth + 1);
      if (!nested.ok) return nested;
      if (typeof key === "number") list.push(nested.value);
      else mapping[key] = nested.value;
      return success(undefined);
    };
    if (array) {
      if (value.length > V1_LIMITS.yamlNodes) return failure(source, "data-limit", "Too many array items.", path);
      for (let index = 0; index < value.length; index++) {
        const item = put(index);
        if (!item.ok) return item;
      }
    } else {
      for (const key of Object.keys(value)) {
        const item = put(key);
        if (!item.ok) return item;
      }
    }
    active.delete(value);
    return success(array ? Object.freeze(list) : Object.freeze(mapping));
  }
  return visit(input, field, 1);
}

interface Computation {
  readonly name: string;
  readonly expression: CompiledExpression;
  readonly dependencies: ReadonlySet<string>;
}

function computations(model: InteractiveModel, names: ReadonlySet<string>, engine: ExpressionEngine, source: SourceLocation) {
  const byName = new Map<string, Computation>();
  const dependents = new Map<string, Computation[]>();
  const incoming = new Map<string, number>();
  for (const name of Object.keys(model.computed)) {
    const path = [...source.path, "computed", name];
    const input = ownData(model.computed, name);
    if (typeof input !== "string") return failure(source, "computed-source", "Expected an expression string.", ["computed", name]);
    const result = engine.compile(input, { ...source, path });
    if (!result.ok) return result;
    const dependencies = result.value.dependencies;
    const computation = { name, expression: result.value, dependencies };
    byName.set(name, computation);
    let count = 0;
    for (const dependency of dependencies) {
      if (!names.has(dependency)) {
        return failure(source, "unknown-identifier", "Undeclared identifier " + JSON.stringify(dependency) + ".", ["computed", name]);
      }
      if (Object.hasOwn(model.computed, dependency)) count++;
      const children = dependents.get(dependency);
      if (children) children.push(computation);
      else dependents.set(dependency, [computation]);
    }
    incoming.set(name, count);
  }

  const ordered = [...byName.values()].filter(item => incoming.get(item.name) === 0);
  for (const item of ordered) {
    for (const user of dependents.get(item.name) ?? []) {
      const count = incoming.get(user.name)! - 1;
      incoming.set(user.name, count);
      if (count === 0) ordered.push(user);
    }
  }
  if (ordered.length !== byName.size) {
    const blocked = [...incoming].find(([, count]) => count > 0)![0];
    return failure(source, "computed-cycle", "Computed dependencies contain a cycle.", ["computed", blocked]);
  }
  return success({ ordered, dependents });
}

type Graph = { readonly ordered: readonly Computation[]; readonly dependents: ReadonlyMap<string, readonly Computation[]> };
type Listener = (change: StateChange) => void;

interface Subscription {
  readonly notify: Listener;
  readonly names: ReadonlySet<string>;
  active: boolean;
}

class Store implements StateStore {
  readonly definitions: StateDefinitions;
  readonly #graph: Graph;
  readonly #engine: ExpressionEngine;
  readonly #source: SourceLocation;
  #values: JsonObject;
  #byName = new Map<string, Set<Subscription>>();
  #pending: { readonly change: StateChange; readonly listeners: ReadonlySet<Subscription> }[] = [];
  #publishing = false;
  readonly #position: ReadonlyMap<Computation, number>;

  constructor(
    definitions: StateDefinitions, values: JsonObject, graph: Graph, engine: ExpressionEngine, source: SourceLocation,
  ) {
    this.definitions = definitions;
    this.#graph = graph;
    this.#engine = engine;
    this.#source = source;
    this.#values = Object.freeze(values);
    this.#position = new Map(graph.ordered.map((item, index) => [item, index]));
  }

  snapshot(): JsonObject {
    return this.#values;
  }

  get(name: string): JsonValue | undefined {
    return ownData(this.#values, name);
  }

  set(name: string, value: StateValue): Result<void> {
    if (disposedStores.has(this)) return failure(this.#source, "disposed", "This state scope has been disposed.");
    const definition = ownData(this.definitions, name);
    if (!definition) return failure(this.#source, "unknown-binding", "Expected a writable state name.", ["state", name]);
    const invalid = valueIssue(definition, value);
    if (invalid) return failure(this.#source, "invalid-value", invalid, ["state", name]);
    if (this.get(name) === value) return success(undefined);

    const next = Object.assign(record<JsonValue>(), this.#values);
    const changed = new Set([name]);
    next[name] = value;
    const affected = new Set(this.#graph.dependents.get(name));
    for (const item of affected) {
      for (const child of this.#graph.dependents.get(item.name) ?? []) affected.add(child);
    }
    const ordered = [...affected].sort((a, b) => this.#position.get(a)! - this.#position.get(b)!);
    for (const item of ordered) {
      if (![...item.dependencies].some(dependency => changed.has(dependency))) continue;
      const computed = this.#engine.evaluate(item.expression, next);
      if (!computed.ok) return computed;
      if (next[item.name] !== computed.value) {
        next[item.name] = computed.value;
        changed.add(item.name);
      }
    }

    this.#values = Object.freeze(next);
    this.#publish({ changed, values: this.#values });
    return success(undefined);
  }

  dispatch(input: StateAction): Result<void> {
    if (disposedStores.has(this)) return failure(this.#source, "disposed", "This state scope has been disposed.");
    const action = readAction(input);
    if (!action) return failure(this.#source, "invalid-action", "Expected a declared state action.");
    const definition = ownData(this.definitions, action.bind);
    if (!definition) return failure(this.#source, "unknown-binding", "Expected a writable state name.", ["state", action.bind]);
    const issue = actionIssue(definition, action);
    if (issue) return failure(this.#source, "invalid-action", issue.message, ["state", action.bind]);
    return this.set(action.bind, actionValue(definition, this.get(action.bind) as StateValue, action));
  }

  subscribe(names: ReadonlySet<string>, notify: Listener): Disposable {
    if (disposedStores.has(this)) return { dispose() {} };
    const entry = { notify, names: new Set(names), active: true };
    for (const name of entry.names) {
      const listeners = this.#byName.get(name);
      if (listeners) listeners.add(entry);
      else this.#byName.set(name, new Set([entry]));
    }
    return {
      dispose: () => {
        entry.active = false;
        for (const name of entry.names) {
          const listeners = this.#byName.get(name);
          listeners?.delete(entry);
          if (listeners?.size === 0) this.#byName.delete(name);
        }
      },
    };
  }

  dispose(): void {
    disposedStores.add(this);
    this.#byName.clear();
    this.#pending.length = 0;
  }

  #publish(change: StateChange): void {
    const listeners = new Set<Subscription>();
    for (const name of change.changed) {
      for (const entry of this.#byName.get(name) ?? []) listeners.add(entry);
    }
    this.#pending.push({ change, listeners });
    if (this.#publishing) return;
    this.#publishing = true;
    try {
      for (const pending of this.#pending) {
        for (const entry of pending.listeners) {
          if (disposedStores.has(this)) return;
          if (!entry.active) continue;
          try {
            entry.notify({ changed: new Set(pending.change.changed), values: pending.change.values });
          } catch (error) {
            globalThis.reportError?.(error);
          }
        }
      }
    } finally {
      this.#pending.length = 0;
      this.#publishing = false;
    }
  }
}

export const stateFactory: StateFactory = {
  create(model, engine, source, templateLocals = {}) {
    const values = record<JsonValue>();
    const definitions = record<StateDefinition>();
    const names = new Set<string>();
    for (const [group, entries] of [["locals", templateLocals], ["state", model.state],
      ["data", model.data], ["computed", model.computed]] as const) {
      for (const name of Object.keys(entries)) {
        if (!identifier.test(name) || isReservedKey(name) || isReservedName(name) || names.has(name)) {
          return failure(source, "name-conflict", "Reserved, invalid or duplicate name " + JSON.stringify(name) + ".", [group, name]);
        }
        names.add(name);
      }
    }

    for (const [group, data] of [["data", model.data], ["locals", templateLocals]] as const) {
      const copy = readOnlyData(data, source, [group]);
      if (!copy.ok) return copy;
      Object.assign(values, copy.value);
    }
    for (const name of Object.keys(model.state)) {
      const copy = readOnlyData(ownData(model.state, name), source, ["state", name]);
      if (!copy.ok) return copy;
      const definition = copy.value as unknown as StateDefinition | null;
      if (!definition || !["number", "string", "boolean"].includes(definition.type)) {
        return failure(source, "definition", "Expected a supported scalar state definition.", ["state", name]);
      }
      const issue = definitionIssue(definition);
      if (issue) return failure(source, "definition", issue.message, ["state", name, issue.field]);
      definitions[name] = definition;
      values[name] = definition.default;
    }
    const graph = computations(model, names, engine, source);
    if (!graph.ok) return graph;
    for (const item of graph.value.ordered) {
      const initial = engine.evaluate(item.expression, values);
      if (!initial.ok) return initial;
      values[item.name] = initial.value;
    }
    return success(new Store(Object.freeze(definitions), values, graph.value, engine, source));
  },
};
