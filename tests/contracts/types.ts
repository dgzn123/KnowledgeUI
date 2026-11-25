import type {
  ComponentMount, ComponentRegistration, ExpressionEngine, HostAdapter, Result, StateStore, TemplateExpander,
} from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";

export function dividerRegistration(mount: ComponentMount): ComponentRegistration {
  return { definition: v1ComponentSchema("divider"), mount };
}

export function checkServiceTypes(
  host: HostAdapter,
  store: StateStore,
  engine: ExpressionEngine,
  templates: TemplateExpander,
): Result<void> {
  const snapshot = store.snapshot();
  const compiled = engine.compile("counter + 1", { path: ["computed", "next"] });
  if (compiled.ok) engine.evaluate(compiled.value, snapshot);
  templates.expand({ id: "docs:example", params: snapshot, source: { path: [] }, ancestry: [] });
  if (host.kind === "browser") store.get("counter");

  // @ts-expect-error State updates accept scalars only.
  store.set("counter", [1, 2]);
  // @ts-expect-error Actions are closed to the v1 whitelist.
  return store.dispatch({ type: "execute", bind: "counter" });
}
