import { Component, prismFixture } from "obsidian";
import { v1ComponentSchema } from "#protocol-schema";
import { createBrowserHost } from "../../../src/adapters/browser/index.ts";
import { createObsidianHost } from "../../../src/adapters/obsidian/index.ts";
import { basicRegistrations } from "../../../src/components/basic/index.ts";
import { controlRegistrations } from "../../../src/components/controls/index.ts";
import { bindingFactory, expressionEngine } from "../../../src/core/expression/index.ts";
import { createProtocolCatalog, createProtocolReader, yamlReader } from "../../../src/core/protocol/index.ts";
import { createComponentRegistry } from "../../../src/core/registry/index.ts";
import { createBlockRenderer } from "../../../src/core/renderer/index.ts";
import { stateFactory } from "../../../src/core/state/index.ts";

function unwrap(result) {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

// Mount fixture for the template service due in Agent 08. All other services are real.
const body = {
  type: "stack",
  children: [
    { type: "metric", label: "Seed", value: "{{seed}}" },
    { type: "interactive", title: "Seed {{seed}} · Value {{adjusted}}",
      state: { row: { type: "number", default: 7 } }, computed: { adjusted: "row + seed" },
      layout: { type: "stack", children: [
        { type: "number-input", bind: "row" },
        { type: "template", name: "fixture:inner", params: { total: "{{adjusted}}" } },
      ] } },
  ],
};

function templateScope() {
  const observed = [];
  const template = {
    definition: v1ComponentSchema("template"),
    mount({ node, container, context }) {
      const root = container.appendChild(document.createElement("div"));
      observed.push([...context.templateAncestry]);
      const id = node.props.name;
      const params = Object.fromEntries(Object.entries(node.props.params).map(([name, value]) => [name,
        unwrap(context.bindings.resolve({ value, source: node.source, expected: "number", accepts: Number.isFinite }))]));
      const expanded = unwrap(context.templates.expand({ id, params, source: node.source, ancestry: context.templateAncestry }));
      unwrap(context.mountChild(expanded.node, root, {
        templateLocals: expanded.locals, templateAncestry: expanded.ancestry,
      }));
      return { ok: true, value: { root, dispose: () => root.remove() }, diagnostics: [] };
    },
  };
  const registrations = [...basicRegistrations, ...controlRegistrations, template];
  const registry = createComponentRegistry();
  for (const registration of registrations) unwrap(registry.register(registration));
  const catalog = unwrap(createProtocolCatalog(registrations.map(({ definition }) => definition)));
  const protocol = createProtocolReader({ catalog, yaml: yamlReader, expressions: expressionEngine });
  const templates = {
    expand({ id, params, ancestry }) {
      const value = id === "fixture:outer" ? body : { type: "metric", label: "Inner", value: "{{total}}" };
      const result = protocol.readNode({ value, locate: () => undefined }, { locals: new Set(Object.keys(params)) });
      return result.ok ? { ...result, value: { node: result.value, locals: params, ancestry: [...ancestry, id] } } : result;
    },
  };

  const hiddenAlias = protocol.readNode({ value: {
    ...body.children[1], computed: { adjusted: "item + seed" },
  }, locate: () => undefined }, { locals: new Set(["seed"]) });
  const stores = [];
  const renderer = createBlockRenderer({
    registry, protocol, templates, host: createBrowserHost(), bindings: bindingFactory,
    state: { create(...args) { const result = stateFactory.create(...args); stores.push(result.value); return result; } },
  });
  const container = document.createElement("div");
  const handle = renderer.mountBlock({ container, source: { yaml: `version: 1
type: interactive
data:
  rows: [{show: true, seed: 3}, {show: false, seed: 6}, {show: true, seed: 8}]
layout:
  type: template
  repeat: {items: rows, as: item, index: row}
  when: "item.show && row != 1"
  name: fixture:outer
  params: {seed: "{{item.seed}}"}
` } });
  const result = {
    diagnostics: handle.diagnostics(), observed,
    values: [...container.querySelectorAll(".kui-metric-value")].map(node => node.textContent),
    titles: [...container.querySelectorAll(".kui-interactive-title")].map(node => node.textContent),
    templateState: stores.slice(1).map(store => store.snapshot()),
    staticDiagnostics: hiddenAlias.diagnostics.map(({ code, path }) => [code, path]),
  };
  unwrap(stores[1].set("row", 12));
  result.secondInstance = stores[2].get("adjusted");
  handle.dispose();
  result.disposed = container.childElementCount === 0;
  return result;
}

async function hostHighlight() {
  const host = createObsidianHost({}, new Component());
  const controller = new AbortController();
  const grammar = {};
  prismFixture.load = async () => ({ languages: { js: grammar }, tokenize: code => [
    { type: "template-string", content: [{ type: "string", alias: ["literal", "bad alias"], content: code.slice(0, 6) }] },
    code.slice(6),
  ] });
  const code = "<b>`x`\nreturn 1";
  const tokens = await host.highlightCode(code, "js", controller.signal);
  const unknown = await host.highlightCode(code, "constructor", controller.signal);
  const request = host.highlightCode(code, "js", controller.signal);
  controller.abort();
  return { tokens, unknown: unknown ?? null, cancelled: (await request) ?? null, browser: Boolean(createBrowserHost().highlightCode) };
}

async function run() {
  let result;
  try {
    result = { template: templateScope(), highlight: await hostHighlight() };
  } catch (error) {
    result = { error: error.stack };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  document.body.textContent = btoa(String.fromCharCode(...bytes));
}

void run();
