import { Component, MarkdownRenderer } from "obsidian";
import { V1_LIMITS } from "#contracts";
import { createKnowledgeUiPlugin } from "../../../src/main.ts";
import { createBlockRenderer } from "../../../src/core/renderer/index.ts";
import { createComponentRegistry } from "../../../src/core/registry/index.ts";
import { createLifetime } from "../../../src/core/renderer/lifetime.ts";
import { createBrowserHost } from "../../../src/adapters/browser/index.ts";
import { createObsidianHost } from "../../../src/adapters/obsidian/index.ts";
import { mountPreview } from "../../../preview/index.ts";
import { createFixtureRenderer, fixtureNode, fixtureRegistration, ok } from "./components.mjs";

function expect(value, message) {
  if (!value) throw new Error(message);
}

const target = () => document.createElement("div");
const wait = () => new Promise((resolve) => setTimeout(resolve, 60));

function runtime(root, registrations, overrides = {}) {
  const registry = createComponentRegistry();
  for (const registration of registrations) expect(registry.register(registration).ok, "registration failed");
  return createBlockRenderer({
    registry,
    host: createBrowserHost(),
    protocol: {
      read: () => ok({ version: 1, root }),
      readNode: () => { throw new Error("unused fixture operation"); },
    },
    ...overrides,
  });
}

export async function treeAndCleanup() {
  const resources = { listeners: 0, observers: 0, subscriptions: 0, intervals: 0, component: 0 };
  const eventTarget = new EventTarget();
  const subscribe = () => { resources.subscriptions++; return () => resources.subscriptions--; };
  const ids = new Set();
  let seenInOtherDocument = false;
  const leaf = fixtureRegistration("leaf", ({ node, container, context }) => {
    const root = container.ownerDocument.createElement("button");
    seenInOtherDocument ||= root.ownerDocument !== document;
    expect(!ids.has(context.instanceId), "duplicate instance ID");
    ids.add(context.instanceId);
    root.textContent = node.props.label ?? "leaf";
    container.append(root);
    const listener = () => { resources.listeners++; };
    eventTarget.addEventListener("fixture", listener);
    context.lifetime.add(() => eventTarget.removeEventListener("fixture", listener));
    const observer = new ResizeObserver(() => {});
    observer.observe(root);
    resources.observers++;
    context.lifetime.add(() => { observer.disconnect(); resources.observers--; });
    context.lifetime.add(subscribe());
    const timer = setInterval(() => { resources.intervals++; }, 2);
    context.lifetime.add(() => clearInterval(timer));
    context.lifetime.add(() => { throw new Error("cleanup isolation fixture"); });
    if (node.props.fail) throw new Error("mount isolation fixture");
    return ok({ root, dispose: () => { resources.component++; } });
  });
  const stack = fixtureRegistration("stack", ({ node, container, context }) => {
    const root = container.ownerDocument.createElement("div");
    container.append(root);
    for (const child of node.slots["/children"]) {
      const result = context.mountChild(child, root);
      for (const item of result.diagnostics) context.report(item);
    }
    return ok({ root, dispose() {} });
  });
  const tree = fixtureNode("stack", { slots: { "/children": [
    fixtureNode("leaf", { props: { label: "first" }, ariaLabel: "first control" }),
    fixtureNode("leaf", {
      props: { label: "failed leaf", fail: true },
      source: { path: ["children", 1], range: { start: { line: 7, column: 3, offset: 19 }, end: { line: 7, column: 7, offset: 23 } } },
    }),
    fixtureNode("leaf", { props: { label: "last" } }),
  ] } });
  const doc = document.implementation.createHTMLDocument();
  const container = doc.body;
  const existing = doc.createElement("p");
  container.append(existing);
  const renderer = runtime(tree, [stack, leaf]);
  const mount = renderer.mountBlock({ container, source: { yaml: "fixture", sourceId: "note.md" } });
  expect(seenInOtherDocument, "ownerDocument not used");
  expect([...container.querySelectorAll("button")].map((child) => child.textContent).join() === "first,last", "failed child affected siblings");
  expect(container.querySelector("button").getAttribute("aria-label") === "first control", "aria label missing");
  expect(mount.diagnostics().length === 1, "failure was not isolated or was double reported");
  expect(mount.diagnostics()[0].sourceId === "note.md", "source ID missing");
  expect(container.textContent.includes("$.children[1] · 7:3"), "diagnostic path and source range missing");
  expect(resources.observers === 2 && resources.subscriptions === 2, "failed child leaked resources");
  eventTarget.dispatchEvent(new Event("fixture"));
  expect(resources.listeners === 2, "failed child leaked listener");

  mount.dispose();
  mount.dispose();
  const timerCount = resources.intervals;
  eventTarget.dispatchEvent(new Event("fixture"));
  await wait();
  expect(resources.listeners === 2 && resources.observers === 0 && resources.subscriptions === 0, "dispose leaked resources");
  expect(resources.intervals === timerCount && resources.component === 2, "timer or component cleanup failed");
  expect(container.firstChild === existing && container.childNodes.length === 1, "dispose altered unrelated DOM");
}

export function failuresAndLimits() {
  const container = target();
  const leaf = fixtureRegistration("leaf", ({ container }) => {
    const root = container.ownerDocument.createElement("p");
    container.append(root);
    return ok({ root, dispose() {} });
  });
  const group = fixtureRegistration("group", ({ node, container, context }) => {
    const root = container.ownerDocument.createElement("div");
    container.append(root);
    for (const child of node.slots["/children"]) context.mountChild(child, root);
    return ok({ root, dispose() {} });
  });
  let deep = fixtureNode("leaf");
  for (let index = 0; index < V1_LIMITS.componentDepth; index++) {
    deep = fixtureNode("group", { slots: { "/children": [deep] } });
  }
  const renderer = runtime(fixtureNode("group", { slots: { "/children": [deep, fixtureNode("leaf")] } }), [leaf, group]);
  const block = renderer.mountBlock({ container, source: { yaml: "" } });
  expect(block.diagnostics()[0]?.code === "render.depth-limit" && container.querySelectorAll("p").length === 1, "depth limit affected sibling");
  block.dispose();

  const wide = fixtureNode("group", { slots: { "/children": Array.from(
    { length: V1_LIMITS.componentInstances }, () => fixtureNode("leaf"),
  ) } });
  const instanceLimit = runtime(wide, [leaf, group]).mountBlock({ container, source: { yaml: "" } });
  expect(instanceLimit.diagnostics()[0]?.code === "render.instance-limit", "instance limit was not enforced");
  expect(container.querySelectorAll("p").length === V1_LIMITS.componentInstances - 1, "instance limit changed the admitted siblings");
  instanceLimit.dispose();

  const report = fixtureRegistration("report", ({ container, context }) => {
    const root = container.ownerDocument.createElement("div");
    container.append(root);
    for (let index = 0; index <= V1_LIMITS.diagnostics; index++) {
      context.report({ phase: "render", code: "render.fixture", severity: "warning", message: "warning", path: [index] });
    }
    return ok({ root, dispose() {} });
  });
  const limited = runtime(fixtureNode("report"), [report]).mountBlock({ container, source: { yaml: "" } });
  expect(limited.diagnostics().length === V1_LIMITS.diagnostics, "diagnostic count exceeded");
  expect(limited.diagnostics().at(-1).code === "render.diagnostics-truncated", "truncation is missing");
  limited.dispose();

  const protocol = {
    read(source) {
      if (source.yaml === "throws") throw new Error("reader error");
      return { ok: false, diagnostics: [{ phase: "yaml", code: "yaml.fixture", severity: "error", message: "invalid YAML", path: [] }] };
    },
  };
  const failRenderer = runtime(fixtureNode("leaf"), [leaf], { protocol });
  const thrown = failRenderer.mountBlock({ container, source: { yaml: "throws" } });
  const invalid = failRenderer.mountBlock({ container, source: { yaml: "malformed" } });
  expect(thrown.diagnostics()[0]?.code === "render.block-failed", "uncaught reader exception");
  expect(invalid.diagnostics()[0]?.code === "yaml.fixture", "reader diagnostic lost");
  expect(container.querySelectorAll(".kui-block").length === 2, "one block removed another");
  thrown.dispose();
  invalid.dispose();
}

export function scopedBindings() {
  const container = target();
  const subscribers = new Set();
  let visible = true;
  let disposedStores = 0;
  const expressions = {};
  function bindings(store, locals = {}) {
    return {
      expressions,
      withLocals: (additional) => bindings(store, { ...locals, ...additional }),
      snapshot: () => ({ ...store?.snapshot(), ...locals }),
      evaluate: (expression) => ok(expression.source === "items" ? ["one", "two"] : visible),
      observeExpression(_expression, notify) {
        subscribers.add(notify);
        notify(ok(visible));
        return { dispose: () => subscribers.delete(notify) };
      },
    };
  }
  const rootModel = { state: {}, data: {}, computed: {} };
  const leaf = fixtureRegistration("leaf", ({ container, node, context }) => {
    expect(context.state !== undefined, "state was not injected");
    const root = container.ownerDocument.createElement("span");
    root.textContent = context.bindings.snapshot().item ?? node.props.label;
    root.id = context.instanceId;
    container.append(root);
    return ok({ root, dispose() {} });
  });
  const group = fixtureRegistration("group", ({ container, node, context }) => {
    const root = container.ownerDocument.createElement("div");
    container.append(root);
    for (const child of node.slots["/children"]) context.mountChild(child, root);
    return ok({ root, dispose() {} });
  });
  const condition = { source: "visible", location: { path: ["when"] } };
  const tree = fixtureNode("group", { model: rootModel, slots: { "/children": [
    fixtureNode("leaf", { props: { label: "before" } }),
    fixtureNode("leaf", { when: condition, repeat: { items: { source: "items" }, as: "item", index: "i" } }),
    fixtureNode("leaf", { props: { label: "after" } }),
  ] } });
  const renderer = runtime(tree, [group, leaf], {
    bindings: { create: bindings },
    state: { create: (model) => {
      expect(model === rootModel, "state model changed");
      return ok({ snapshot: () => ({}), dispose: () => { disposedStores++; } });
    } },
  });
  const mounted = renderer.mountBlock({ container, source: { yaml: "" } });
  const original = [...container.querySelectorAll("span")];
  expect(original.map((element) => element.textContent).join() === "before,one,two,after", "repeat item order incorrect");
  visible = false;
  for (const notify of subscribers) notify(ok(visible));
  expect(container.querySelectorAll("span").length === 2, "conditional nodes remained mounted");
  visible = true;
  for (const notify of subscribers) notify(ok(visible));
  const updated = [...container.querySelectorAll("span")];
  expect(updated[0] === original[0] && updated[3] === original[3], "condition remounted siblings");
  expect(updated[1].id !== original[1].id && updated[2].id !== updated[1].id, "repeat IDs collided");
  mounted.dispose();
  expect(subscribers.size === 0 && disposedStores === 1, "dynamic resources leaked");
}

export async function markdownAndPlugin() {
  const app = {
    metadataCache: {
      getFirstLinkpathDest: (path) => ({
        "image.png": { extension: "png", path: "images/image.png" },
        "note.md": { extension: "md", path: "note.md" },
      })[path] ?? null,
    },
  };
  const owner = new Component();
  owner.load();
  const container = target();
  const lifetime = createLifetime();
  const host = createObsidianHost(app, owner);
  let complete;
  let sourcePath;
  let nativeInput;
  let released = 0;
  MarkdownRenderer.render = (_app, input, root, source, resources) => {
    nativeInput = input;
    sourcePath = source;
    resources.register(() => { released++; });
    return new Promise((resolve) => {
      complete = () => {
        root.textContent = "stale";
        resources.register(() => { released++; });
        resolve();
      };
    });
  };
  const pending = host.renderMarkdown({
    container, lifetime, sourceId: "folder/note.md",
    markdown: [
      "# Heading", "[[note.md]] ![[image.png]] ![[note.md]]", "Formula $\\frac{1}{2}$",
      "<img src='https://example.invalid/a'> ![Remote](https://example.invalid/b)",
      "[Custom](obsidian://open) [Web](https://example.invalid/)",
      "~".repeat(3) + "kui", "type: section", "~".repeat(3),
    ].join("\n"),
  });
  expect(nativeInput.includes("[[note.md]]") && nativeInput.includes("![[images/image.png]]"), "native link or authorized raster embed missing");
  expect(nativeInput.includes("$\\frac{1}{2}$"), "native math missing");
  expect(!nativeInput.includes("![[note.md]]") && !nativeInput.includes("<img") && !nativeInput.includes("![Remote]")
    && !nativeInput.includes("obsidian://") && !nativeInput.includes("example.invalid/b") && !nativeInput.includes("~~~kui"), "unsafe native Markdown crossed the boundary");
  expect(sourcePath === "folder/note.md" && container.childNodes.length === 0, "source path missing or async content attached early");
  lifetime.dispose();
  expect(released === 1 && owner.children.size === 0, "in-flight Markdown resources not cancelled");
  expect((await pending).ok, "adapter awaited native completion after cancellation");
  complete();
  await Promise.resolve();
  expect(released === 2 && container.childNodes.length === 0, "late async resources or DOM leaked");

  const successful = createLifetime();
  MarkdownRenderer.render = async (_app, _input, root, _source, resources) => {
    root.textContent = "native";
    resources.register(() => { released++; });
  };
  expect((await host.renderMarkdown({ container, lifetime: successful, markdown: "ok" })).ok, "native Markdown did not complete");
  expect(container.textContent === "native", "native Markdown missing after completion");
  successful.dispose();
  expect(container.childNodes.length === 0 && released === 3, "completed Markdown leaked");

  MarkdownRenderer.render = async (_app, _input, root) => { root.textContent = "partial"; throw new Error("fixture"); };
  const failed = await host.renderMarkdown({ container, lifetime: createLifetime(), markdown: "error" });
  expect(!failed.ok && failed.diagnostics[0].code === "host.markdown-failed" && container.childNodes.length === 0 && owner.children.size === 0, "Markdown rejection escaped scope");

  const browserScope = createLifetime();
  await createBrowserHost().renderMarkdown({
    container, lifetime: browserScope,
    markdown: "# Readable\n\n<strong>HTML</strong> ![Remote](https://example.invalid/image) [Custom](custom:target) [[Note]] $x^2$",
  });
  expect(container.querySelector("h1")?.textContent === "Readable", "browser heading missing");
  expect(!container.querySelector("img,a,strong") && container.textContent.includes("<strong>HTML</strong>")
    && container.querySelector(".kui-markdown-reference") && container.querySelector(".kui-markdown-latex"), "browser downgrade unsafe or missing");
  browserScope.dispose();

  const outer = target();
  const button = document.createElement("button");
  outer.append(button);
  const interaction = createLifetime();
  host.isolateInteraction(button, interaction);
  let bubbled = 0;
  for (const event of ["pointerdown", "click", "touchstart", "keydown"]) outer.addEventListener(event, () => { bubbled++; });
  for (const kind of ["pointerdown", "click", "touchstart", "keydown"]) {
    const event = new Event(kind, { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(!event.defaultPrevented, "interaction default cancelled");
  }
  expect(bubbled === 1, "editor event isolation blocks keyboard or leaks pointer/touch events");
  interaction.dispose();
  button.dispatchEvent(new Event("click", { bubbles: true }));
  expect(bubbled === 2, "editor event listeners not removed");

  const mounts = [];
  let disposed = 0;
  const Plugin = createKnowledgeUiPlugin((adapter) => {
    expect(adapter.kind === "obsidian", "wrong Obsidian host");
    return { mountBlock: (request) => { mounts.push(request); return { dispose: () => { disposed++; } }; } };
  });
  const plugin = new Plugin(app);
  plugin.load();
  let loaded;
  let pendingChild;
  expect(plugin.language === "kui", "processor language mismatch");
  plugin.processor("type: fixture", container, { sourcePath: "folder/note.md", addChild: (child) => { loaded = child; child.load(); } });
  expect(mounts.length === 1 && mounts[0].source.sourceId === "folder/note.md", "processor did not pass source");
  loaded.unload();
  plugin.processor("waiting", container, { sourcePath: "", addChild: (child) => { pendingChild = child; } });
  plugin.processor("active", container, { sourcePath: "", addChild: (child) => child.load() });
  plugin.unload();
  pendingChild.load();
  expect(disposed === 2 && mounts.length === 2, "plugin unload leaked active or pending blocks");
}

export async function markdownLists() {
  const owner = new Component();
  owner.load();
  const native = createObsidianHost({ metadataCache: { getFirstLinkpathDest: () => null } }, owner);
  const container = target();
  const lifetime = createLifetime();
  const fence = "\x60".repeat(3);
  const markdown = [
    "- First",
    "  + Child",
    "- Second",
    "",
    "3. Parent",
    "   1) First nested",
    "   7) Second nested",
    "",
    "   Ordinary **paragraph**",
    "",
    "   ~~~kui",
    "   type: section",
    "   ~~~",
    "10. Peer",
  ].join("\n");

  let captured;
  MarkdownRenderer.render = async (_app, input) => { captured = input; };
  const original = "- First\n  - Child\n- Second";
  expect((await native.renderMarkdown({ container, lifetime, markdown: original })).ok && captured === original,
    "the B-02-01 example lost its nested item");
  expect((await native.renderMarkdown({ container, lifetime, markdown })).ok, "native Markdown render failed");
  const expected = markdown.replace("   ~~~kui", "   " + fence).replace("   ~~~", "   " + fence);
  expect(captured === expected, "native list hierarchy, markers, nested paragraph or literal code were lost:\n" + captured);

  const restricted = [
    "- Parent",
    "  - <img src='https://example.invalid/raw'>",
    "  - ![Remote](https://example.invalid/remote)",
    "  - [Custom](obsidian://open)",
    "  - ![[note.md]]",
    "  - ~~~kui",
    "    type: section",
    "    ~~~",
    "  - $$",
    "    ~~~kui",
    "    type: section",
    "    ~~~",
    "    $$",
  ].join("\n");
  expect((await native.renderMarkdown({ container, lifetime, markdown: restricted })).ok, "list boundary render failed");
  expect(captured.startsWith("- Parent\n  - &#60;img") && captured.includes("  - " + fence + "\n    type: section"),
    "safe list wrappers or language-free fence are missing");
  expect(!captured.includes("<img") && !captured.includes("example.invalid/remote") && !captured.includes("obsidian://")
    && !captured.includes("![[note.md]]") && !captured.includes("~~~kui"), "list context bypassed the Markdown boundary");
  lifetime.dispose();

  const browserLifetime = createLifetime();
  const result = await createBrowserHost().renderMarkdown({ container, lifetime: browserLifetime, markdown });
  expect(result.ok && container.querySelector("ul > li > ul > li").textContent === "Child",
    "browser did not render the nested unordered item");
  expect(container.querySelector("ol").start === 3 && container.querySelectorAll("ol > li > ol > li").length === 2
    && container.querySelector("ol > li strong").textContent === "paragraph"
    && container.querySelector("ol > li > pre").textContent === "type: section", "browser lost ordered list content");
  browserLifetime.dispose();
}

export async function previewFenceExtent() {
  const container = target();
  const fence = "\x60".repeat(3);
  const markdown = [
    "Before", "> - " + fence + "kui", ">   type: callout", ">   body: Rendered block",
    "> " + fence, "> Ordinary code", "> " + fence, "After",
  ].join("\n");
  // The scanner is a range fixture for the implicit container exit in B-02-02.
  const source = { yaml: "type: callout\nbody: Rendered block\n", startLine: 3, endLine: 5, sourceId: "fixture.md" };
  const preview = mountPreview(container, createFixtureRenderer,
    { scan: () => ok([source]) }, [{ label: "Boundary fixture", markdown }]);
  await wait();
  const article = container.querySelector("article");
  const output = [...article.firstElementChild.children];
  expect(output.length === 3 && output[0].textContent === "Before" && output[1].textContent === "Rendered block",
    "ordinary Markdown or the kui block is out of order");
  expect(output[2].querySelector("blockquote pre code")?.textContent === "Ordinary code"
    && output[2].lastElementChild.textContent === "After", "ordinary fence or following prose was lost");
  preview.dispose();
}
