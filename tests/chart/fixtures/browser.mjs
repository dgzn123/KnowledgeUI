import { Component } from "obsidian";
import { createBrowserHost } from "../../../src/adapters/browser/index.ts";
import { createObsidianHost } from "../../../src/adapters/obsidian/index.ts";
import { markdownBlockScanner, renderer, unwrap } from "./runtime.mjs";

const harness = {
  disconnected: 0,
  afterUpdates: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
  mount(input, useObsidianAdapter = false) {
    const host = useObsidianAdapter ? createObsidianHost({}, new Component()) : createBrowserHost();
    const container = document.body.appendChild(document.createElement("section"));
    container.className = "chart-fixture";
    const stores = [];
    const calls = [];
    const events = [];
    for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "click"]) {
      container.addEventListener(type, () => events.push(type));
    }
    const source = { yaml: typeof input === "string" ? input : JSON.stringify(input), sourceId: "fixture.md" };
    const handle = renderer(host, store => stores.push(store), (expr, x) => calls.push({ expr, x }))
      .mountBlock({ container, source });
    return { container, stores, calls, events, handle };
  },
  gallery(markdown) {
    return unwrap(markdownBlockScanner.scan(markdown)).map(({ yaml }) => this.mount(yaml));
  },
  elements(block) {
    const root = block.container;
    return {
      widget: root.querySelector(".kui-chart"),
      surface: root.querySelector(".kui-chart-surface"),
      shapes: Array.from(root.querySelectorAll(".kui-chart-shape")),
      groups: Array.from(root.querySelectorAll(".kui-chart-series")),
      marker: root.querySelector(".kui-chart-marker"),
      output: root.querySelector(".kui-chart-readout"),
      svg: root.querySelector(".kui-chart-svg"),
      clip: root.querySelector("clipPath rect"),
    };
  },
};

const OriginalResizeObserver = globalThis.ResizeObserver;
globalThis.ResizeObserver = class extends OriginalResizeObserver {
  disconnect() {
    harness.disconnected++;
    super.disconnect();
  }
};
globalThis.charts = harness;
