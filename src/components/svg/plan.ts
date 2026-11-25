import { V1_LIMITS } from "#contracts";
import type {
  BindingContext, ComponentNode, Diagnostic, ExtensionRegistry, FieldPath, JsonObject, JsonValue, Result, SymbolDefinition,
} from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../../core/protocol/index.ts";
import { Diagnostics, isArray } from "../../core/protocol/support.ts";
import { expand, hasBinding, isId, issue } from "./diagram.ts";
import type { Occurrence } from "./diagram.ts";
import { readViewBox } from "./geometry.ts";
import type { ViewBox } from "./geometry.ts";
import { elementFields } from "./values.ts";

interface LocalId {
  readonly kind: JsonValue | undefined;
  readonly index: number;
}

interface IdScope {
  readonly ids: Map<string, LocalId>;
  readonly parent?: IdScope;
}

export interface ElementPlan extends Occurrence {
  readonly scope: IdScope;
  readonly localId?: LocalId;
  readonly children: readonly ElementPlan[];
  readonly symbolBox?: ViewBox;
}

export interface SvgPlan {
  readonly viewBox: ViewBox;
  readonly elements: readonly ElementPlan[];
}

export function clipTarget(scope: IdScope | undefined, id: string): LocalId | undefined {
  while (scope) {
    const target = scope.ids.get(id);
    if (target) return target.kind === "clip" ? target : undefined;
    scope = scope.parent;
  }
  return undefined;
}

const staticSvgCatalog = createProtocolCatalog([v1ComponentSchema("svg")]);
if (!staticSvgCatalog.ok) throw new Error("Invalid SVG schema.");
// With no expression engine, the shared reader accepts the static symbol format.
const staticSvgReader = createProtocolReader({ catalog: staticSvgCatalog.value, yaml: yamlReader });
const noLocals = new Set<string>();

function readSymbol(definition: SymbolDefinition): Result<ComponentNode> {
  return staticSvgReader.readNode({
    value: { type: "svg", viewBox: definition.viewBox, elements: definition.elements },
    locate: () => undefined,
  }, { locals: noLocals });
}

export function planSvg(
  node: ComponentNode, extensions: ExtensionRegistry | undefined,
  runtime?: { readonly bindings?: BindingContext; report(diagnostic: Diagnostic): void },
): Result<SvgPlan> {
  const phase = runtime ? "render" : "semantic";
  const diagnostics = new Diagnostics();
  const report = (path: FieldPath, code: string, message: string) => diagnostics.add(issue(node, path, phase, code, message));
  const viewBox = readViewBox(node.props.viewBox);
  if (!viewBox) {
    report(["viewBox"], "svg-view-box", "A viewBox requires four finite coordinates and positive dimensions.");
    return { ok: false, diagnostics: diagnostics.list() };
  }

  const references: { path: FieldPath; scope: IdScope; id: string }[] = [];
  const symbols = new Map<string, Result<ComponentNode> | undefined>();
  const checked = new Set<JsonObject>();
  let count = 0;
  let exhausted = false;

  function visit(
    elements: readonly JsonObject[], path: FieldPath, scope: IdScope, depth: number,
    ancestry: readonly string[], bindings?: BindingContext, clipGeometry = false,
  ): ElementPlan[] {
    const result: ElementPlan[] = [];
    for (const [index, value] of elements.entries()) {
      if (exhausted) break;
      const field = [...path, index];
      // Native clipPath accepts geometry directly. Groups and nested symbol
      // viewports would otherwise yield an empty clipping area in Chromium.
      if (clipGeometry && (value.kind === "group" || value.kind === "use-symbol" || value.kind === "clip")) {
        report([...field, "kind"], "svg-clip-geometry", "A clip requires direct shape or text geometry.");
        continue;
      }
      if (!checked.has(value)) {
        checked.add(value);
        elementFields(value, (key, raw, accepts, expected) => {
          if (!hasBinding(raw) && !accepts(raw)) report([...field, ...key], "svg-value", "Expected " + expected + ".");
        });
      }
      const occurrences = runtime ? expand(node, value, field, bindings, runtime.report)
        : [{ value, path: field, bindings: undefined, condition: undefined }];

      for (const occurrence of occurrences) {
        if (depth > V1_LIMITS.componentDepth || count >= V1_LIMITS.svgElements) {
          const tooDeep = depth > V1_LIMITS.componentDepth;
          report(field, tooDeep ? "svg-depth-limit" : "svg-element-limit", tooDeep
            ? `SVG elements may nest at most ${V1_LIMITS.componentDepth} levels.`
            : `An SVG may expand to at most ${V1_LIMITS.svgElements} elements.`);
          exhausted = true;
          break;
        }
        const occurrenceIndex = ++count;
        const local = value.repeat !== undefined ? { ids: new Map<string, LocalId>(), parent: scope } : scope;
        let localId: LocalId | undefined;
        const id = value.id ?? null;
        if (isId(id)) {
          localId = { index: occurrenceIndex, kind: value.kind };
          if (local.ids.has(id)) report([...field, "id"], "svg-duplicate-id", `Duplicate SVG ID "${id}" in this scope.`);
          else local.ids.set(id, localId);
        }
        const clip = value.clip ?? null;
        if (isId(clip)) references.push({ path: [...field, "clip"], scope: local, id: clip });

        let children: ElementPlan[] = [];
        let symbolBox: ViewBox | undefined;
        if (value.kind === "use-symbol" && typeof value.symbol === "string") {
          const id = value.symbol;
          const symbolPath = [...field, "symbol"];
          if (ancestry.includes(id)) {
            report(symbolPath, "svg-symbol-cycle", `Recursive SVG symbol "${id}".`);
          } else {
            if (!symbols.has(id)) {
              const definition = extensions?.symbol(id);
              symbols.set(id, definition ? readSymbol(definition) : undefined);
            }
            const symbol = symbols.get(id);
            if (!symbol) {
              report(symbolPath, "svg-symbol-missing", `SVG symbol "${id}" is unavailable.`);
            } else if (!symbol.ok) {
              for (const diagnostic of symbol.diagnostics) {
                report([...symbolPath, ...diagnostic.path], "svg-symbol-invalid", `Symbol "${id}": ${diagnostic.message}`);
              }
            } else {
              symbolBox = readViewBox(symbol.value.props.viewBox);
              if (!symbolBox) report([...symbolPath, "viewBox"], "svg-view-box", `Symbol "${id}" requires a finite, positive viewBox.`);
              children = visit(symbol.value.props.elements as readonly JsonObject[], [...symbolPath, "elements"],
                { ids: new Map() }, depth + 1, [...ancestry, id]);
            }
          }
        } else if (isArray(value.elements)) {
          children = visit(value.elements as readonly JsonObject[], [...field, "elements"],
            local, depth + 1, ancestry, occurrence.bindings, value.kind === "clip");
        }
        result.push({ ...occurrence, scope: local, ...(localId && { localId }), children, ...(symbolBox && { symbolBox }) });
        if (exhausted) break;
      }
    }
    return result;
  }

  const elements = visit(node.props.elements as readonly JsonObject[], ["elements"], { ids: new Map() }, 1, [], runtime?.bindings);
  if (!exhausted) {
    for (const { path, scope, id } of references) {
      if (!clipTarget(scope, id)) report(path, "svg-clip-target", `SVG clip "${id}" is not defined in this scope.`);
    }
  }
  return diagnostics.finish({ viewBox, elements });
}
