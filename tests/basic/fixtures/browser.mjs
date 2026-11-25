import gallerySource from "../../../examples/gallery/basic.md";
import { readGallery, fixtureRange } from "./protocol.mjs";
import { runtimeFixture, success } from "./runtime.mjs";

const gallery = document.querySelector("#gallery");
const sandbox = document.querySelector("#sandbox");
const suites = [];
const test = (name, run) => suites.push({ name, run });

function equal(actual, expected) {
  if (!Object.is(actual, expected)) throw new Error(`Expected ${expected}, received ${actual}`);
}

function root(result) {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value.root;
}

const badge = label => ({ type: "badge", label });
const grid = (columns, children = [badge("A"), badge("B"), badge("C")]) => ({ type: "grid", columns, children });
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

test("leaf components render semantic elements, supplied fields and safe plain text", () => {
  const fixture = runtimeFixture(sandbox);
  const hero = root(fixture.mount({
    type: "hero", title: "<em>Finding</em>", subtitle: "Context", body: "Evidence", ariaLabel: "Main claim",
  }));
  equal(hero.tagName, "SECTION");
  equal(hero.getAttribute("aria-label"), "Main claim");
  equal(hero.querySelector("h2").textContent, "<em>Finding</em>");
  equal(hero.querySelector("em"), null);
  equal(hero.querySelector(".kui-hero-subtitle").textContent, "Context");
  equal(hero.querySelector(".kui-hero-body").textContent, "Evidence");
  const title = root(fixture.mount({ type: "text", variant: "title", tone: "info", body: "Heading" }));
  equal(title.querySelector("h3").textContent, "Heading");
  equal(title.dataset.tone, "info");
  const paragraph = root(fixture.mount({ type: "text", body: "Body" }));
  equal(paragraph.dataset.variant, "body");
  equal(paragraph.querySelector("p").textContent, "Body");

  const metric = root(fixture.mount({
    type: "metric", label: "Reviewed", value: 0, unit: "items", detail: "This week", tone: "success",
  }));
  equal(metric.tagName, "DL");
  equal(metric.querySelector("dt").textContent, "Reviewed");
  equal(metric.querySelector("dd .kui-metric-value").textContent, "0");
  equal(metric.querySelector(".kui-metric-unit").textContent, "items");
  equal(metric.querySelector(".kui-metric-detail").textContent, "This week");
  equal(metric.dataset.tone, "success");
  const state = root(fixture.mount({ type: "badge", label: "Draft", tone: "warning" }));
  equal(state.tagName, "SPAN");
  equal(state.textContent, "Draft");
  equal(state.dataset.tone, "warning");

  const note = root(fixture.mount({ type: "callout", title: "Boundary", body: "Check the scope", tone: "danger" }));
  equal(note.tagName, "ASIDE");
  equal(note.getAttribute("aria-labelledby"), note.querySelector("h3").id);
  equal(note.querySelector("p").textContent, "Check the scope");
  equal(note.dataset.tone, "danger");
  const division = root(fixture.mount({ type: "divider", label: "Next part" }));
  equal(division.querySelector("hr").getAttribute("aria-labelledby"), division.querySelector("span").id);
  const namedDivider = root(fixture.mount({ type: "divider", ariaLabel: "Boundary" }));
  equal(namedDivider.querySelector("hr").getAttribute("aria-label"), "Boundary");
  equal(fixture.markdownRequests.length, 0);
  fixture.lifetime.dispose();
  equal(sandbox.childElementCount, 0);
});

test("layout components use normalized slots, named sections and container options", () => {
  const fixture = runtimeFixture(sandbox);
  const stack = root(fixture.mount({
    type: "stack", direction: "row", gap: "xs", align: "baseline", ariaLabel: "Arrangement",
    children: [{
      type: "section", title: "Overview",
      children: [grid({ desktop: 4, tablet: 3, mobile: 2 })],
    }, {
      type: "compare", title: "Choice",
      panels: [{ title: "Short", children: [badge("First")] }, { title: "Long", children: [badge("Second")] }],
    }],
  }));
  equal(stack.dataset.direction, "row");
  equal(stack.dataset.align, "baseline");
  equal(stack.dataset.gap, "xs");
  equal(stack.getAttribute("aria-label"), "Arrangement");
  const section = stack.querySelector(".kui-section");
  equal(section.tagName, "SECTION");
  equal(section.getAttribute("aria-labelledby"), section.querySelector("h2").id);
  const placedGrid = section.querySelector(".kui-grid");
  equal(placedGrid.style.getPropertyValue("--kui-grid-desktop"), "4");
  equal(placedGrid.style.getPropertyValue("--kui-grid-tablet"), "3");
  equal(placedGrid.style.getPropertyValue("--kui-grid-mobile"), "2");
  const panels = stack.querySelectorAll(".kui-compare-panel");
  equal(panels.length, 2);
  equal(panels[0].querySelector("h3").textContent, "Short");
  equal(panels[1].querySelector("h3").textContent, "Long");
  equal(panels[0].querySelector(".kui-badge").textContent, "First");
  equal(panels[1].querySelector(".kui-badge").textContent, "Second");
  equal(fixture.childCalls.length, 8);
  equal(fixture.childCalls.at(-1).node.source.path.join("/"), "children/1/panels/1/children/0");
  equal(fixture.childCalls.at(-1).container, panels[1].querySelector(".kui-compare-panel-content"));
  fixture.lifetime.dispose();
  equal(sandbox.childElementCount, 0);
});

test("Markdown and Markdown text forward the body, source and cancellable lifetime to the host", async () => {
  let finish;
  let released = 0;
  const fixture = runtimeFixture(sandbox, {
    renderMarkdown(request) {
      request.lifetime.add(() => { released++; });
      return new Promise(resolve => { finish = resolve; });
    },
  });
  const mount = fixture.mount({ type: "markdown", body: "**Evidence**\n\n[[Note]]" });
  const first = fixture.markdownRequests[0];
  equal(first.markdown, "**Evidence**\n\n[[Note]]");
  equal(first.sourceId, "gallery/basic.md");
  equal(first.container.parentElement, root(mount));
  equal(first.lifetime.signal.aborted, false);
  mount.value.dispose();
  mount.value.dispose();
  equal(first.lifetime.signal.aborted, true);
  equal(first.container.isConnected, false);
  finish({ ok: false, diagnostics: [{ code: "host.fixture-late" }] });
  await pause();
  equal(fixture.reports.length, 0);
  equal(released, 1);
  const text = root(fixture.mount({ type: "text", body: "**Read**", markdown: true, variant: "caption" }));
  equal(text.tagName, "DIV");
  equal(text.querySelector("p"), null);
  equal(fixture.markdownRequests[1].container.parentElement, text);
  equal(fixture.markdownRequests[1].markdown, "**Read**");
  finish(success());
  await pause();
  fixture.lifetime.dispose();
  equal(released, 2);
  equal(sandbox.childElementCount, 0);
});

test("host rejection and structured failure each release partial Markdown and report a local diagnostic", async () => {
  const hostDiagnostic = { code: "host.fixture-error", phase: "host", severity: "error", path: ["children", 2] };
  let released = 0;
  const fixture = runtimeFixture(sandbox, {
    async renderMarkdown(request) {
      request.container.append(document.createElement("strong"));
      request.lifetime.add(() => { released++; });
      if (request.markdown === "rejected") throw new Error("Fixture host rejected Markdown");
      return { ok: false, diagnostics: [hostDiagnostic] };
    },
  });
  const stack = root(fixture.mount({
    type: "stack", children: [badge("Before"), { type: "markdown", body: "rejected" },
      { type: "markdown", body: "structured failure" }, badge("After")],
  }));
  await pause();
  equal(stack.childElementCount, 4);
  equal(stack.querySelector("strong"), null);
  equal(stack.querySelector(".kui-markdown-fallback").textContent, "rejected");
  equal(fixture.reports.length, 2);
  equal(fixture.reports[0].code, "host.basic-markdown");
  equal(fixture.reports[0].path.join("/"), "children/1/body");
  equal(fixture.reports[0].range, fixtureRange);
  equal(fixture.reports[0].sourceId, "gallery/basic.md");
  equal(fixture.reports[1], hostDiagnostic);
  equal(released, 2);
  fixture.lifetime.dispose();
});

test("a returned child failure preserves siblings and a thrown mount rolls back the subtree", () => {
  const item = { code: "render.fixture-error", phase: "render", severity: "error", path: ["children", 1] };
  let released = 0;
  const fixture = runtimeFixture(sandbox, {
    beforeChild(child) {
      if (child.props.label === "Failed") return { ok: false, diagnostics: [item] };
      if (child.props.label === "Throws") throw new Error("Fixture child mount threw");
    },
    renderMarkdown(request) {
      request.lifetime.add(() => { released++; });
      return Promise.resolve(success());
    },
  });
  const kept = root(fixture.mount({ type: "stack", children: [badge("Before"), badge("Failed"), badge("After")] }));
  equal(kept.textContent, "BeforeAfter");
  equal(fixture.reports[0], item);
  const failed = fixture.mount({ type: "stack", children: [{ type: "markdown", body: "Draft" }, badge("Throws")] });
  equal(failed.ok, false);
  equal(failed.diagnostics[0].code, "render.basic-mount");
  equal(sandbox.childElementCount, 1);
  equal(released, 1);
  fixture.lifetime.dispose();
  equal(released, 1);
});

test("binding updates preserve mounted nodes, validate types and dispose subscriptions", () => {
  let update;
  let released = 0;
  const item = { code: "expression.fixture-type", phase: "expression", severity: "error", path: ["value"] };
  const bindings = {
    observe(input, listener) {
      const deliver = value => listener(input.accepts(value) ? success(value) : { ok: false, diagnostics: [item] });
      if (input.value === "{{count}}") {
        update = deliver;
        deliver(2);
      } else {
        deliver(input.value);
      }
      return { dispose: () => { released++; } };
    },
  };
  const fixture = runtimeFixture(sandbox, { bindings });
  const metric = root(fixture.mount({ type: "metric", label: "Count", value: "{{count}}" }));
  const reading = metric.querySelector(".kui-metric-value");
  equal(reading.textContent, "2");
  update(5);
  equal(metric.querySelector(".kui-metric-value"), reading);
  equal(reading.textContent, "5");
  update(Infinity);
  equal(reading.textContent, "5");
  equal(fixture.reports[0], item);
  fixture.lifetime.dispose();
  equal(released, 2);
});

test("superseded Markdown cannot overwrite a newer binding's content", async () => {
  let update;
  const revisions = [];
  const fixture = runtimeFixture(sandbox, {
    bindings: {
      observe(_input, listener) {
        update = value => listener(success(value));
        update("Before");
        return { dispose() {} };
      },
    },
    renderMarkdown(request) {
      return new Promise(resolve => revisions.push({ request, resolve }));
    },
  });
  const markdown = root(fixture.mount({ type: "markdown", body: "{{content}}" }));
  update("Before");
  equal(revisions.length, 1);
  update("After");
  const [before, after] = revisions;
  equal(before.request.lifetime.signal.aborted, true);
  equal(before.request.container.isConnected, false);
  after.request.container.textContent = "After";
  after.resolve(success());
  before.resolve({ ok: false, diagnostics: [{ code: "host.fixture-stale" }] });
  await pause();
  equal(markdown.textContent, "After");
  equal(fixture.reports.length, 0);
  fixture.lifetime.dispose();
  equal(after.request.lifetime.signal.aborted, true);
});

function galleryMarkdown({ markdown, container }) {
  // Minimal display fixture for these two known Gallery bodies.
  if (markdown.startsWith("1. ")) {
    const list = container.appendChild(document.createElement("ol"));
    for (const line of markdown.trim().split("\n")) {
      list.appendChild(document.createElement("li")).textContent = line.slice(3);
    }
  } else {
    const [, emphasis, remainder] = markdown.split("**");
    container.appendChild(document.createElement("strong")).textContent = emphasis;
    container.append(remainder);
  }
  return Promise.resolve(success());
}

function setGallery(width, theme) {
  gallery.hidden = false;
  gallery.style.inlineSize = width + "px";
  document.body.className = "theme-" + theme;
}

function columns(element) {
  return getComputedStyle(element).gridTemplateColumns.split(" ").filter(track => track !== "0px").length;
}

function contrast(color, background) {
  const luminance = rgb => rgb.match(/\d+/g).slice(0, 3)
    .map(value => Number(value) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const [dark, light] = [luminance(color), luminance(background)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}

for (const theme of ["light", "dark"]) {
  test(`Gallery respects each container width and readable colors in the ${theme} theme`, () => {
    const layout = gallery.querySelector(".kui-grid-content");
    const compare = gallery.querySelector(".kui-compare-content");
    const background = () => getComputedStyle(document.body).backgroundColor;
    const viewport = window.innerWidth;
    for (const [width, gridCount, compareCount] of [[900, 3, 2], [620, 2, 2], [375, 1, 1]]) {
      setGallery(width, theme);
      equal(gallery.clientWidth, width);
      equal(window.innerWidth, viewport);
      equal(columns(layout), gridCount);
      equal(columns(compare), compareCount);
      const [first, second] = [...compare.children].map(panel => panel.getBoundingClientRect());
      equal(first.top === second.top, compareCount > 1);
      equal(gallery.scrollWidth, width);
      equal(getComputedStyle(gallery.querySelector(".kui-hero")).color, getComputedStyle(document.body).color);
      for (const element of gallery.querySelectorAll(".kui-badge, .kui-metric-value, .kui-callout-title, .kui-metric-detail")) {
        const ratio = contrast(getComputedStyle(element).color, background());
        if (ratio < 4.5) throw new Error(`Insufficient contrast in ${theme} theme: ${ratio}`);
      }
    }
  });
}

test("nested grids query their own width and long Markdown scrolls within a 375px container", () => {
  sandbox.style.inlineSize = "900px";
  const fixture = runtimeFixture(sandbox, {
    renderMarkdown({ container }) {
      const pre = container.appendChild(document.createElement("pre"));
      pre.textContent = "long-source-line ".repeat(100);
      const math = container.appendChild(document.createElement("div"));
      math.className = "math-block";
      math.appendChild(document.createElement("span")).style.inlineSize = "900px";
      math.firstElementChild.style.display = "inline-block";
      const embed = container.appendChild(document.createElement("canvas"));
      embed.width = 900;
      embed.height = 120;
      return Promise.resolve(success());
    },
  });
  const outer = root(fixture.mount(grid(2, [grid(3), badge("Outside")])));
  const [outerContent, innerContent] = outer.querySelectorAll(".kui-grid-content");
  equal(columns(outerContent), 2);
  equal(columns(innerContent), 1);

  sandbox.style.inlineSize = "375px";
  const longWord = "Reference".repeat(150);
  const stack = root(fixture.mount({
    type: "stack", direction: "row", gap: "sm", align: "center",
    children: [{ type: "text", body: longWord }, badge("Wrap"), grid(3),
      { type: "markdown", body: "Wide fixture" }, { type: "divider", label: longWord }],
  }));
  equal(getComputedStyle(stack).flexWrap, "wrap");
  equal(getComputedStyle(stack).alignItems, "center");
  equal(getComputedStyle(stack).gap, "8px");
  equal(columns(stack.querySelector(".kui-grid-content")), 1);
  equal(stack.querySelector(".kui-grid").clientWidth > 0, true);
  equal(sandbox.scrollWidth, 375);
  for (const scrollable of stack.querySelectorAll("pre, .math-block")) {
    equal(getComputedStyle(scrollable).overflowX, "auto");
    equal(scrollable.scrollWidth > scrollable.clientWidth, true);
    scrollable.scrollLeft = scrollable.scrollWidth;
    equal(scrollable.scrollLeft > 0, true);
  }
  equal(stack.querySelector("canvas").clientWidth <= 375, true);
  fixture.lifetime.dispose();
});

function keyboardFixture(theme) {
  gallery.hidden = true;
  document.body.className = "theme-" + theme;
  sandbox.replaceChildren();
  const start = sandbox.appendChild(document.createElement("button"));
  start.textContent = "Start keyboard check";
  const fixture = runtimeFixture(sandbox, {
    renderMarkdown({ container }) {
      const link = container.appendChild(document.createElement("a"));
      link.href = "#fixture-target";
      link.id = "fixture-link";
      link.textContent = "Fixture target";
      return Promise.resolve(success());
    },
  });
  root(fixture.mount({ type: "markdown", body: "[Fixture target](#fixture-target)" }));
  start.focus();
}

const display = runtimeFixture(document.querySelector("#blocks"), { renderMarkdown: galleryMarkdown });
for (const block of readGallery(gallerySource)) root(display.mount(block));

async function run() {
  const results = [];
  for (const { name, run: runTest } of suites) {
    try {
      await runTest();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.stack });
    } finally {
      sandbox.replaceChildren();
    }
  }
  return results;
}

window.kuiFixture = { run, setGallery, keyboardFixture };
