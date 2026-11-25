import type { ComponentObjectSchema, ComponentSchema, JsonSchema } from "../protocol.ts";
import { V1_LIMITS } from "../shared.ts";
import type { JsonObject, JsonScalar } from "../shared.ts";

export const string = { type: "string" } as const;
export const label = { type: "string", minLength: 1, maxLength: 256 } as const;
export const number = { type: "number" } as const;
export const nonnegative = { type: "number", minimum: 0 } as const;
export const positive = { type: "number", exclusiveMinimum: 0 } as const;
export const boolean = { type: "boolean" } as const;

export const identifier = {
  type: "string",
  pattern: "^(?!(?:__proto__|constructor|prototype)$)[A-Za-z_][A-Za-z0-9_]{0,63}$",
} as const;
export const qualifiedName = {
  type: "string",
  pattern: "^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,63}$",
} as const;

export function choice(...values: JsonScalar[]): JsonObject {
  return { enum: values };
}

export function union(...schemas: JsonSchema[]): JsonObject {
  return { anyOf: schemas };
}

export function list(items: JsonSchema, minItems = 0, maxItems: number = V1_LIMITS.yamlNodes): JsonObject {
  return { type: "array", items, minItems, maxItems };
}

export function object(properties: JsonObject, required: readonly string[] = []): ComponentObjectSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export function dictionary(values: JsonSchema, keys: JsonObject = identifier): JsonObject {
  return { type: "object", propertyNames: keys, additionalProperties: values };
}

export function tagged(tag: string, value: string, fields: JsonObject, required: readonly string[] = []): ComponentObjectSchema {
  return object({ [tag]: { const: value }, ...fields }, [tag, ...required]);
}

export function ref(name: "Node" | "Data"): JsonObject {
  return { $ref: "#/$defs/" + name };
}

export const expression = { ...label, maxLength: V1_LIMITS.expressionLength, "x-kui-value": "expression" } as const;

export function bound(literal: JsonSchema): JsonObject {
  return {
    anyOf: [literal, { type: "string", pattern: "^\\{\\{[\\s\\S]+\\}\\}$" }],
    "x-kui-value": "binding",
  };
}

export const text = { ...string, "x-kui-value": "binding" } as const;
export const tone = bound(choice("neutral", "info", "success", "danger", "warning"));
export const scalar = union(number, string, boolean);

export const repeat = object(
  { items: expression, as: identifier, index: identifier },
  ["items", "as"],
);

export const structure = { when: expression, repeat } as const;
export const slot = { ...ref("Node"), "x-kui-slot": "single" } as const;
export const slots = { ...list(ref("Node"), 1, V1_LIMITS.componentInstances), "x-kui-slot": "list" } as const;

export function component<const Name extends string>(
  type: Name,
  description: string,
  properties: JsonObject,
  required: readonly string[] = [],
): ComponentSchema & { readonly type: Name } {
  return {
    type,
    description,
    schema: {
      ...tagged("type", type, { ...structure, ariaLabel: label, ...properties }, required),
      description,
    },
  };
}
