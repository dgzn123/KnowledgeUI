import { V1_LIMITS } from "#contracts";
import type {
  ComponentValidationInput, Diagnostic, ExtensionRegistry, FieldPath, JsonObject, JsonValue, ProtocolReader,
  SourceLocation, SourceRange, TemplateDefinition, TemplateExpander,
} from "#contracts";
import { Diagnostics, pointer, record } from "../protocol/support.ts";
import { matchesParameter } from "./registry.ts";

function hasBinding(value: JsonValue): boolean {
  if (typeof value !== "string") return false;
  for (const { index } of value.matchAll(/\{\{/g)) {
    if (value[index - 1] !== "\\") return true;
  }
  return false;
}

function parameterValues(
  definition: TemplateDefinition, supplied: JsonObject, diagnostics: Diagnostics, path: FieldPath, allowBindings: boolean,
): JsonObject {
  const resolved = record<JsonValue>();
  for (const key of Object.keys(supplied)) {
    if (!Object.hasOwn(definition.parameters, key)) {
      diagnostics.report("extension", "extension.unknown-parameter", [...path, key], `Unknown template parameter "${key}".`);
    }
  }

  for (const [key, parameter] of Object.entries(definition.parameters)) {
    const field = [...path, key];
    const property = Object.getOwnPropertyDescriptor(supplied, key);
    if (!property && parameter.default !== undefined) {
      resolved[key] = parameter.default;
    } else if (!property) {
      diagnostics.report("extension", "extension.missing-parameter", field, `Required template parameter "${key}" is missing.`);
    } else if ("value" in property && (matchesParameter(property.value, parameter.type)
      || (allowBindings && hasBinding(property.value)))) {
      resolved[key] = property.value as JsonValue;
    } else {
      diagnostics.report("extension", "extension.parameter-type", field, `Template parameter "${key}" must be a ${parameter.type}.`);
    }
  }
  return Object.freeze(resolved);
}

function findTemplate(
  registry: ExtensionRegistry | undefined, id: string, diagnostics: Diagnostics, path: FieldPath,
): TemplateDefinition | undefined {
  if (!registry) {
    diagnostics.report("semantic", "semantic.capability-unavailable", path, "Template calls require an extension registry.");
    return;
  }
  const template = registry.template(id);
  if (!template) {
    diagnostics.report("extension", "extension.unknown-template", path, `Template "${id}" is not registered.`);
  }
  return template;
}

function templateDiagnostics(
  source: SourceLocation, sourceId?: string, locate?: (path: FieldPath) => SourceRange | undefined,
): Diagnostics {
  return new Diagnostics(sourceId, path => {
    for (let size = path.length; locate && size > source.path.length; size--) {
      const range = locate(path.slice(source.path.length, size));
      if (range) return range;
    }
    return source.range;
  });
}

export function validateTemplateCall({ node, sourceId, extensions }: ComponentValidationInput): readonly Diagnostic[] {
  const diagnostics = templateDiagnostics(node.source, sourceId, node.locate);
  // The shared reader checks the component schema before invoking this validator.
  const definition = findTemplate(extensions, node.props.name as string, diagnostics, [...node.source.path, "name"]);
  if (definition) {
    parameterValues(definition, (node.props.params ?? {}) as JsonObject, diagnostics, [...node.source.path, "params"], true);
  }
  return diagnostics.list();
}

export function createTemplateExpander(registry: ExtensionRegistry, protocol: ProtocolReader): TemplateExpander {
  return {
    expand({ id, params, source, ancestry }) {
      const diagnostics = templateDiagnostics(source);
      const namePath = [...source.path, "name"];
      const definition = findTemplate(registry, id, diagnostics, namePath);
      if (!definition) return { ok: false, diagnostics: diagnostics.list() };
      if (ancestry.length >= V1_LIMITS.templateDepth) {
        diagnostics.report("extension", "extension.template-depth-limit", namePath,
          `Template expansion is limited to ${V1_LIMITS.templateDepth} levels.`);
      } else if (ancestry.includes(id)) {
        diagnostics.report("extension", "extension.template-cycle", namePath,
          `Recursive template expansion: ${[...ancestry, id].join(" → ")}.`);
      }
      if (diagnostics.errorCount) return { ok: false, diagnostics: diagnostics.list() };

      const locals = parameterValues(definition, params, diagnostics, [...source.path, "params"], false);
      if (diagnostics.errorCount) return { ok: false, diagnostics: diagnostics.list() };

      const result = protocol.readNode({ value: definition.body, locate: () => source.range },
        { locals: new Set(Object.keys(locals)) });
      for (const diagnostic of result.diagnostics) {
        diagnostics.add({
          ...diagnostic, path: source.path,
          message: `Template "${id}" body ${pointer(diagnostic.path) || "$"}: ${diagnostic.message}`,
        });
      }
      if (!result.ok) return { ok: false, diagnostics: diagnostics.list() };
      return diagnostics.finish({ node: result.value, locals, ancestry: Object.freeze([...ancestry, id]) });
    },
  };
}
