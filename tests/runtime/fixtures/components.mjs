// Independent fixture only. The production protocol and registrations are owned by Agents 01 and 03.
import { v1ComponentSchema } from "#protocol-schema";
import { parse } from "yaml";
import { createBlockRenderer } from "../../../src/core/renderer/index.ts";
import { createComponentRegistry } from "../../../src/core/registry/index.ts";

export function fixtureNode(type, { props = {}, slots = {}, path = [], ...extra } = {}) {
  return { type, props, slots, source: { path }, expressions: {}, locate: () => undefined, ...extra };
}

export function fixtureRegistration(type, mount) {
  return {
    definition: {
      type,
      description: "Independent runtime test fixture",
      schema: { type: "object", required: ["type"], properties: { type: { const: type } }, additionalProperties: false },
    },
    mount,
  };
}

export const ok = (value) => ({ ok: true, value, diagnostics: [] });

function normalizeFixture(value, path = []) {
  const { type, version: _version, children, ...props } = value;
  if (!["section", "metric", "callout"].includes(type)) throw new Error("Unknown fixture type");
  const slots = children ? { "/children": children.map((child, index) => normalizeFixture(child, [...path, "children", index])) } : {};
  return fixtureNode(type, { path, props, slots });
}

export const fixtureScanner = {
  scan(markdown, sourceId) {
    const blocks = [];
    const lines = markdown.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
    for (let index = 0; index < lines.length; index += 1) {
      const opening = /^(\x60{3,}|~{3,})(.*)$/.exec(lines[index].trimEnd());
      if (!opening) continue;
      const startLine = index + 2;
      const close = new RegExp("^" + opening[1][0] + "{" + opening[1].length + ",}\\s*$");
      const yaml = [];
      while (++index < lines.length && !close.test(lines[index].trimEnd())) yaml.push(lines[index]);
      if (opening[2].trim() === "kui") {
        const endLine = Math.min(index + 2, lines.length + 1);
        blocks.push({ yaml: yaml.join(""), startLine, endLine, sourceId });
      }
    }
    return ok(blocks);
  },
};

export function createFixtureRenderer(host) {
  const registry = createComponentRegistry();
  for (const type of ["section", "metric", "callout"]) {
    registry.register({
      definition: v1ComponentSchema(type),
      mount({ node, container, context }) {
        const document = container.ownerDocument;
        const root = document.createElement("section");
        root.className = "kui-fixture-component";
        const { title, label, value, unit, body } = node.props;
        if (title || label) {
          const heading = document.createElement("h3");
          heading.textContent = title ?? label;
          root.append(heading);
        }
        if (value !== undefined || body !== undefined) {
          const content = document.createElement("p");
          content.textContent = body ?? [value, unit].filter((part) => part !== undefined).join(" ");
          root.append(content);
        }
        container.append(root);
        for (const child of node.slots["/children"] ?? []) context.mountChild(child, root);
        return ok({ root, dispose: () => root.remove() });
      },
    });
  }
  return createBlockRenderer({
    registry,
    host,
    protocol: {
      read: ({ yaml }) => ok({ version: 1, root: normalizeFixture(parse(yaml)) }),
      readNode: () => { throw new Error("Template reading is outside this fixture"); },
    },
  });
}
