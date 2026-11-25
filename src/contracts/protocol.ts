import type { CompiledExpression, ExpressionEngine } from "./expression.ts";
import type { ExtensionRegistry } from "./extensions.ts";
import type { Diagnostic, FieldPath, JsonObject, JsonValue, Result, SourceLocation, SourceRange } from "./shared.ts";
import type { InteractiveModel, StateDefinitions } from "./state.ts";

export interface Repeat {
  readonly items: CompiledExpression;
  readonly as: string;
  readonly index?: string;
}

export interface ComponentNode {
  readonly type: string;
  readonly source: SourceLocation;
  /** Component fields, with nested component slots removed. Bindable values are still unevaluated. */
  readonly props: JsonObject;
  /** Compiled raw expressions under props, keyed by relative JSON pointer. */
  readonly expressions: Readonly<Record<string, CompiledExpression>>;
  /** Finds the YAML source for a path relative to the node. */
  locate(path: FieldPath): SourceRange | undefined;
  /** Keys are JSON pointers relative to this node (e.g. /children, /panels/0/children). */
  readonly slots: Readonly<Record<string, readonly ComponentNode[]>>;
  readonly when?: CompiledExpression;
  readonly repeat?: Repeat;
  readonly ariaLabel?: string;
  /** Only present for an interactive node. */
  readonly model?: InteractiveModel;
}

export interface ProtocolDocument {
  readonly version: 1;
  readonly root: ComponentNode;
}

export interface DocumentSource {
  readonly yaml: string;
  readonly sourceId?: string;
}

export interface MarkdownBlock extends DocumentSource {
  /** One-based file line of the first YAML line, including fences/prefix lines. */
  readonly startLine: number;
  /** One-based exclusive end of the complete fenced block in the Markdown source. */
  readonly endLine: number;
}

export type JsonSchema = boolean | JsonObject;

export interface ComponentObjectSchema extends JsonObject {
  readonly type: "object";
  readonly properties: JsonObject;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface ComponentValidationInput {
  readonly node: ComponentNode;
  readonly state: StateDefinitions;
  readonly sourceId?: string;
  readonly extensions?: ExtensionRegistry;
}

export type ComponentSemanticValidator = (input: ComponentValidationInput) => readonly Diagnostic[];

export interface ComponentSchema {
  readonly type: string;
  readonly description: string;
  /** Complete flat component schema except for the root-only version field. */
  readonly schema: ComponentObjectSchema;
  readonly validate?: ComponentSemanticValidator;
}

export interface ProtocolCatalog {
  readonly components: ReadonlyMap<string, ComponentSchema>;
  readonly schema: JsonObject;
}

export type ProtocolCatalogFactory = (definitions: readonly ComponentSchema[]) => Result<ProtocolCatalog>;

export interface ProtocolReader {
  read(source: DocumentSource): Result<ProtocolDocument>;
  /** Validates a template body with the same nested-node schema and semantic rules. */
  readNode(input: ProtocolValues, scope: NodeValidationScope): Result<ComponentNode>;
}

export interface NodeValidationScope {
  readonly sourceId?: string;
  readonly locals: ReadonlySet<string>;
}

export interface MarkdownBlockScanner {
  scan(markdown: string, sourceId?: string): Result<readonly MarkdownBlock[]>;
}

export interface ProtocolValues {
  readonly value: JsonValue;
  readonly locate: (path: SourceLocation["path"]) => SourceRange | undefined;
}

/** Shared by Obsidian, browser and CLI through the composition entry. */
export interface YamlReader {
  read(source: DocumentSource): Result<ProtocolValues>;
}

export interface ProtocolDependencies {
  readonly catalog: ProtocolCatalog;
  readonly yaml: YamlReader;
  /** Available from Batch C. Dynamic capabilities require this dependency. */
  readonly expressions?: ExpressionEngine;
  readonly extensions?: ExtensionRegistry;
}
