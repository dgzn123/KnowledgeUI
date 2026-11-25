import { PROTOCOL_VERSION, V1_LIMITS } from "#contracts";
import type {
  Diagnostic, ExtensionPackage, ExtensionRegistrar, FieldPath, JsonObject, JsonValue, TemplateParameter,
} from "#contracts";
import { identifier, qualifiedName } from "../../contracts/schema/fields.ts";
import { isReservedName } from "../expression/engine.ts";
import { isArray, isObject, isReservedKey, record } from "../protocol/support.ts";

const idPattern = new RegExp(qualifiedName.pattern);
const parameterPattern = new RegExp(identifier.pattern);
const semver = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

class DeclarationError extends Error {
  readonly code: string;
  readonly path: FieldPath;

  constructor(code: string, path: FieldPath, message: string) {
    super(message);
    this.code = code;
    this.path = path;
  }
}

function reject(code: string, path: FieldPath, message: string): never {
  throw new DeclarationError("extension." + code, path, message);
}

/** Copy declarations before publishing them. Reading properties never invokes accessors. */
function snapshot(input: unknown): JsonValue {
  let count = 0;
  const active = new Set<object>();

  function copy(value: unknown, path: FieldPath, depth: number): JsonValue {
    if (++count > V1_LIMITS.yamlNodes || depth > V1_LIMITS.yamlDepth) {
      reject("declaration-limit", path, "Extension declarations exceed the structural value budget.");
    }
    if (value === null || typeof value === "boolean" || typeof value === "string"
      || (typeof value === "number" && Number.isFinite(value))) return value;
    if (typeof value !== "object" || active.has(value)) {
      reject("invalid-data", path, "Extension declarations must be acyclic JSON data.");
    }

    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      || Object.getOwnPropertySymbols(value).length) {
      reject("invalid-data", path, "Expected a plain JSON object or array.");
    }

    active.add(value);
    const keys = Object.getOwnPropertyNames(value);
    if (count + keys.length - (array ? 1 : 0) > V1_LIMITS.yamlNodes) {
      reject("declaration-limit", path, "Extension declarations exceed the structural value budget.");
    }
    const read = (key: string | number) => {
      const field = [...path, key];
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property?.enumerable || !("value" in property)
        || (typeof key === "string" && (isReservedKey(key) || key === "<<"))) {
        reject("invalid-data", field, "Expected a safe own data property.");
      }
      return copy(property.value, field, depth + 1);
    };

    let result: JsonValue;
    if (array) {
      if (value.length !== keys.length - 1) {
        reject("invalid-data", path, "Expected a dense array without extra properties.");
      }
      result = Object.freeze(Array.from({ length: value.length }, (_, index) => read(index)));
    } else {
      const object = record<JsonValue>();
      for (const key of keys) object[key] = read(key);
      result = Object.freeze(object);
    }
    active.delete(value);
    return result;
  }

  return copy(input, [], 1);
}

function mapping(value: JsonValue | undefined, path: FieldPath, fields?: readonly string[]): JsonObject {
  if (!isObject(value)) reject("invalid-declaration", path, "Expected a declaration mapping.");
  if (fields) {
    for (const key of Object.keys(value)) {
      if (!fields.includes(key)) reject("unknown-field", [...path, key], "Unknown declaration field.");
    }
  }
  return value;
}

export function isParameterType(value: unknown): value is TemplateParameter["type"] {
  return value === "number" || value === "string" || value === "boolean";
}

export function matchesParameter(value: unknown, type: TemplateParameter["type"]): boolean {
  return typeof value === type && (type !== "number" || Number.isFinite(value));
}

function validateTemplate(value: JsonValue, path: FieldPath): void {
  const template = mapping(value, path, ["parameters", "body"]);
  const body = mapping(template.body, [...path, "body"]);
  if (typeof body.type !== "string" || !body.type) {
    reject("invalid-declaration", [...path, "body", "type"], "Expected a component type string.");
  }
  const parameters = mapping(template.parameters, [...path, "parameters"]);
  for (const [name, value] of Object.entries(parameters)) {
    const field = [...path, "parameters", name];
    if (!parameterPattern.test(name) || isReservedName(name)) {
      reject("invalid-parameter", field, "Expected an unreserved expression identifier.");
    }
    const parameter = mapping(value, field, ["type", "default", "description"]);
    const { type, description } = parameter;
    if (!isParameterType(type)) {
      reject("invalid-parameter", [...field, "type"], "Expected number, string, or boolean.");
    }
    if (Object.hasOwn(parameter, "default") && !matchesParameter(parameter.default, type)) {
      reject("parameter-type", [...field, "default"], `The default must be a ${type}.`);
    }
    if (description !== undefined && typeof description !== "string") {
      reject("invalid-parameter", [...field, "description"], "Expected a string description.");
    }
  }
}

function validateSymbol(value: JsonValue, path: FieldPath): void {
  const symbol = mapping(value, path, ["viewBox", "elements"]);
  if (typeof symbol.viewBox !== "string") {
    reject("invalid-declaration", [...path, "viewBox"], "Expected a viewBox string.");
  }
  const { elements } = symbol;
  if (!isArray(elements) || elements.length === 0 || !elements.every(isObject)) {
    reject("invalid-declaration", [...path, "elements"], "Expected a nonempty array of SVG primitive mappings.");
  }
  if (elements.length > V1_LIMITS.svgElements) {
    reject("symbol-element-limit", [...path, "elements"], `Expected at most ${V1_LIMITS.svgElements} SVG elements.`);
  }
}

function declaration(input: ExtensionPackage, registered: ReadonlyMap<string, ExtensionPackage>): ExtensionPackage {
  const extension = mapping(snapshot(input), [], ["namespace", "version", "protocolVersion", "symbols", "templates"]);
  const { namespace, version, protocolVersion } = extension;
  if (typeof namespace !== "string" || !idPattern.test(namespace + ":x")) {
    reject("invalid-namespace", ["namespace"], "Expected a lowercase extension namespace.");
  }
  if (registered.has(namespace)) {
    reject("duplicate-namespace", ["namespace"], `Namespace "${namespace}" is already registered.`);
  }
  if (protocolVersion !== PROTOCOL_VERSION) {
    reject("protocol-version", ["protocolVersion"], `Expected Protocol version ${PROTOCOL_VERSION}.`);
  }
  const match = typeof version === "string" ? semver.exec(version) : null;
  if (!match || match[0] !== version || match[1]?.split(".").some(part => /^0[0-9]+$/.test(part))) {
    reject("invalid-version", ["version"], "Expected a SemVer version.");
  }

  for (const [category, validate] of [["symbols", validateSymbol], ["templates", validateTemplate]] as const) {
    if (!Object.hasOwn(extension, category)) continue;
    for (const [name, value] of Object.entries(mapping(extension[category], [category]))) {
      const path = [category, name];
      if (!idPattern.test(namespace + ":" + name)) {
        reject("invalid-name", path, "Expected a lowercase extension member name.");
      }
      validate(value, path);
    }
  }

  // The closed declaration shapes above narrow the frozen JSON snapshot.
  return extension as unknown as ExtensionPackage;
}

export function createExtensionRegistry(): ExtensionRegistrar {
  const packages = new Map<string, ExtensionPackage>();
  function lookup(id: string) {
    if (!idPattern.test(id)) return;
    const colon = id.indexOf(":");
    const extension = packages.get(id.slice(0, colon));
    if (extension) return { extension, name: id.slice(colon + 1) };
  }

  return {
    symbol(id) {
      const entry = lookup(id);
      return entry?.extension.symbols?.[entry.name];
    },
    template(id) {
      const entry = lookup(id);
      return entry?.extension.templates?.[entry.name];
    },
    register(extension) {
      try {
        const value = declaration(extension, packages);
        packages.set(value.namespace, value);
        return { ok: true, value: undefined, diagnostics: [] };
      } catch (error) {
        const diagnostic: Diagnostic = error instanceof DeclarationError
          ? { phase: "extension", severity: "error", code: error.code, path: error.path, message: error.message }
          : { phase: "extension", severity: "error", code: "extension.invalid-data", path: [],
            message: "The extension declaration could not be read as JSON data." };
        return { ok: false, diagnostics: [diagnostic] };
      }
    },
  };
}
