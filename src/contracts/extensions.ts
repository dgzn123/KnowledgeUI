import type { ComponentNode } from "./protocol.ts";
import type { JsonObject, Result, SourceLocation } from "./shared.ts";

export interface SymbolDefinition {
  readonly viewBox: string;
  /** The SVG validator handles the same primitive whitelist as in-note elements. */
  readonly elements: readonly JsonObject[];
}

export type TemplateParameter = (
  | { readonly type: "number"; readonly default?: number }
  | { readonly type: "string"; readonly default?: string }
  | { readonly type: "boolean"; readonly default?: boolean }
) & { readonly description?: string };

export interface TemplateDefinition {
  readonly parameters: Readonly<Record<string, TemplateParameter>>;
  /** Flat wire component body. The shared protocol validator owns its conversion. */
  readonly body: JsonObject;
}

export interface ExtensionPackage {
  readonly namespace: string;
  readonly version: string;
  readonly protocolVersion: 1;
  readonly symbols?: Readonly<Record<string, SymbolDefinition>>;
  readonly templates?: Readonly<Record<string, TemplateDefinition>>;
}

export interface ExtensionRegistry {
  symbol(id: string): SymbolDefinition | undefined;
  template(id: string): TemplateDefinition | undefined;
}

export interface ExtensionRegistrar extends ExtensionRegistry {
  /** Atomic; duplicate namespaces or invalid declarations return diagnostics. */
  register(extension: ExtensionPackage): Result<void>;
}

export interface TemplateRequest {
  readonly id: string;
  readonly params: JsonObject;
  readonly source: SourceLocation;
  /** Namespaced template IDs in the active expansion chain. */
  readonly ancestry: readonly string[];
}

export interface TemplateExpansion {
  readonly node: ComponentNode;
  readonly locals: JsonObject;
  readonly ancestry: readonly string[];
}

export interface TemplateExpander {
  expand(request: TemplateRequest): Result<TemplateExpansion>;
}
