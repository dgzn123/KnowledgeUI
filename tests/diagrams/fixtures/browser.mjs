import { createBrowserHost } from "../../../src/adapters/browser/index.ts";
import { extensions, line, renderer, symbol } from "./runtime.mjs";

const svg = elements => ({ type: "svg", viewBox: "0 0 390 140", elements });
const numeric = initial => ({ type: "number", default: initial });
const string = initial => ({ type: "string", default: initial });
const interactive = (layout, state = {}, data = {}) => ({ type: "interactive", state, data, layout });
const stack = (...children) => ({ type: "stack", children });
const text = value => ({ type: "text", body: value });
const graphNode = (id, position, fields = {}) => ({ id, label: id.toUpperCase(), position, ...fields });

const main = interactive(stack(
  {
    ...svg([
      { kind: "clip", id: "mask", elements: [{ kind: "rect", x: 20, y: 15, width: 25, height: 22 }] },
      { kind: "rect", id: "swatch", x: 8, y: 8, width: 50, height: 36, clip: "{{clipId}}", fill: "{{shade}}", stroke: "none" },
      { kind: "circle", cx: "{{offset}}", cy: 21, r: 9, fill: "success", transition: "fast" },
      { kind: "ellipse", cx: 172, cy: 21, rx: 11, ry: 6 },
      { kind: "arrow", x1: 190, y1: 21, x2: 232, y2: 21, heads: "both" },
      { kind: "path", d: "{{pathData}}" },
      { kind: "polyline", points: "{{vertices}}" },
      { kind: "polygon", points: [{ x: "{{polygonY + 310}}", y: 9 }, { x: "{{polygonY + 324}}", y: "{{polygonY}}" }, { x: 317, y: 28 }] },
      { kind: "group", when: "shown", elements: [
        { kind: "text", x: 100, y: 50, text: "Offset {{offset}}" },
      ] },
      {
        kind: "group", repeat: { items: "positions", as: "position", index: "i" }, when: "i != 1 || shown",
        transform: [{ kind: "translate", x: "{{position}}", y: 62 }, { kind: "scale", x: 1, y: 1 },
          { kind: "rotate", degrees: 0 }],
        elements: [
          { kind: "clip", id: "mask", elements: [{ kind: "circle", cx: 20, cy: 20, r: 18 }] },
          { ...line, x2: 40, y1: 20, y2: 20, clip: "mask" },
          { ...symbol("fixture:tile"), x: 50 },
          { kind: "text", x: 0, y: 60, text: "Row {{i}} {{literal}}" },
        ],
      },
    ]),
    title: "Vector fixture",
  },
  {
    type: "graph",
    ariaLabel: "Graph fixture",
    grid: { columnWidth: 180, rowHeight: 110 },
    nodes: [
      graphNode("a", { row: 0, column: 0 }),
      graphNode("b", { x: "{{offset + 160}}", y: 0 }, { tone: "{{shade}}", label: "Node {{offset}}" }),
      graphNode("c", { row: 1, column: 2 }),
    ],
    edges: [
      { from: "a", to: "b", route: "straight", arrow: "none" },
      { from: "b", to: "c", route: "orthogonal", arrow: "both", when: "shown" },
      { from: "c", to: "a", route: "curve", tone: "warning" },
      { from: "a", to: "a", route: "curve" },
      { from: "a", to: "{{target}}", route: "curve" },
    ],
  },
  {
    type: "sequence",
    participants: ["a", "b", "c", "d"].map(id => ({ id, label: id.toUpperCase() })),
    activeStep: "{{step}}",
    messages: [
      { from: "a", to: "{{target}}", label: "A to B" },
      { from: "b", to: "b", label: "Self" },
      { from: "b", to: "c", label: "{{entry}}", repeat: { items: "labels", as: "entry", index: "i" },
        when: "i == 1 || shown", step: "{{i + 2}}" },
      { from: "c", to: "a", label: "Return", kind: "return", step: 4 },
    ],
  },
), {
  offset: numeric(90), polygonY: numeric(20), step: numeric(0), pathData: string("M 250 18 h 20"),
  shade: string("info"), clipId: string("mask"), target: string("b"), shown: { type: "boolean", default: true },
}, { vertices: [{ x: 290, y: 10 }, { x: 310, y: 24 }], positions: [5, 125, 245], labels: ["Send", "Receive"],
  literal: "<foreignObject>plain text</foreignObject>" });

function mount(component, runtimeExtensions = extensions, width = "900px") {
  const container = document.createElement("div");
  container.style.maxWidth = width;
  document.body.append(container);
  const stores = [];
  const handle = renderer(createBrowserHost(), store => stores.push(store), runtimeExtensions).mountBlock({
    source: { yaml: JSON.stringify({ version: 1, ...component }), sourceId: "diagram-fixture.md" }, container,
  });
  return { container, stores, handle };
}

let viewed;
let peer;
let saved;
let writes;
const query = selector => viewed.container.querySelector(selector);
const all = selector => [...viewed.container.querySelectorAll(selector)];
const attr = (element, key) => element.getAttribute(key);
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const diagnosticCodes = block => block.handle.diagnostics().map(d => d.code);

globalThis.diagrams = {
  setup() {
    viewed = mount(main);
    peer = mount(main);
    return [diagnosticCodes(viewed), diagnosticCodes(peer)];
  },
  identifiers() {
    const ids = [...document.querySelectorAll(".kui-svg-drawing [id]")].map(element => element.id);
    const explicit = all(".kui-svg-drawing [clip-path]").map(element => {
      const id = attr(element, "clip-path").slice(5, -1);
      const target = document.getElementById(id);
      return target?.localName === "clipPath" && target.parentNode === element.parentNode;
    });
    return {
      total: ids.length, unique: new Set(ids).size, explicit, localSymbols: all('.kui-svg-drawing svg[viewBox="0 0 40 40"]').length,
      rawTags: all(".kui-svg-drawing foreignObject, .kui-svg-drawing [href], .kui-svg-drawing script").length,
      labels: all(".kui-svg-drawing g text").map(element => element.textContent),
    };
  },
  clipHitTest() {
    const drawing = query(".kui-svg-drawing");
    function hit(x, y) {
      const point = new DOMPoint(x, y).matrixTransform(drawing.getScreenCTM());
      return document.elementFromPoint(point.x, point.y)?.localName;
    }
    return [hit(26, 26), hit(12, 12)];
  },
  clipContainerDiagnostic() {
    const block = mount(svg([
      { kind: "clip", id: "mask", elements: [{ kind: "group", transform: [{ kind: "translate", x: 10, y: 10 }],
        elements: [{ kind: "rect", x: 10, y: 10, width: 50, height: 50 }] }] },
      { kind: "rect", x: 0, y: 0, width: 100, height: 100, clip: "mask", fill: "info" },
    ]));
    const result = diagnosticCodes(block);
    block.handle.dispose();
    block.container.remove();
    return result;
  },
  routes() {
    const edges = all(".kui-graph-edge path").map(element => attr(element, "d"));
    return [
      edges.slice(0, 4).map(path => (path.match(/M /g) ?? []).length),
      edges[1], edges[2], edges[3],
      all(".kui-sequence-lifeline").map(line => Number(attr(line, "x1"))),
    ];
  },
  motion() {
    return getComputedStyle(query(".kui-svg-drawing > circle")).transitionDuration;
  },
  async update() {
    const drawing = query(".kui-svg-drawing");
    saved = {
      drawing, circle: drawing.querySelector(":scope > circle"), path: drawing.querySelector(':scope > path[d^="M 250"]'),
      polygon: drawing.querySelector("polygon"), rect: drawing.querySelector(":scope > rect"), group: drawing.querySelector(":scope > g"),
      graph: query(".kui-graph-drawing"), node: query(".kui-graph-node:nth-of-type(2)"),
      graphPath: query(".kui-graph-edge path"), seq: query(".kui-sequence-drawing"), row: query(".kui-sequence-message:nth-last-child(2)"),
    };
    writes = [];
    const observer = new MutationObserver(records => writes.push(...records));
    observer.observe(saved.circle, { attributes: true });
    observer.observe(saved.polygon, { attributes: true });
    const store = viewed.stores[0];
    for (const offset of [110, 115, 120]) store.set("offset", offset);
    store.set("step", 3);
    store.set("polygonY", 25);
    store.set("shade", "success");
    await settle();
    return {
      writes: writes.map(record => record.attributeName),
      svg: [saved.drawing === query(".kui-svg-drawing"), saved.circle === query(".kui-svg-drawing > circle"),
        attr(saved.circle, "cx"), attr(saved.polygon, "points"), getComputedStyle(saved.rect).fill],
      graph: [saved.graph === query(".kui-graph-drawing"), saved.node === query(".kui-graph-node:nth-of-type(2)"),
        attr(saved.node, "transform"), attr(saved.graphPath, "d")],
      sequence: [saved.seq === query(".kui-sequence-drawing"), saved.row === query(".kui-sequence-message[aria-current=step]"),
        query(".kui-sequence-message[aria-current=step] text").textContent],
      peer: peer.container.querySelector(".kui-svg-drawing > circle").getAttribute("cx"),
    };
  },
  async structure() {
    const store = viewed.stores[0];
    store.set("shown", false);
    await settle();
    const hidden = [saved.group.isConnected, all(".kui-svg-drawing > g").length,
      attr(query(".kui-graph-edge:nth-of-type(2)"), "display"),
      attr(query(".kui-sequence-message:nth-last-child(3)"), "display"), attr(saved.row, "transform")];
    store.set("shown", true);
    await settle();
    return {
      hidden,
      groups: all(".kui-svg-drawing > g").length,
      svgUnchanged: query(".kui-svg-drawing > circle") === saved.circle,
      graphUnchanged: query(".kui-graph-edge path") === saved.graphPath,
      sequenceUnchanged: query(".kui-sequence-message[aria-current=step]") === saved.row,
      returnDash: attr(query(".kui-sequence-message:last-child .kui-sequence-shaft"), "stroke-dasharray"),
    };
  },
  async invalidValues() {
    const store = viewed.stores[0];
    store.set("offset", -100);
    store.set("shade", "url(https://example.invalid)");
    store.set("clipId", "absent");
    store.set("pathData", "M 250 18 Z url(https://example.invalid)");
    store.set("target", "absent");
    await settle();
    const result = {
      diagnostics: diagnosticCodes(viewed),
      rect: [attr(saved.rect, "fill"), attr(saved.rect, "clip-path")],
      path: attr(saved.path, "d"),
      visibility: [attr(saved.node, "display"), attr(query(".kui-graph-edge:last-child"), "display"),
        attr(query(".kui-sequence-message:nth-last-child(5)"), "display")],
      remainingSequence: query(".kui-sequence-message[aria-current=step]") === saved.row,
    };
    store.set("offset", 130);
    store.set("shade", "info");
    store.set("clipId", "mask");
    store.set("pathData", "M 248 18 h 22");
    store.set("target", "b");
    await settle();
    result.recovered = [query(".kui-graph-node:nth-of-type(2)") === saved.node, attr(saved.node, "display"),
      attr(saved.path, "d"), attr(query(".kui-sequence-message:nth-last-child(5)"), "display")];
    return result;
  },
  budgets() {
    function repeated(length, addLine = false) {
      const rows = typeof length === "number" ? Array.from({ length }, (_, i) => i) : length;
      const budgetSvg = svg([{ ...symbol("fixture:rows"), repeat: { items: "rows", as: "row" }, when: addLine ? "false" : "row >= 0" },
        ...(addLine ? [line] : [])]);
      const block = mount(interactive(stack(budgetSvg, text("Sibling")), {}, { rows }));
      const result = [block.container.querySelectorAll(".kui-svg-drawing line").length,
        diagnosticCodes(block), block.container.querySelector(".kui-text").textContent];
      block.handle.dispose();
      block.container.remove();
      return result;
    }
    return [repeated(200), repeated(200, true), repeated(201, true), repeated("invalid", true)];
  },
  repeatDiagrams() {
    const source = interactive(stack({
      type: "graph",
      nodes: [{ id: "{{entry}}", label: "{{entry}}", position: { row: 0, column: "{{i}}" },
        repeat: { items: "entries", as: "entry", index: "i" } }],
      edges: [{ from: "a", to: "{{target}}", repeat: { items: "targets", as: "target" } }],
    }, {
      type: "sequence", participants: ["a", "b"].map(id => ({ id, label: id })),
      messages: [0, 1].map(() => ({
        from: "a", to: "b", label: "Expanded", repeat: { items: "many", as: "item" },
      })),
    }, text("Sibling")), {}, { entries: ["a", "b", "c"], targets: ["b", "c"], many: Array(101).fill(0) });
    const block = mount(source);
    const result = [
      [...block.container.querySelectorAll(".kui-graph-node")].map(element => attr(element, "transform")),
      block.container.querySelectorAll('.kui-graph-edge[display="inline"]').length,
      block.container.querySelector(".kui-sequence") === null,
      diagnosticCodes(block), block.container.querySelector(".kui-text").textContent,
    ];
    block.handle.dispose();
    block.container.remove();
    return result;
  },
  runtimeSymbols() {
    const source = stack(svg([symbol("fixture:tile")]), text("Sibling"));
    const invalid = { ...extensions, symbol: () => ({
      viewBox: "0 0 40 40", elements: [{ ...line, "xlink:href": "https://example.invalid" }],
    }) };
    return [invalid, { ...extensions, symbol: () => undefined }].map(registry => {
      const block = mount(source, registry);
      const result = [diagnosticCodes(block), block.container.querySelector(".kui-svg") === null,
        block.container.querySelector(".kui-text").textContent];
      block.handle.dispose();
      block.container.remove();
      return result;
    });
  },
  narrow() {
    viewed.container.style.maxWidth = "375px";
    const graph = query(".kui-graph-scroll");
    const sequence = query(".kui-sequence-scroll");
    const widths = [query(".kui-svg-drawing").getBoundingClientRect().width, graph.clientWidth, sequence.clientWidth];
    const scroll = [graph.scrollWidth > graph.clientWidth, sequence.scrollWidth > sequence.clientWidth];
    graph.focus();
    const focus = document.activeElement === graph;
    const light = getComputedStyle(saved.rect).fill;
    viewed.container.classList.add("theme-dark");
    const dark = getComputedStyle(saved.rect).fill;
    viewed.container.classList.remove("theme-dark");
    return { widths, scroll, focus, light, dark, outer: viewed.container.scrollWidth };
  },
  async dispose() {
    const store = viewed.stores[0];
    store.set("offset", 150);
    viewed.handle.dispose();
    viewed.handle.dispose();
    await settle();
    return [viewed.container.childElementCount, attr(saved.circle, "cx"), store.set("offset", 160).diagnostics[0].code,
      peer.container.querySelector(".kui-svg-drawing > circle").isConnected];
  },
};
