import { V1_LIMITS } from "#contracts";
import type {
  BindingContext, BlockMount, BlockRenderer, ChildScope, ComponentNode, Diagnostic, Disposable,
  JsonObject, JsonValue, Lifetime, RenderBlockRequest, RenderContext, Result, RuntimeServices, SourceLocation,
  StateStore,
} from "#contracts";
import { diagnosticItem, diagnosticList } from "./diagnostics.ts";
import { createLifetime } from "./lifetime.ts";

interface Frame {
  readonly bindings?: BindingContext;
  readonly state?: StateStore;
  readonly templateLocals?: JsonObject;
  readonly templateAncestry: readonly string[];
}

let nextInstanceId = 0;

export function createBlockRenderer(services: RuntimeServices): BlockRenderer {
  return { mountBlock: (request) => new BlockSession(services, request).mount() };
}

class BlockSession {
  readonly #services: RuntimeServices;
  readonly #request: RenderBlockRequest;
  readonly #lifetime = createLifetime();
  readonly #diagnostics: Diagnostic[] = [];
  readonly #reported = new WeakSet<Diagnostic>();
  readonly #root: HTMLElement;
  readonly #content: HTMLElement;
  #list?: HTMLUListElement;
  #activeInstances = 0;
  #source: SourceLocation | undefined;

  constructor(services: RuntimeServices, request: RenderBlockRequest) {
    this.#services = services;
    this.#request = request;
    const document = request.container.ownerDocument;
    this.#root = document.createElement("div");
    this.#root.className = "kui-block";
    this.#content = document.createElement("div");
    this.#content.className = "kui-block-content";
    this.#root.append(this.#content);
    request.container.append(this.#root);
    this.#lifetime.add(() => this.#root.remove());
  }

  mount(): BlockMount {
    this.#source = { path: [] };
    try {
      const result = this.#services.protocol.read(this.#request.source);
      this.#reportAll(result.diagnostics);
      if (result.ok) {
        this.#source = result.value.root.source;
        const bindings = this.#services.bindings?.create(undefined);
        this.#mountNode(result.value.root, this.#content, this.#lifetime, {
          ...(bindings && { bindings }),
          templateAncestry: [],
        }, 1);
      }
    } catch {
      this.#fail("render.block-failed", "The block could not be rendered.", this.#source);
    }
    return {
      source: this.#source,
      diagnostics: () => this.#diagnostics.slice(),
      dispose: () => this.#lifetime.dispose(),
    };
  }

  #report(diagnostic: Diagnostic): void {
    if (this.#lifetime.signal.aborted || this.#reported.has(diagnostic)) return;
    this.#reported.add(diagnostic);
    const sourceId = diagnostic.sourceId ?? this.#request.source.sourceId;
    let entry = { ...diagnostic, ...(sourceId !== undefined && { sourceId }) };
    if (this.#diagnostics.length === V1_LIMITS.diagnostics) {
      if (this.#diagnostics.at(-1)?.code === "render.diagnostics-truncated") return;
      this.#diagnostics.pop();
      this.#list?.lastElementChild?.remove();
      entry = {
        phase: "render", code: "render.diagnostics-truncated", severity: "warning", path: [],
        message: "The diagnostic limit was reached. Further diagnostics were omitted.",
        ...(sourceId !== undefined && { sourceId }),
      };
    }
    this.#diagnostics.push(entry);
    this.#list ??= diagnosticList(this.#root, "Knowledge UI diagnostics");
    this.#list.append(diagnosticItem(this.#root.ownerDocument, entry));
  }

  #reportAll(diagnostics: readonly Diagnostic[]): void {
    for (const diagnostic of diagnostics) this.#report(diagnostic);
  }

  #fail(code: string, message: string, location: SourceLocation): Result<never> {
    const phase = code === "semantic.capability-unavailable" ? "semantic" : "render";
    const diagnostic: Diagnostic = { ...location, code, message, phase, severity: "error" };
    this.#report(diagnostic);
    return { ok: false, diagnostics: [diagnostic] };
  }

  #mountNode(
    node: ComponentNode, container: HTMLElement, parent: Lifetime, frame: Frame, depth: number,
  ): Result<Disposable> {
    if (parent.signal.aborted) return { ok: true, value: parent.child(), diagnostics: [] };
    if (depth > V1_LIMITS.componentDepth) {
      return this.#fail("render.depth-limit", "The component depth limit was reached.", node.source);
    }
    const scope = parent.child();
    try {
      if (!node.repeat) {
        const result = this.#mountOccurrence(node, container, scope, frame, depth);
        if (!result.ok) scope.dispose();
        return result;
      }
      const bindings = frame.bindings;
      if (!bindings) {
        scope.dispose();
        return this.#fail("semantic.capability-unavailable", "Repeat requires expression bindings.", node.source);
      }
      const result = bindings.evaluate(node.repeat.items);
      this.#reportAll(result.diagnostics);
      if (!result.ok) {
        scope.dispose();
        return result;
      }
      const items = result.value;
      if (!Array.isArray(items)) {
        scope.dispose();
        return this.#fail("render.repeat-type", "Repeat items must be an array.", node.repeat.items.location);
      }
      if (items.length > V1_LIMITS.repeatIterations) {
        scope.dispose();
        return this.#fail("render.repeat-limit", "The repeat iteration limit was reached.", node.repeat.items.location);
      }
      for (const [index, item] of (items as readonly JsonValue[]).entries()) {
        if (this.#activeInstances >= V1_LIMITS.componentInstances) {
          this.#instanceLimit(node);
          break;
        }
        const locals: JsonObject = {
          [node.repeat.as]: item,
          ...(node.repeat.index !== undefined && { [node.repeat.index]: index }),
        };
        this.#mountOccurrence(node, container, scope.child(), {
          ...frame, bindings: bindings.withLocals(locals),
        }, depth);
      }
      return { ok: true, value: scope, diagnostics: [] };
    } catch {
      scope.dispose();
      return this.#fail("render.node-failed", `Component "${node.type}" could not be rendered.`, node.source);
    }
  }

  #instanceLimit(node: ComponentNode): Result<never> {
    return this.#fail("render.instance-limit", "The component instance limit was reached.", node.source);
  }

  #mountOccurrence(
    node: ComponentNode, container: HTMLElement, scope: Lifetime, frame: Frame, depth: number,
  ): Result<Disposable> {
    if (this.#activeInstances >= V1_LIMITS.componentInstances) {
      scope.dispose();
      return this.#instanceLimit(node);
    }
    // Each occurrence reserves a slot until its scope is disposed, including while hidden.
    this.#activeInstances += 1;
    scope.add(() => { this.#activeInstances -= 1; });
    if (!node.when) {
      const result = this.#mountComponent(node, container, scope, frame, depth);
      return result.ok ? { ok: true, value: scope, diagnostics: result.diagnostics } : result;
    }
    const bindings = frame.bindings;
    if (!bindings) {
      scope.dispose();
      return this.#fail("semantic.capability-unavailable", "A condition requires expression bindings.", node.source);
    }
    const anchor = container.ownerDocument.createComment("kui-when");
    container.append(anchor);
    scope.add(() => anchor.remove());
    let body: Disposable | undefined;
    const condition = node.when;
    const subscription = bindings.observeExpression(condition, (result) => {
      if (scope.signal.aborted) return;
      this.#reportAll(result.diagnostics);
      if (result.ok && typeof result.value !== "boolean") {
        this.#fail("render.condition-type", "A condition must evaluate to a boolean.", condition.location);
      }
      if (!result.ok || result.value !== true) {
        body?.dispose();
        body = undefined;
      } else if (!body) {
        const mounted = this.#mountComponent(node, container, scope, frame, depth, anchor);
        if (mounted.ok) body = mounted.value;
      }
    });
    scope.add(() => subscription.dispose());
    return { ok: true, value: scope, diagnostics: [] };
  }

  #mountComponent(
    node: ComponentNode, container: HTMLElement, parent: Lifetime, inherited: Frame,
    depth: number, before?: Comment,
  ): Result<Disposable> {
    const scope = parent.child();
    const existing = new Set(container.childNodes);
    let additions: ChildNode[] = [];
    let mounted = false;
    scope.add(() => {
      for (const element of additions) element.remove();
    });
    try {
      const component = this.#services.registry.get(node.type);
      if (!component) {
        return this.#fail("render.component-unregistered", `Component "${node.type}" is not registered.`, node.source);
      }
      let frame = inherited;
      if (node.model) {
        if (!this.#services.state || !this.#services.bindings || !inherited.bindings) {
          return this.#fail("semantic.capability-unavailable", "This component requires state and expression bindings.", node.source);
        }
        const store = this.#services.state.create(
          node.model, inherited.bindings.expressions, node.source, inherited.templateLocals,
        );
        this.#reportAll(store.diagnostics);
        if (!store.ok) return store;
        scope.add(() => store.value.dispose());
        frame = { ...inherited, state: store.value, bindings: this.#services.bindings.create(store.value) };
      }
      const { sourceId } = this.#request.source;
      const context: RenderContext = {
        host: this.#services.host,
        lifetime: scope,
        instanceId: `kui-instance-${++nextInstanceId}`,
        templateAncestry: frame.templateAncestry,
        ...(sourceId !== undefined && { sourceId }),
        ...(frame.bindings && { bindings: frame.bindings }),
        ...(frame.state && { state: frame.state }),
        ...(this.#services.extensions && { extensions: this.#services.extensions }),
        ...(this.#services.templates && { templates: this.#services.templates }),
        report: (diagnostic) => {
          if (!scope.signal.aborted) this.#report(diagnostic);
        },
        mountChild: (child, target, childScope) => this.#mountNode(
          child, target, scope, childScope ? this.#childFrame(frame, childScope) : frame, depth + 1,
        ),
      };
      const result = component.mount({ node, container, context });
      if (result.ok) scope.add(() => result.value.dispose());
      this.#reportAll(result.diagnostics);
      if (!result.ok) return result;
      if (result.value.root.parentNode !== container || existing.has(result.value.root)) {
        return this.#fail("render.invalid-root", "The component must attach a new root to its container.", node.source);
      }
      if (node.ariaLabel !== undefined) result.value.root.setAttribute("aria-label", node.ariaLabel);
      additions = [...container.childNodes].filter((element) => !existing.has(element));
      if (before?.parentNode === container) {
        for (const element of additions) container.insertBefore(element, before);
      }
      mounted = true;
      return { ok: true, value: scope, diagnostics: result.diagnostics };
    } catch {
      return this.#fail("render.component-failed", `Component "${node.type}" could not be mounted.`, node.source);
    } finally {
      if (!mounted) {
        additions = [...container.childNodes].filter((element) => !existing.has(element));
        scope.dispose();
      }
      if (scope.signal.aborted) for (const element of additions) element.remove();
    }
  }

  #childFrame(parent: Frame, scope: ChildScope): Frame {
    if (scope.templateLocals !== undefined) {
      const bindings = this.#services.bindings?.create(undefined).withLocals(scope.templateLocals);
      return {
        ...(bindings && { bindings }),
        templateLocals: scope.templateLocals,
        templateAncestry: scope.templateAncestry,
      };
    }
    return {
      bindings: scope.bindings,
      ...(scope.state && { state: scope.state }),
      ...(parent.templateLocals && { templateLocals: parent.templateLocals }),
      templateAncestry: scope.templateAncestry ?? parent.templateAncestry,
    };
  }
}
