import { Component } from "obsidian";
import { createBrowserHost } from "../../../src/adapters/browser/index.ts";
import { createObsidianHost } from "../../../src/adapters/obsidian/index.ts";
import { protocol, renderer } from "./runtime.mjs";

function mount(yaml, host = createBrowserHost()) {
  const container = document.createElement("div");
  document.body.append(container);
  const stores = [];
  const handle = renderer(host, store => stores.push(store)).mountBlock({ source: { yaml }, container });
  return { container, stores, handle };
}

globalThis.controls = {
  afterFrame: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  setup(yaml) {
    const owner = new Component();
    owner.load();
    this.first = mount(yaml, createObsidianHost({}, owner));
    this.second = mount(yaml);
    this.hostEvents = [];
    for (const event of ["pointerdown", "pointerup", "touchstart", "touchend", "click"]) {
      this.first.container.addEventListener(event, () => this.hostEvents.push(event));
    }
  },
  mount,
  protocol,
};
