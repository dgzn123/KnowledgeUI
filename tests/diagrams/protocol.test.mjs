import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { extensions, line, protocol, protocolWith, symbol } from "./fixtures/runtime.mjs";

const svg = (elements, viewBox = "0 0 120 80") => ({ type: "svg", viewBox, elements });
const path = d => ({ kind: "path", d });
const read = (component, reader = protocol) => reader.read({ yaml: JSON.stringify({ version: 1, ...component }), sourceId: "fixture.md" });
const errors = (component, reader) => {
  const result = read(component, reader);
  assert.equal(result.ok, false);
  return result.diagnostics.map(({ code, path }) => [code, path]);
};
const graph = (nodes, edges = []) => ({ type: "graph", nodes, edges });
const node = (id, x, y) => ({ id, label: id, position: { x, y } });
const sequence = (messages, ids = ["one", "two"]) => ({
  type: "sequence", messages, participants: ids.map(id => ({ id, label: id })),
});
const message = (from, to) => ({ from, to, label: "Transfer" });

test("the injected catalog accepts all three Gallery fences and the frozen local expression pointers", async () => {
  const markdown = await readFile(new URL("../../examples/gallery/diagrams.md", import.meta.url), "utf8");
  const blocks = markdownBlockScanner.scan(markdown);
  assert.ok(blocks.ok);
  assert.equal(blocks.value.length, 3);
  for (const block of blocks.value) {
    const result = protocol.read(block);
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
  }
  const result = read({
    type: "interactive", data: { points: [{ x: 3 }] },
    layout: svg([{ ...line, repeat: { items: "points", as: "point", index: "i" }, when: "i == 0", x2: "{{point.x}}" }]),
  });
  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result.value.root.slots["/layout"][0].expressions),
    ["/elements/0/repeat/items", "/elements/0/when"]);
});

test("SVG accepts complete standard path commands and rejects malformed or non-finite geometry", () => {
  for (const d of [
    "M0 0L24 8h7v-3C7 5 9 3 12 1S16 3 19 5Q21 7 25 9T32 11 a4 5 30 01-8 2Z",
    "m.1.2 1.2e1-.4L5,2z M 4 5 5 6",
    "M 1 2 A 1 2 0 0 1 3 4",
  ]) assert.ok(read(svg([path(d)])).ok, d);
  for (const d of [
    "", "L0 0", "M0 0L", "M0 0L5", "M,0 0", "M0 0,", "M0 0,,1 1", "M0 0Z4 5",
    "M0 0A4 4 0 2 0 8 8", "M0 0A-4 4 0 0 0 8 8", "M0 0 L1e100 0", "M0 0L1e 2",
    "M0 0 R4 5", "M0 0<script>", "M0 0 url(https://example.invalid)",
  ]) assert.deepEqual(errors(svg([path(d)])), [["semantic.svg-value", ["elements", 0, "d"]]], d);
  assert.deepEqual(errors(svg([line], "0 0 0 80")), [["semantic.svg-view-box", ["viewBox"]]]);
  assert.deepEqual(errors(svg([{ ...line, x2: 1e100 }])), [["semantic.svg-value", ["elements", 0, "x2"]]]);
});

test("closed SVG fields reject foreign elements, raw style, links, events and unknown transforms", () => {
  for (const element of [
    { kind: "foreignObject", elements: [line] }, { kind: "script" }, { ...line, onload: "fixture" },
    { ...line, href: "https://example.invalid" }, { ...line, "xlink:href": "fixture" }, { ...line, style: "fill: none" },
    { ...line, fill: "url(#clip)" }, { ...line, transform: [{ kind: "matrix", x: 1, y: 1 }] },
    { ...line, points: [{ x: 1, y: 1 }] }, { ...line, clip: "url(#clip)" },
    { ...line, id: "constructor" }, { ...symbol("unqualified") }, { ...line, x2: "24" },
  ]) assert.match(errors(svg([element]))[0][0], /^schema\./);
});

test("SVG local clips resolve forward within a scope, with duplicate and cross-scope diagnostics", () => {
  const clip = { kind: "clip", id: "mask", elements: [{ kind: "rect", x: 0, y: 0, width: 12, height: 12 }] };
  assert.ok(read(svg([{ ...line, clip: "mask" }, clip])).ok);
  assert.deepEqual(errors(svg([clip, { ...line, id: "mask" }])), [["semantic.svg-duplicate-id", ["elements", 1, "id"]]]);
  assert.deepEqual(errors(svg([{ ...line, clip: "mask" }, { ...line, id: "mask" }])), [["semantic.svg-clip-target", ["elements", 0, "clip"]]]);
  assert.deepEqual(errors(svg([{ ...line, clip: "mask" }, symbol("fixture:tile")])), [["semantic.svg-clip-target", ["elements", 0, "clip"]]]);
  const result = read(svg([{ ...line, clip: "missing" }]));
  assert.equal(result.diagnostics[0].sourceId, "fixture.md");
  assert.ok(result.diagnostics[0].range.start.column > 1);
});

test("symbols use the frozen structure, isolate their IDs and reject missing, recursive and unsafe definitions", () => {
  assert.ok(read(svg([symbol("fixture:tile"), symbol("fixture:tile")])).ok);
  for (const [id, diagnostic] of [
    ["absent", "svg-symbol-missing"], ["bad", "svg-symbol-invalid"], ["cycle", "svg-symbol-cycle"],
    ["dynamic", "svg-symbol-invalid"], ["zero", "svg-view-box"],
  ]) assert.equal(errors(svg([symbol("fixture:" + id)]))[0][0], "semantic." + diagnostic);
});

test("static expansion enforces the exact SVG element and depth boundaries", () => {
  const symbols = Array.from({ length: 200 }, () => symbol("fixture:rows"));
  assert.ok(read(svg(symbols)).ok);
  assert.equal(errors(svg([...symbols, line]))[0][0], "semantic.svg-element-limit");
  const reader = protocolWith({ ...extensions, symbol(id) {
    const remaining = Number(id.slice("fixture:depth-".length));
    return { viewBox: "0 0 40 40", elements: [remaining ? symbol("fixture:depth-" + (remaining - 1)) : line] };
  } });
  assert.ok(read(svg([symbol("fixture:depth-22")]), reader).ok);
  assert.equal(errors(svg([symbol("fixture:depth-23")]), reader)[0][0], "semantic.svg-depth-limit");
});

test("Graph checks bounds and topology while preserving frozen coordinate and routing choices", () => {
  assert.ok(read(graph([node("one", -132, 0), node("two", 0, 0)], [
    { from: "one", to: "two", route: "straight", arrow: "none" },
    { from: "one", to: "one", route: "curve", arrow: "both" },
    { from: "two", to: "one", route: "orthogonal", arrow: "end" },
  ])).ok);
  assert.deepEqual(errors(graph([node("one", 0, 0), node("two", 80, 26)], [{ from: "two", to: "absent" }])), [
    ["semantic.graph-overlap", ["nodes", 1, "position"]], ["semantic.graph-endpoint", ["edges", 0, "to"]],
  ]);
  assert.deepEqual(errors(graph([node("one", 0, 0), node("one", 200, 0)])),
    [["semantic.graph-duplicate-id", ["nodes", 1, "id"]]]);
  for (const invalid of [
    graph([node("one", 0, 0)], [{ from: "one", to: "one", route: "automatic" }]),
    graph([node("one", 0, 0)], [{ from: "one", to: "one", arrow: "start" }]),
    graph([{ ...node("one", 0, 0), position: { row: 129, column: 0 } }]),
  ]) assert.match(errors(invalid)[0][0], /^schema\./);
  assert.equal(errors(graph([node("one", 1e20, 0)]))[0][0], "semantic.graph-geometry");
});

test("Sequence rejects unknown endpoints, duplicate participants and non-integer steps", () => {
  assert.ok(read(sequence([message("one", "one"), { ...message("two", "one"), step: 4, kind: "return" }])).ok);
  assert.deepEqual(errors(sequence([message("one", "three")])), [["semantic.sequence-endpoint", ["messages", 0, "to"]]]);
  assert.deepEqual(errors(sequence([message("one", "one")], ["one", "one"])),
    [["semantic.sequence-duplicate-id", ["participants", 1, "id"]]]);
  assert.match(errors({ ...sequence([message("one", "two")]), activeStep: 1.5 })[0][0], /^schema\./);
});
