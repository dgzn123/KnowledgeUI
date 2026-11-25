import { basicRegistrations } from "../../../src/components/basic/index.ts";
import { fixtureNode } from "./protocol.mjs";

// Runtime fixture for the frozen interfaces. It supplies lifetimes, slots and a recording HostAdapter.
function makeLifetime() {
  const controller = new AbortController();
  const cleanups = new Set();
  const lifetime = {
    signal: controller.signal,
    add(cleanup) {
      if (controller.signal.aborted) cleanup();
      else cleanups.add(cleanup);
    },
    child() {
      const child = makeLifetime();
      const dispose = () => child.dispose();
      lifetime.add(dispose);
      child.add(() => cleanups.delete(dispose));
      return child;
    },
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      for (const cleanup of [...cleanups].reverse()) cleanup();
      cleanups.clear();
    },
  };
  return lifetime;
}

const registrations = new Map(basicRegistrations.map(component => [component.definition.type, component]));
let nextId = 0;

export const success = (value, diagnostics = []) => ({ ok: true, value, diagnostics });

export function runtimeFixture(container, options = {}) {
  const lifetime = makeLifetime();
  const reports = [];
  const markdownRequests = [];
  const childCalls = [];
  const host = {
    kind: "browser",
    renderMarkdown(request) {
      markdownRequests.push(request);
      if (options.renderMarkdown) return options.renderMarkdown(request);
      request.container.textContent = request.markdown;
      return Promise.resolve(success());
    },
    isolateInteraction() {},
  };

  function mount(node, target, owner) {
    const scope = owner.child();
    const registration = registrations.get(node.type);
    if (!registration) throw new Error("Fixture has no registration for " + node.type);
    const result = registration.mount({
      node,
      container: target,
      context: {
        host,
        sourceId: "gallery/basic.md",
        lifetime: scope,
        bindings: options.bindings,
        instanceId: "kui-fixture-" + ++nextId,
        templateAncestry: [],
        report: item => reports.push(item),
        mountChild(child, childTarget) {
          childCalls.push({ node: child, container: childTarget });
          return options.beforeChild?.(child) ?? mount(child, childTarget, scope);
        },
      },
    });
    if (result.ok) scope.add(() => result.value.dispose());
    else scope.dispose();
    return result;
  }

  return {
    lifetime, reports, markdownRequests, childCalls,
    mount: (input, path) => mount(fixtureNode(input, path), container, lifetime),
  };
}
