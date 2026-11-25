import gallery from "../../../examples/extensions/gallery.md";
import { createBrowserHost } from "../../../src/adapters/browser/index.ts";
import { bindingFactory } from "../../../src/core/expression/index.ts";
import { markdownBlockScanner } from "../../../src/core/protocol/index.ts";
import { createComponentRegistry } from "../../../src/core/registry/index.ts";
import { createBlockRenderer } from "../../../src/core/renderer/index.ts";
import { stateFactory } from "../../../src/core/state/index.ts";
import { createTemplateExpander } from "../../../src/core/templates/index.ts";
import { extensionFixture, unwrap } from "./protocol.mjs";

const numeric = { type: "number" };
const innerCall = (name, params = {}) => ({ type: "template", name: "fixture:" + name, params });
const extra = { namespace: "fixture", version: "1.0.0", protocolVersion: 1, templates: {
  outer: { parameters: { seed: numeric }, body: {
    type: "interactive",
    title: "Seed {{seed}} · Value {{shifted}}",
    state: { row: { type: "number", default: 7 } },
    computed: { shifted: "seed + row" },
    layout: { type: "stack", children: [
      { type: "number-input", bind: "row" }, innerCall("inner", { total: "{{shifted}}" }),
    ] },
  } },
  inner: { parameters: { total: numeric }, body: { type: "metric", label: "Inner", value: "{{total}}" } },
  "cycle-a": { parameters: {}, body: innerCall("cycle-b") },
  "cycle-b": { parameters: {}, body: innerCall("cycle-a") },
  "retry-body": { parameters: { seed: numeric }, body: {
    type: "interactive",
    computed: { value: "seed < 10 ? 1 / 0 : seed" },
    layout: { type: "metric", label: "Value", value: "{{value}}" },
  } },
} };

const { protocol, extensions, registrations } = extensionFixture([extra]);
const registry = createComponentRegistry();
for (const registration of registrations) unwrap(registry.register(registration));
const templates = createTemplateExpander(extensions, protocol);
const stores = [];
const renderer = createBlockRenderer({
  registry, protocol, extensions, templates, bindings: bindingFactory, host: createBrowserHost(),
  state: { create(...args) {
    const result = stateFactory.create(...args);
    if (result.ok) stores.push(result.value);
    return result;
  } },
});

const scenarios = [];
const test = (name, run) => scenarios.push({ name, run });
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => { await frame(); await frame(); await frame(); };
const all = (parent, selector) => [...parent.querySelectorAll(selector)];
const values = target => all(target, ".kui-metric-value").map(node => node.textContent);
const titles = target => all(target, ".kui-interactive-title").map(node => node.textContent);
const templatesIn = target => all(target, ".kui-template");
const codes = mounted => mounted.diagnostics().map(item => item.code);

function same(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function mount(source) {
  const target = document.body.appendChild(document.createElement("main"));
  const firstStore = stores.length;
  const block = renderer.mountBlock({ source, container: target });
  return { target, block, store: index => stores[firstStore + index], storeCount: () => stores.length - firstStore };
}

function change(input, value) {
  input.value = String(value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const sources = unwrap(markdownBlockScanner.scan(gallery, "examples/extensions/gallery.md"));

test("gallery parameter changes replace one subtree and keep siblings, outer controls and focus", async () => {
  const { target, block, store, storeCount } = mount(sources[0]);
  const [first, second] = templatesIn(target);
  const firstBody = first.firstElementChild;
  const secondBody = second.firstElementChild;
  const slider = target.querySelector('input[type="range"]');
  const secondInput = second.querySelector("input");
  same(titles(target), ["初始值 3 · 3", "调整值 · 8"]);
  same(values(target), ["3", "3", "8"]);
  same(first.getAttribute("aria-label"), "随滑块变化的实例");

  change(first.querySelector("input"), 5);
  change(secondInput, 2);
  await settle();
  same(values(target), ["3", "8", "10"]);
  if (first.firstElementChild !== firstBody || second.firstElementChild !== secondBody) throw new Error("Body remounted after internal input.");

  secondInput.focus();
  slider.value = "6";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  same(store(0).get("baseline"), 6);
  same(titles(target), ["初始值 6 · 6", "调整值 · 10"]);
  same(values(target), ["6", "6", "10"]);
  same(storeCount(), 4);
  same(store(1).set("offset", 1).diagnostics[0].code, "state.disposed");
  same(store(2).get("offset"), 2);
  if (firstBody.isConnected || second.firstElementChild !== secondBody
    || slider !== target.querySelector('input[type="range"]') || document.activeElement !== secondInput
    || templatesIn(target)[0] !== first) throw new Error("An update changed unrelated nodes, the template wrapper, or focus.");
  same(codes(block), []);

  unwrap(store(0).set("baseline", 7));
  block.dispose();
  block.dispose();
  await settle();
  same(target.childElementCount, 0);
  same(storeCount(), 4);
  target.remove();
});

test("unchanged arguments retain state and an invalid binding recovers locally", async () => {
  const { target, block, store, storeCount } = mount({ sourceId: "recover.md", yaml: `version: 1
type: interactive
state:
  amount: {type: number, default: 2}
layout:
  type: stack
  children:
    - type: template
      name: common:adjustable-value
      params:
        seed: "{{amount < 0 ? 'invalid' : floor(amount / 2)}}"
    - type: text
      body: Adjacent
` });
  const root = templatesIn(target)[0];
  const body = root.firstElementChild;
  const sibling = all(target, ".kui-text")[0];
  change(root.querySelector("input"), 3);
  unwrap(store(0).set("amount", 3));
  await settle();
  same(values(target), ["1", "4"]);
  same(storeCount(), 2);
  if (root.firstElementChild !== body) throw new Error("Body remounted for an unchanged parameter.");

  unwrap(store(0).set("amount", -1));
  await settle();
  same(root.childElementCount, 0);
  const [error] = block.diagnostics();
  same([error.code, error.sourceId, error.range.start.line, error.path],
    ["extension.parameter-type", "recover.md", 11, ["layout", "children", 0, "params", "seed"]]);

  unwrap(store(0).set("amount", 8));
  await settle();
  same(values(target), ["4", "4"]);
  same(storeCount(), 3);
  if (all(target, ".kui-text")[0] !== sibling || templatesIn(target)[0] !== root) throw new Error("Recovery changed an unrelated node.");
  block.dispose();
  target.remove();
});

test("repeat aliases and when are scoped to the call, with nested expansion and distinct inner models", async () => {
  const { target, block, store } = mount({ yaml: `version: 1
type: interactive
data:
  rows: [{show: true, seed: 3}, {show: false, seed: 6}, {show: true, seed: 8}]
layout:
  type: template
  repeat: {items: rows, as: item, index: row}
  when: "item.show && row != 1"
  name: fixture:outer
  params: {seed: "{{item.seed}}"}
` });
  same(codes(block), []);
  same(titles(target), ["Seed 3 · Value 10", "Seed 8 · Value 15"]);
  same(values(target), ["10", "15"]);
  same(store(1).get("row"), 7);
  same(store(2).get("row"), 7);
  change(target.querySelector("input"), 9);
  await settle();
  same(titles(target), ["Seed 3 · Value 12", "Seed 8 · Value 15"]);
  same(values(target), ["12", "15"]);
  block.dispose();
  target.remove();
});

test("mounting indirect recursion stops at the ancestor match and keeps siblings", () => {
  const { target, block } = mount({ yaml: `version: 1
type: stack
children:
  - {type: template, name: "fixture:cycle-a"}
  - {type: text, body: Reached sibling}
` });
  same(codes(block), ["extension.template-cycle"]);
  same(templatesIn(target).length, 3);
  same(target.querySelector(".kui-text-content").textContent, "Reached sibling");
  block.dispose();
  target.remove();
});

test("SVG directory fixture receives all five static symbol definitions through the runtime", () => {
  const { target, block } = mount(sources[1]);
  same(codes(block), []);
  same(all(target, "[data-symbol]").map(entry => [entry.dataset.symbol, Number(entry.textContent)]), [
    ["electronics:resistor", 1], ["electronics:capacitor", 4], ["electronics:mosfet", 9],
    ["electronics:op-amp", 7], ["electronics:ground", 4],
  ]);
  block.dispose();
  target.remove();
});

test("released failed roots leave room for all repeated templates to recover", async () => {
  const { target, block, store } = mount({ yaml: JSON.stringify({
    version: 1,
    type: "interactive",
    state: { seed: { type: "number", default: 0 } },
    data: { items: Array(200).fill(0) },
    layout: { ...innerCall("retry-body", { seed: "{{seed}}" }), repeat: { items: "items", as: "item" } },
  }) });
  try {
    for (let seed = 1; seed <= 10; seed++) {
      unwrap(store(0).set("seed", seed));
      await settle();
    }
    same(values(target).length, 200);
  } finally {
    block.dispose();
    target.remove();
  }
});

async function run() {
  const results = [];
  for (const { name, run } of scenarios) {
    try {
      await run();
      results.push({ name });
    } catch (error) {
      results.push({ name, error: error.stack });
    }
  }
  globalThis.extensionResults = results;
}

void run();
