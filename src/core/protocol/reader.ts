import { PROTOCOL_VERSION, V1_LIMITS } from "#contracts";
import type {
  ComponentNode, FieldPath, JsonObject, JsonValue, ProtocolDependencies, ProtocolReader, ProtocolValues, Result,
} from "#contracts";
import { v1Components } from "#protocol-schema";
import { DynamicReader, noState } from "./dynamic.ts";
import type { Scope } from "./dynamic.ts";
import { SchemaReader } from "./schema.ts";
import type { Annotation } from "./schema.ts";
import { Diagnostics, isArray, isObject, isReservedKey, own, pointer, record } from "./support.ts";

const knownTypes = new Set<string>(v1Components.map(component => component.type));
const controls = new Set(["slider", "number-input", "select", "toggle", "button", "stepper", "quiz"]);

function sourceDiagnostics(values: ProtocolValues, sourceId: string | undefined): Diagnostics {
  return new Diagnostics(sourceId, path => {
    for (let depth = path.length; depth >= 0; depth--) {
      const range = values.locate(path.slice(0, depth));
      if (range) return range;
    }
    return undefined;
  });
}

/** Applies the same JSON and structural boundaries to programmatic template bodies. */
function copyTemplate(value: JsonValue, diagnostics: Diagnostics): JsonValue {
  const ancestors = new Set<object>();
  let count = 0;
  let exhausted = false;
  function visit(input: JsonValue, path: FieldPath, depth: number): JsonValue {
    if (exhausted) return null;
    if (depth > V1_LIMITS.yamlDepth || ++count > V1_LIMITS.yamlNodes) {
      diagnostics.report("schema", "schema.value-limit", path, "Template body exceeds the structural value budget.");
      exhausted = true;
      return null;
    }
    if (input === null || typeof input === "boolean" || typeof input === "string"
      || (typeof input === "number" && Number.isFinite(input))) return input;

    if (isObject(input) || isArray(input)) {
      const array = isArray(input);
      const prototype = Object.getPrototypeOf(input);
      if (!ancestors.has(input) && (array || prototype === null || prototype === Object.prototype)) {
        ancestors.add(input);
        const copy = array ? [] as JsonValue[] : record<JsonValue>();
        const put = (key: string | number) => {
          const field = [...path, key];
          const entry = Object.getOwnPropertyDescriptor(input, key);
          if (!entry || !("value" in entry) || (typeof key === "string" && (isReservedKey(key) || key === "<<"))) {
            diagnostics.report("schema", "schema.invalid-data", field, "Expected a safe, own data property.");
            return;
          }
          if (!array && ++count > V1_LIMITS.yamlNodes) {
            diagnostics.report("schema", "schema.value-limit", field, "Template body exceeds the structural value budget.");
            exhausted = true;
            return;
          }
          const child = visit(entry.value as JsonValue, field, depth + 1);
          if (Array.isArray(copy)) copy.push(child);
          else copy[key] = child;
        };
        if (array) {
          if (input.length > V1_LIMITS.yamlNodes) {
            diagnostics.report("schema", "schema.value-limit", path, "Template body exceeds the structural value budget.");
            exhausted = true;
          }
          for (let index = 0; index < input.length && !exhausted; index++) put(index);
        } else {
          for (const key of Object.keys(input)) {
            put(key);
            if (exhausted) break;
          }
        }
        ancestors.delete(input);
        return copy;
      }
    }
    diagnostics.report("schema", "schema.invalid-data", path, "Expected an acyclic, JSON-compatible value.");
    return null;
  }
  return visit(value, [], 1);
}

function componentProps(value: JsonObject, path: FieldPath, annotations: readonly Annotation[]): JsonObject {
  const omitted = new Set(["type", "ariaLabel", "when", "repeat"].map(key => pointer([...path, key])));
  if (value.type === "interactive") {
    for (const key of ["state", "data", "computed"]) omitted.add(pointer([...path, key]));
  }
  const containers = new Set<string>([pointer(path)]);
  for (const annotation of annotations) {
    if (annotation.kind === "single" || annotation.kind === "list") {
      omitted.add(pointer(annotation.path));
      for (let index = path.length + 1; index < annotation.path.length; index++) {
        containers.add(pointer(annotation.path.slice(0, index)));
      }
    }
  }
  function copy(input: JsonValue, field: FieldPath): JsonValue {
    if (!containers.has(pointer(field))) return input;
    if (isArray(input)) return input.map((item, index) => copy(item, [...field, index]));
    if (!isObject(input)) return input;
    const props = record<JsonValue>();
    for (const [key, child] of Object.entries(input)) {
      const nestedPath = [...field, key];
      if (!omitted.has(pointer(nestedPath))) props[key] = copy(child, nestedPath);
    }
    return props;
  }
  return copy(value, path) as JsonObject;
}

function nodeResult(node: ComponentNode | undefined, diagnostics: Diagnostics): Result<ComponentNode> {
  if (!node) return { ok: false, diagnostics: diagnostics.list() };
  return diagnostics.finish(node);
}

export function createProtocolReader(dependencies: ProtocolDependencies): ProtocolReader {
  const definitions = own(dependencies.catalog.schema, "$defs");
  const structure = new SchemaReader(isObject(definitions) ? definitions : undefined);

  function readRoot(
    values: ProtocolValues, diagnostics: Diagnostics, templateLocals: ReadonlySet<string>,
  ): ComponentNode | undefined {
    const dynamic = new DynamicReader(dependencies.expressions, diagnostics, values.locate);
    let instances = 0;
    let countReported = false;

    function normalize(value: JsonValue, path: FieldPath, depth: number, outer: Scope): ComponentNode | undefined {
      if (++instances > V1_LIMITS.componentInstances) {
        if (!countReported) {
          diagnostics.report("schema", "schema.component-count-limit", path, `Only ${V1_LIMITS.componentInstances} components are allowed per block.`);
          countReported = true;
        }
        return;
      }
      if (depth > V1_LIMITS.componentDepth) {
        diagnostics.report("schema", "schema.component-depth-limit", path, `Components may nest at most ${V1_LIMITS.componentDepth} levels.`);
        return;
      }
      if (!isObject(value)) {
        diagnostics.report("schema", "schema.type", path, "Expected a component mapping.");
        return;
      }
      const type = own(value, "type");
      const typePath = [...path, "type"];
      if (typeof type !== "string") {
        diagnostics.report("schema", type === undefined ? "schema.required" : "schema.type", typePath, "Expected a component type string.");
        return;
      }
      const definition = dependencies.catalog.components.get(type);
      if (!definition) {
        const known = knownTypes.has(type);
        diagnostics.report("schema", known ? "schema.component-unavailable" : "schema.unknown-type", typePath,
          `Component type ${JSON.stringify(type)} is ${known ? "not enabled" : "unknown"}.`);
        return;
      }

      const startErrors = diagnostics.errorCount;
      const annotations: Annotation[] = [];
      structure.read(definition.schema, value, path, diagnostics, annotations);
      const validShape = diagnostics.errorCount === startErrors;
      const repeated = validShape ? dynamic.repeat(own(value, "repeat"), [...path, "repeat"], outer) : { scope: outer };
      const condition = own(value, "when");
      const when = validShape && typeof condition === "string" ? dynamic.compile(condition, [...path, "when"], repeated.scope.names) : undefined;
      if (validShape && !dependencies.expressions && (type === "interactive" || controls.has(type))) dynamic.unavailable(typePath);
      const interactive = validShape && type === "interactive" ? dynamic.model(value, path, templateLocals) : undefined;
      const scope = interactive?.scope ?? repeated.scope;

      const slots = record<readonly ComponentNode[]>();
      for (const annotation of annotations) {
        if (annotation.kind !== "single" && annotation.kind !== "list") continue;
        const children: ComponentNode[] = [];
        const append = (child: JsonValue, childPath: FieldPath) => {
          const node = normalize(child, childPath, depth + 1, scope);
          if (node) children.push(node);
        };
        if (annotation.kind === "list" && isArray(annotation.value)) {
          for (const [index, child] of annotation.value.entries()) {
            append(child, [...annotation.path, index]);
            if (countReported) break;
          }
        } else {
          append(annotation.value, annotation.path);
        }
        slots[pointer(annotation.path.slice(path.length))] = children;
        if (countReported) break;
      }
      if (!validShape || countReported) return;

      const range = values.locate(path);
      const ariaLabel = own(value, "ariaLabel");
      const props = componentProps(value, path, annotations);
      const node: ComponentNode = {
        type,
        source: { path, ...(range && { range }) },
        props,
        expressions: dynamic.props(type, props, path, annotations, scope),
        locate: relative => values.locate([...path, ...relative]),
        slots,
        ...(typeof ariaLabel === "string" && { ariaLabel }),
        ...(repeated.repeat && { repeat: repeated.repeat }),
        ...(when && { when }),
        ...(interactive && { model: interactive.model }),
      };

      if (definition.validate && diagnostics.errorCount === startErrors) {
        const { sourceId } = diagnostics;
        const { extensions } = dependencies;
        try {
          for (const diagnostic of definition.validate({
            node, state: scope.state, ...(sourceId !== undefined && { sourceId }), ...(extensions && { extensions }),
          })) diagnostics.add(diagnostic);
        } catch {
          diagnostics.report("semantic", "semantic.validator-failed", path, `The validator for ${JSON.stringify(type)} failed.`);
        }
      }
      return node;
    }

    return normalize(values.value, [], 1, { names: templateLocals, readOnly: templateLocals, state: noState });
  }

  return {
    read(source) {
      const yaml = dependencies.yaml.read(source);
      if (!yaml.ok) return yaml;
      const diagnostics = sourceDiagnostics(yaml.value, source.sourceId);
      yaml.diagnostics.forEach(diagnostic => diagnostics.add(diagnostic));
      let value = yaml.value.value;
      if (isObject(value)) {
        const version = own(value, "version");
        if (version === undefined) {
          diagnostics.report("schema", "schema.version-defaulted", ["version"], "Missing version. Using Protocol v1.", undefined, "warning");
        } else if (version !== PROTOCOL_VERSION) {
          diagnostics.report("schema", "schema.unsupported-version", ["version"], "Expected Protocol version 1.");
          return { ok: false, diagnostics: diagnostics.list() };
        }
        const fields = record<JsonValue>();
        for (const [key, field] of Object.entries(value)) {
          if (key !== "version") fields[key] = field;
        }
        value = fields;
      }
      const node = readRoot({ ...yaml.value, value }, diagnostics, new Set());
      if (!node) return { ok: false, diagnostics: diagnostics.list() };
      return diagnostics.finish({ version: PROTOCOL_VERSION, root: node });
    },

    readNode(input, scope) {
      const diagnostics = sourceDiagnostics(input, scope.sourceId);
      const value = copyTemplate(input.value, diagnostics);
      if (diagnostics.errorCount) return { ok: false, diagnostics: diagnostics.list() };
      return nodeResult(readRoot({ ...input, value }, diagnostics, scope.locals), diagnostics);
    },
  };
}
