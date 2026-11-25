import { V1_LIMITS } from "#contracts";
import type {
  CompiledExpression, ExpressionEngine, FieldPath, InteractiveModel, JsonObject, JsonValue, Repeat,
  SourceRange, StateDefinitions,
} from "#contracts";
import type { Annotation } from "./schema.ts";
import { Diagnostics, isArray, isObject, isReservedKey, own, pointer, record } from "./support.ts";

export interface Scope {
  readonly names: ReadonlySet<string>;
  readonly readOnly: ReadonlySet<string>;
  readonly state: StateDefinitions;
}

export const noState: StateDefinitions = Object.freeze(record<never>());

const builtIns = new Set([
  "PI", "E", "true", "false", "null", "abs", "sqrt", "pow", "exp", "ln", "log10", "sin", "cos", "tan",
  "asin", "acos", "atan", "min", "max", "clamp", "round", "floor", "ceil", "len", "fmt",
]);
const budget = {
  maxLength: V1_LIMITS.expressionLength, maxDepth: V1_LIMITS.expressionDepth, maxSteps: V1_LIMITS.expressionSteps,
};

function reserved(name: string): boolean {
  return isReservedKey(name) || builtIns.has(name);
}

/** Returns expressions inside binding delimiters, with quoted delimiters ignored. */
function interpolation(value: string): { segments: string[]; unclosed: boolean } {
  const segments: string[] = [];
  let start = value.indexOf("{{");
  while (start !== -1) {
    if (value[start - 1] === "\\") {
      start = value.indexOf("{{", start + 2);
      continue;
    }
    let quote: string | undefined;
    let closed = false;
    for (let end = start + 2; end < value.length; end++) {
      const char = value[end];
      if (quote) {
        if (char === quote) quote = undefined;
        else if (char === "\\") end++;
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === "}" && value[end + 1] === "}") {
        segments.push(value.slice(start + 2, end));
        start = value.indexOf("{{", end + 2);
        closed = true;
        break;
      }
    }
    if (!closed) return { segments, unclosed: true };
  }
  return { segments, unclosed: false };
}

export class DynamicReader {
  private readonly engine: ExpressionEngine | undefined;
  private readonly diagnostics: Diagnostics;
  private readonly locate: (path: FieldPath) => SourceRange | undefined;

  constructor(
    engine: ExpressionEngine | undefined,
    diagnostics: Diagnostics,
    locate: (path: FieldPath) => SourceRange | undefined,
  ) {
    this.engine = engine;
    this.diagnostics = diagnostics;
    this.locate = locate;
  }

  unavailable(path: FieldPath): void {
    this.diagnostics.report("semantic", "semantic.capability-unavailable", path, "Dynamic features require the expression service.");
  }

  compile(value: string, path: FieldPath, allowed: ReadonlySet<string>): CompiledExpression | undefined {
    if (!this.engine) {
      this.unavailable(path);
      return;
    }
    if (value.length > budget.maxLength) {
      this.diagnostics.report("expression", "expression.length-limit", path, `Expressions may contain at most ${budget.maxLength} characters.`);
      return;
    }
    if (!value.trim() || value.trim() === "...") {
      this.diagnostics.report("expression", "expression.invalid-source", path, "Expected a complete expression.");
      return;
    }
    const range = this.locate(path);
    const result = this.engine.compile(value, { path, ...(range && { range }) }, budget);
    for (const diagnostic of result.diagnostics) this.diagnostics.add(diagnostic);
    if (!result.ok) return;

    for (const name of result.value.dependencies) {
      if (!allowed.has(name)) {
        this.diagnostics.report("semantic", "semantic.unknown-identifier", path, `Identifier ${JSON.stringify(name)} is unavailable in this scope.`);
      }
    }
    return result.value;
  }

  repeat(value: JsonValue | undefined, path: FieldPath, outer: Scope): { scope: Scope; repeat?: Repeat } {
    if (!isObject(value) || typeof value.items !== "string" || typeof value.as !== "string") return { scope: outer };
    if (!this.engine) {
      this.unavailable(path);
      return { scope: outer };
    }
    const names = new Set(outer.names);
    const readOnly = new Set(outer.readOnly);
    const alias = value.as;
    const index = typeof value.index === "string" ? value.index : undefined;
    const declare = (name: string, field: string) => {
      if (names.has(name) || reserved(name)) {
        this.diagnostics.report("semantic", "semantic.name-conflict", [...path, field], `Name ${JSON.stringify(name)} is already reserved or declared.`);
      } else {
        names.add(name);
        readOnly.add(name);
      }
    };
    declare(alias, "as");
    if (index !== undefined) declare(index, "index");
    const items = this.compile(value.items, [...path, "items"], outer.readOnly);
    const scope = { names, readOnly, state: outer.state };
    return items ? { scope, repeat: { items, as: alias, ...(index !== undefined && { index }) } } : { scope };
  }

  model(value: JsonObject, path: FieldPath, locals: ReadonlySet<string>): { model: InteractiveModel; scope: Scope } {
    // The component schema has already checked every definition and computed value.
    const state = (value.state ?? noState) as StateDefinitions;
    const data = (value.data ?? record<JsonValue>()) as JsonObject;
    const computed = (value.computed ?? record<string>()) as InteractiveModel["computed"];
    const names = new Set(locals);
    const readOnly = new Set(locals);
    for (const [group, entries] of [["state", state], ["data", data], ["computed", computed]] as const) {
      for (const name of Object.keys(entries)) {
        if (reserved(name) || names.has(name)) {
          this.diagnostics.report("semantic", "semantic.name-conflict", [...path, group, name], `Name ${JSON.stringify(name)} is already reserved or declared.`);
        } else {
          names.add(name);
          if (group === "data") readOnly.add(name);
        }
      }
    }
    if (this.engine) {
      const graph = new Map<string, ReadonlySet<string>>();
      for (const [name, source] of Object.entries(computed)) {
        const compiled = this.compile(source, [...path, "computed", name], names);
        if (compiled) graph.set(name, compiled.dependencies);
      }
      this.checkCycles(graph, path);
    }
    return { model: { state, data, computed }, scope: { names, readOnly, state } };
  }

  private checkCycles(graph: ReadonlyMap<string, ReadonlySet<string>>, path: FieldPath): void {
    const complete = new Set<string>();
    const active = new Set<string>();
    // An iterative traversal also handles long acyclic dependency chains.
    for (const name of graph.keys()) {
      if (complete.has(name)) continue;
      const pending = [{ name, dependencies: graph.get(name)!.values() }];
      active.add(name);
      while (pending.length > 0) {
        const current = pending[pending.length - 1]!;
        const next = current.dependencies.next();
        if (next.done) {
          pending.pop();
          active.delete(current.name);
          complete.add(current.name);
        } else if (active.has(next.value)) {
          this.diagnostics.report("semantic", "semantic.computed-cycle", [...path, "computed", current.name],
            `Computed variable ${JSON.stringify(current.name)} depends on an active variable ${JSON.stringify(next.value)}.`);
        } else {
          const dependencies = graph.get(next.value);
          if (dependencies && !complete.has(next.value)) {
            active.add(next.value);
            pending.push({ name: next.value, dependencies: dependencies.values() });
          }
        }
      }
    }
  }

  props(type: string, props: JsonObject, path: FieldPath, annotations: readonly Annotation[], outer: Scope): Record<string, CompiledExpression> {
    const expressions = record<CompiledExpression>();
    const fields = new Map(annotations.map(annotation => [pointer(annotation.path), annotation.kind]));
    const visit = (value: JsonValue, relative: FieldPath, scope: Scope) => {
      const location = [...path, ...relative];
      const kind = fields.get(pointer(location));
      if (typeof value === "string") {
        if (kind === "binding") this.binding(value, location, scope.names);
        if (kind === "expression") {
          let names = scope.names;
          if (type === "chart" && relative.length === 3 && relative[0] === "series" && relative[2] === "expr") {
            if (names.has("x")) {
              this.diagnostics.report("semantic", "semantic.name-conflict", location, 'The function series reserves the name "x".');
            }
            names = new Set([...names, "x"]);
          }
          const compiled = this.compile(value, location, names);
          if (compiled) expressions[pointer(relative)] = compiled;
        }
      } else if (isObject(value)) {
        const repeat = own(value, "repeat");
        const hasRepeat = repeat !== undefined && fields.get(pointer([...location, "repeat", "items"])) === "expression";
        if (hasRepeat) {
          const repeated = this.repeat(repeat, [...location, "repeat"], scope);
          if (repeated.repeat) expressions[pointer([...relative, "repeat", "items"])] = repeated.repeat.items;
          scope = repeated.scope;
        }
        for (const [key, child] of Object.entries(value)) {
          if (key !== "repeat" || !hasRepeat) {
            visit(child, [...relative, key], scope);
          }
        }
      } else if (isArray(value)) {
        for (const [index, child] of value.entries()) visit(child, [...relative, index], scope);
      }
    };
    visit(props, [], outer);
    return expressions;
  }

  private binding(value: string, path: FieldPath, names: ReadonlySet<string>): void {
    if (!value.includes("{{")) return;
    const { segments, unclosed } = interpolation(value);
    if (!this.engine && (segments.length > 0 || unclosed)) {
      this.unavailable(path);
      return;
    }
    if (unclosed) this.diagnostics.report("expression", "expression.unclosed-binding", path, "Binding is missing its closing delimiter.");
    for (const segment of segments) this.compile(segment, path, names);
  }
}
