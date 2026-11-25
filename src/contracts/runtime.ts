import type { BindingContext, BindingFactory } from "./expression.ts";
import type { ExtensionRegistry, TemplateExpander } from "./extensions.ts";
import type { ComponentNode, ComponentSchema, DocumentSource, ProtocolReader } from "./protocol.ts";
import type { Diagnostic, Disposable, JsonObject, Lifetime, Result, SourceLocation } from "./shared.ts";
import type { StateFactory, StateStore } from "./state.ts";

export interface MarkdownRenderRequest {
  readonly markdown: string;
  readonly container: HTMLElement;
  readonly sourceId?: string;
  readonly lifetime: Lifetime;
}

export interface HostAdapter {
  readonly kind: "obsidian" | "browser";
  renderMarkdown(request: MarkdownRenderRequest): Promise<Result<void>>;
  /** Returns plain text fragments and syntax classes, or undefined when unavailable. */
  highlightCode?(code: string, language: string, signal: AbortSignal): Promise<readonly CodeToken[] | undefined>;
  /** Stops only the host's conflicting editor events on this interactive surface. */
  isolateInteraction(element: HTMLElement, lifetime: Lifetime): void;
}

export interface CodeToken {
  readonly text: string;
  readonly classes: readonly string[];
}

export interface RenderContext {
  readonly host: HostAdapter;
  readonly lifetime: Lifetime;
  readonly sourceId?: string;
  /** Dynamic services are injected when the active edition supports them. */
  readonly bindings?: BindingContext;
  readonly state?: StateStore;
  readonly extensions?: ExtensionRegistry;
  readonly templates?: TemplateExpander;
  readonly templateAncestry: readonly string[];
  /** Unique for this mount, including sibling repeats, for SVG IDs and ARIA. */
  readonly instanceId: string;
  mountChild(node: ComponentNode, container: HTMLElement, scope?: ChildScope): Result<Disposable>;
  report(diagnostic: Diagnostic): void;
}

export type ChildScope =
  | {
      readonly bindings: BindingContext;
      readonly state?: StateStore;
      readonly templateAncestry?: readonly string[];
      readonly templateLocals?: never;
    }
  | {
      /** Starts an isolated template frame with only these resolved parameters. */
      readonly templateLocals: JsonObject;
      readonly templateAncestry: readonly string[];
      readonly bindings?: never;
      readonly state?: never;
    };

export interface ComponentMountRequest {
  readonly node: ComponentNode;
  readonly container: HTMLElement;
  readonly context: RenderContext;
}

export interface MountedComponent extends Disposable {
  readonly root: Element;
}

/** Components own their local subscriptions and update mounted elements in place. */
export type ComponentMount = (request: ComponentMountRequest) => Result<MountedComponent>;

export interface ComponentRegistration {
  readonly definition: ComponentSchema;
  readonly mount: ComponentMount;
}

export interface ComponentRegistry {
  get(type: string): ComponentRegistration | undefined;
  list(): readonly ComponentRegistration[];
}

export interface ComponentRegistrar extends ComponentRegistry {
  register(component: ComponentRegistration): Result<void>;
}

export interface RuntimeServices {
  readonly protocol: ProtocolReader;
  readonly registry: ComponentRegistry;
  readonly host: HostAdapter;
  readonly state?: StateFactory;
  readonly bindings?: BindingFactory;
  readonly extensions?: ExtensionRegistry;
  readonly templates?: TemplateExpander;
}

export interface RenderBlockRequest {
  readonly source: DocumentSource;
  readonly container: HTMLElement;
}

export interface BlockMount extends Disposable {
  readonly source: SourceLocation | undefined;
  /** Includes diagnostics produced after mounting. */
  diagnostics(): readonly Diagnostic[];
}

export interface BlockRenderer {
  /** A failed block owns its own diagnostic surface and can still be disposed. */
  mountBlock(request: RenderBlockRequest): BlockMount;
}
