import type { ComponentRegistrar, ComponentRegistration } from "#contracts";

export function createComponentRegistry(): ComponentRegistrar {
  const entries = new Map<string, ComponentRegistration>();
  return {
    register(component) {
      const { type, schema } = component.definition;
      const discriminator = Object.hasOwn(schema.properties, "type") ? schema.properties.type : undefined;
      const matchesType = type !== "" && typeof discriminator === "object" && discriminator !== null
        && Object.hasOwn(discriminator, "const")
        && (discriminator as { readonly const?: unknown }).const === type
        && schema.required.includes("type");
      let code: string | undefined;
      if (entries.has(type)) code = "render.registration-conflict";
      else if (!matchesType) code = "render.registration-schema";
      if (code) {
        return { ok: false, diagnostics: [{
          phase: "render", code, severity: "error", path: ["type"],
          message: code === "render.registration-conflict"
            ? `Component "${type}" is already registered.`
            : `The schema must require the declared component type "${type}".`,
        }] };
      }
      entries.set(type, component);
      return { ok: true, value: undefined, diagnostics: [] };
    },
    get: (type) => entries.get(type),
    list: () => Array.from(entries.values()),
  };
}
