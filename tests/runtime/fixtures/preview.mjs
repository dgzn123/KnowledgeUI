import { mountPreview } from "../../../preview/index.ts";
import { createFixtureRenderer, fixtureScanner } from "./components.mjs";

const container = document.querySelector("#kui-preview");
globalThis.fixturePreview = mountPreview(container, createFixtureRenderer, fixtureScanner, [
  { label: "示例笔记（fixture）", path: "./sample.md" },
  { label: "组件 Gallery（fixture）", path: "./gallery.md" },
]);
