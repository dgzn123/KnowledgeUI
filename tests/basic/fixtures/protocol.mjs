import { parse } from "yaml";

// Test helpers for the Gallery's top-level fences and the Phase 1 slot shapes.
export function readGallery(markdown) {
  return Array.from(markdown.matchAll(/^```kui\n([\s\S]*?)^```$/gm), ([, yaml]) =>
    parse(yaml, { version: "1.2", schema: "core", uniqueKeys: true }));
}

export const fixtureRange = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 2, offset: 1 },
};

export function fixtureNode({ version, type, ariaLabel, children, ...props }, path = []) {
  const slots = Object.create(null);
  if (children) {
    slots["/children"] = children.map((child, index) => fixtureNode(child, [...path, "children", index]));
  }
  if (props.panels) {
    props.panels = props.panels.map(({ children, ...panel }, index) => {
      slots["/panels/" + index + "/children"] = children.map((child, childIndex) =>
        fixtureNode(child, [...path, "panels", index, "children", childIndex]));
      return panel;
    });
  }
  return {
    type, ariaLabel, props, slots, source: { path, range: fixtureRange },
    locate: () => fixtureRange,
    expressions: Object.create(null),
  };
}
