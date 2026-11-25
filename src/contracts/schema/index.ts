import type { ComponentSchema, JsonSchema } from "../protocol.ts";
import type { JsonObject } from "../shared.ts";
import { PROTOCOL_VERSION } from "../shared.ts";
import { basicComponents } from "./basic.ts";
import { chartComponent } from "./chart.ts";
import { diagramComponents, svgElementSchema } from "./diagrams.ts";
import { boolean, bound, component, dictionary, identifier, list, number, qualifiedName, ref, string, union } from "./fields.ts";
import { interactionComponents } from "./interaction.ts";
import { fileEntrySchema, technicalComponents } from "./technical.ts";

const templateComponent = component("template", "Instantiate a bundled declarative template", {
  name: qualifiedName,
  params: dictionary(bound(union(number, string, boolean)), identifier),
}, ["name"]);

export const v1Components = [
  ...basicComponents, ...interactionComponents, chartComponent,
  ...diagramComponents, ...technicalComponents, templateComponent,
] as const;

export type V1ComponentType = (typeof v1Components)[number]["type"];

export function v1ComponentSchema(type: V1ComponentType): ComponentSchema {
  const definition = v1Components.find(candidate => candidate.type === type);
  if (!definition) throw new Error("No Protocol v1 schema for " + type);
  return definition;
}

export const phase1ComponentTypes = [
  "hero", "text", "markdown", "metric", "badge", "callout", "divider", "stack", "grid", "section", "compare",
] as const satisfies readonly V1ComponentType[];

function variants(schemas: readonly JsonSchema[]): JsonSchema {
  return schemas.length === 0 ? false : { oneOf: schemas };
}

/** Entry-point schema differs from nested nodes only by the optional v1 version field. */
export function createProtocolSchema(components: readonly ComponentSchema[]): JsonObject {
  const version = { type: "integer", const: PROTOCOL_VERSION };
  const nested = components.map(component => component.schema);
  const roots = nested.map(schema => ({ ...schema, properties: { ...schema.properties, version } }));
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Knowledge UI Protocol v1",
    $defs: {
      Node: variants(nested),
      Data: union(
        string,
        number,
        boolean,
        { type: "null" },
        list(ref("Data")),
        dictionary(ref("Data"), { not: { enum: ["__proto__", "constructor", "prototype"] } }),
      ),
      SvgElement: svgElementSchema,
      FileEntry: fileEntrySchema,
    },
    allOf: [variants(roots)],
  };
}
