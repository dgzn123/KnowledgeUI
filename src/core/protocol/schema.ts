import type { ComponentSchema, FieldPath, JsonObject, JsonValue, ProtocolCatalogFactory } from "#contracts";
import { createProtocolSchema } from "#protocol-schema";
import { Diagnostics, isArray, isObject, isReservedKey, own } from "./support.ts";

export const createProtocolCatalog: ProtocolCatalogFactory = definitions => {
  const diagnostics = new Diagnostics();
  const components = new Map<string, ComponentSchema>();
  for (const [index, definition] of definitions.entries()) {
    const path = [index, "type"];
    const typeSchema = own(definition.schema.properties, "type");
    if (components.has(definition.type)) {
      diagnostics.report("schema", "schema.duplicate-type", path, `Duplicate component type ${JSON.stringify(definition.type)}.`);
    } else if (!definition.type || isReservedKey(definition.type) || !isObject(typeSchema)
      || own(typeSchema, "const") !== definition.type || !definition.schema.required.includes("type")
      || Object.hasOwn(definition.schema.properties, "version")
      || definition.schema.type !== "object" || definition.schema.additionalProperties !== false) {
      diagnostics.report("schema", "schema.invalid-definition", path, "Component definitions need a matching type discriminator and a closed nested schema.");
    } else {
      components.set(definition.type, definition);
    }
  }
  return diagnostics.finish({ components, schema: createProtocolSchema([...components.values()]) });
};

export interface Annotation {
  readonly path: FieldPath;
  readonly value: JsonValue;
  readonly kind: "single" | "list" | "binding" | "expression";
}

function isType(value: JsonValue, type: string): boolean {
  switch (type) {
    case "null": return value === null;
    case "array": return isArray(value);
    case "object": return isObject(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    default: return typeof value === type;
  }
}

function matchesDiscriminator(schema: JsonValue, value: JsonValue): boolean {
  if (!isObject(schema)) return schema !== false;
  const type = own(schema, "type");
  if (typeof type === "string" && !isType(value, type)) return false;
  const properties = own(schema, "properties");
  if (!isObject(value) || !isObject(properties)) return true;
  return Object.entries(properties).every(([key, field]) => {
    if (!isObject(field) || !Object.hasOwn(field, "const") || !Object.hasOwn(value, key)) return true;
    return value[key] === field.const;
  });
}

/** Interprets the declarative keywords used by #protocol-schema and gathers its annotations. */
export class SchemaReader {
  private readonly patterns = new Map<string, RegExp>();

  private readonly definitions: JsonObject | undefined;

  constructor(definitions: JsonObject | undefined) {
    this.definitions = definitions;
  }

  read(schema: JsonValue, value: JsonValue, path: FieldPath, diagnostics: Diagnostics, annotations: Annotation[]): void {
    const report = (name: string, message: string, field = path) => diagnostics.report("schema", "schema." + name, field, message);
    if (schema === true) return;
    if (!isObject(schema)) {
      report("value", "This value is forbidden.");
      return;
    }

    const slot = own(schema, "x-kui-slot");
    if (slot === "single" || slot === "list") {
      if (slot === "list") {
        if (!isArray(value)) {
          report("type", "Expected an array of components.");
          return;
        }
        this.checkLength(schema, value.length, "Items", report);
      }
      annotations.push({ path, value, kind: slot });
      return;
    }
    const reference = own(schema, "$ref");
    if (typeof reference === "string") {
      const target = reference.startsWith("#/$defs/") ? own(this.definitions, reference.slice(8)) : undefined;
      if (target === undefined || reference === "#/$defs/Node") {
        report("invalid-definition", `Unexpected schema reference ${JSON.stringify(reference)}.`);
      } else {
        this.read(target, value, path, diagnostics, annotations);
      }
      return;
    }

    const startErrors = diagnostics.errorCount;
    const type = own(schema, "type");
    if (typeof type === "string" && !isType(value, type)) {
      report("type", `Expected ${type}.`);
      return;
    }
    const enumeration = own(schema, "enum");
    if ((Object.hasOwn(schema, "const") && value !== schema.const) || (isArray(enumeration) && !enumeration.includes(value))) {
      report("value", "Expected one of the declared values.");
      return;
    }

    const alternatives = own(schema, "anyOf");
    if (isArray(alternatives)) {
      const candidates = alternatives.filter(branch => matchesDiscriminator(branch, value));
      let nearest: Diagnostics | undefined;
      for (const branch of candidates) {
        const trial = new Diagnostics();
        const trialAnnotations: Annotation[] = [];
        this.read(branch, value, path, trial, trialAnnotations);
        if (trial.errorCount === 0) {
          for (const annotation of trialAnnotations) annotations.push(annotation);
          nearest = undefined;
          break;
        }
        if (!nearest || trial.errorCount < nearest.errorCount) nearest = trial;
      }
      if (nearest) {
        for (const diagnostic of nearest.list()) diagnostics.add(diagnostic);
      } else if (candidates.length === 0) {
        // Keep tagged union errors at the discriminator when one is available.
        const tag = isObject(value) && ["type", "kind"].find(key => Object.hasOwn(value, key));
        report("value", "Value does not match an allowed shape.", tag ? [...path, tag] : path);
      }
    }

    if (Object.hasOwn(schema, "not")) {
      const trial = new Diagnostics();
      this.read(schema.not as JsonValue, value, path, trial, []);
      if (trial.errorCount === 0) report("value", "This value is forbidden.");
    }
    if (typeof value === "number") {
      const minimum = own(schema, "minimum");
      const maximum = own(schema, "maximum");
      const exclusiveMinimum = own(schema, "exclusiveMinimum");
      if (typeof minimum === "number" && value < minimum) report("range", `Expected a value of at least ${minimum}.`);
      if (typeof maximum === "number" && value > maximum) report("range", `Expected a value of at most ${maximum}.`);
      if (typeof exclusiveMinimum === "number" && value <= exclusiveMinimum) report("range", `Expected a value greater than ${exclusiveMinimum}.`);
    }
    if (typeof value === "string") {
      const pattern = own(schema, "pattern");
      if (typeof pattern === "string") {
        let matcher = this.patterns.get(pattern);
        if (!matcher) {
          matcher = new RegExp(pattern, "u");
          this.patterns.set(pattern, matcher);
        }
        if (!matcher.test(value)) report("pattern", "String does not match the required format.");
      }
      if (own(schema, "minLength") !== undefined || own(schema, "maxLength") !== undefined) {
        let length = 0;
        for (const _character of value) length++;
        this.checkLength(schema, length, "Length", report);
      }
    }
    if (isArray(value)) {
      this.checkLength(schema, value.length, "Items", report);
      const items = own(schema, "items");
      if (items !== undefined) {
        for (const [index, child] of value.entries()) this.read(items, child, [...path, index], diagnostics, annotations);
      }
    }
    if (isObject(value)) {
      const properties = own(schema, "properties");
      const required = own(schema, "required");
      const additional = own(schema, "additionalProperties");
      const names = own(schema, "propertyNames");
      if (isArray(required)) {
        for (const key of required) {
          if (typeof key === "string" && !Object.hasOwn(value, key)) {
            report("required", `Missing required field ${JSON.stringify(key)}.`, [...path, key]);
          }
        }
      }
      for (const [key, child] of Object.entries(value)) {
        const field = [...path, key];
        if (names !== undefined) this.read(names, key, field, diagnostics, []);
        const property = isObject(properties) ? own(properties, key) : undefined;
        if (property !== undefined) this.read(property, child, field, diagnostics, annotations);
        else if (additional === false) report("unknown-field", `Unknown field ${JSON.stringify(key)}.`, field);
        else if (additional !== undefined) this.read(additional, child, field, diagnostics, annotations);
      }
    }

    const kind = own(schema, "x-kui-value");
    if (diagnostics.errorCount === startErrors && (kind === "binding" || kind === "expression")) {
      annotations.push({ path, value, kind });
    }
  }

  private checkLength(
    schema: JsonObject, length: number, kind: "Items" | "Length", report: (name: string, message: string) => void,
  ): void {
    const minimum = own(schema, "min" + kind);
    const maximum = own(schema, "max" + kind);
    if (typeof minimum === "number" && length < minimum) report("length", `Expected at least ${minimum} ${kind === "Items" ? "items" : "characters"}.`);
    if (typeof maximum === "number" && length > maximum) report("length", `Expected at most ${maximum} ${kind === "Items" ? "items" : "characters"}.`);
  }
}
