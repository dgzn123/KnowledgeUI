import { Component, prismFixture } from "obsidian";
import { createBrowserHost } from "../../../src/adapters/browser/index.ts";
import { createObsidianHost } from "../../../src/adapters/obsidian/index.ts";
import { markdownBlockScanner } from "../../../src/core/protocol/index.ts";
import { renderer } from "./runtime.mjs";

const browser = createBrowserHost();
const handles = [];

function mount(yaml, host = browser, width = 375) {
  const container = document.createElement("div");
  container.style.inlineSize = width + "px";
  document.body.append(container);
  const stores = [];
  const handle = renderer(host, stores).mountBlock({
    source: { yaml, sourceId: "fixture.md" }, container,
  });
  handles.push(handle);
  return { container, stores, handle };
}

function obsidianFixture() {
  const owner = new Component();
  owner.load();
  return createObsidianHost({}, owner);
}

function mountControlledTokens(yaml) {
  const requests = [];
  const host = { ...browser, highlightCode(text, language, signal) {
    return new Promise(resolve => requests.push({ text, language, signal, resolve }));
  } };
  return { ...mount(yaml, host), requests };
}

globalThis.technical = {
  afterFrames: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
  reset() {
    for (const handle of handles.splice(0)) handle.dispose();
    document.body.replaceChildren();
    document.body.className = "";
  },
  highlighted(container) {
    return Array.from(container.querySelectorAll(".kui-code-line"), (line, index) =>
      line.hasAttribute("data-highlighted") ? index + 1 : 0).filter(Boolean);
  },
  mount,
  mountGallery(markdown, width) {
    const result = markdownBlockScanner.scan(markdown, "technical.md");
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.value.map(block => mount(block.yaml, browser, width));
  },
  obsidianFixture,
  mountControlledTokens,
  prismFixture,
};
