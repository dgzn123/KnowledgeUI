import type { ComponentRegistration, ComponentSemanticValidator, JsonValue } from "#contracts";
import { phase1ComponentTypes, v1ComponentSchema } from "#protocol-schema";
import { progress, table, validateProgress, validateTable } from "./data.ts";
import { collapse, tabs, validateTabs } from "./disclosure.ts";
import { formula } from "./formula.ts";
import { mountMarkdown } from "./markdown.ts";
import { append, diagnostic, isObject, labelFrom, mountSlot, own, rootElement, setTone, textField, watch, watchText } from "./mount.ts";
import type { BasicMount } from "./mount.ts";

const basicTypes = [...phase1ComponentTypes, "table", "formula", "progress", "tabs", "collapse"] as const;
type BasicType = (typeof basicTypes)[number];
type BasicRenderer = (mount: BasicMount) => HTMLElement;

function literal<const T extends string>(
  value: JsonValue | undefined, choices: readonly T[], fallback: T,
): T {
  return choices.find(choice => choice === value) ?? fallback;
}

const gaps = ["none", "xs", "sm", "md", "lg", "xl"] as const;
const alignments = ["start", "center", "end", "stretch", "baseline"] as const;
const variants = ["title", "subtitle", "body", "caption", "label"] as const;

function hero(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "section");
  const heading = textField(mount, root, "h2", "kui-hero-title", "title");
  labelFrom(root, heading, mount.context.instanceId + "-title");
  textField(mount, root, "p", "kui-hero-subtitle", "subtitle");
  textField(mount, root, "p", "kui-hero-body", "body");
  return root;
}

function text(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "div", "group");
  const { props } = mount.node;
  const variant = literal(own(props, "variant"), variants, "body");
  root.dataset.variant = variant;
  setTone(mount, root);
  if (own(props, "markdown") === true) {
    mountMarkdown(mount, root);
  } else {
    textField(mount, root, variant === "title" ? "h3" : "p", "kui-text-content", "body");
  }
  return root;
}

function markdown(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "div", "group");
  mountMarkdown(mount, root);
  return root;
}

const isMetricValue = (value: JsonValue): value is string | number =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

function metric(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "dl");
  setTone(mount, root);
  textField(mount, root, "dt", "kui-metric-label", "label");
  const description = append(root, "dd", "kui-metric-description");
  const reading = append(description, "div", "kui-metric-reading");
  const value = append(reading, "span", "kui-metric-value");
  watch(mount, own(mount.node.props, "value"), ["value"], isMetricValue, "text or a finite number",
    current => { value.textContent = String(current); });
  textField(mount, reading, "span", "kui-metric-unit", "unit");
  textField(mount, description, "p", "kui-metric-detail", "detail");
  return root;
}

function badge(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "span", "group");
  setTone(mount, root);
  watchText(mount, own(mount.node.props, "label"), ["label"], label => { root.textContent = label; });
  return root;
}

function callout(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "aside");
  setTone(mount, root);
  const heading = textField(mount, root, "h3", "kui-callout-title", "title");
  labelFrom(root, heading, mount.context.instanceId + "-title");
  textField(mount, root, "p", "kui-callout-body", "body");
  return root;
}

function divider(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "div");
  const label = textField(mount, root, "span", "kui-divider-label", "label");
  const rule = append(root, "hr", "kui-divider-rule");
  if (mount.node.ariaLabel !== undefined) {
    root.removeAttribute("aria-label");
    rule.setAttribute("aria-label", mount.node.ariaLabel);
  } else if (label) {
    label.setAttribute("aria-hidden", "true");
    labelFrom(rule, label, mount.context.instanceId + "-label");
  }
  return root;
}

function stack(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "div", "group");
  const { props } = mount.node;
  const direction = literal(own(props, "direction"), ["row", "column"], "column");
  root.dataset.direction = direction;
  root.dataset.gap = literal(own(props, "gap"), gaps, "md");
  root.dataset.align = literal(own(props, "align"), alignments, direction === "row" ? "start" : "stretch");
  mountSlot(mount, root, "/children");
  return root;
}

function columnCount(value: JsonValue | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error("Expected a normalized column count between 1 and 6");
  }
  return value;
}

function grid(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "div", "group");
  const columns = own(mount.node.props, "columns");
  const responsive = isObject(columns) ? columns : undefined;
  const desktop = columnCount(responsive ? own(responsive, "desktop") : columns);
  const mobile = responsive ? columnCount(own(responsive, "mobile")) : 1;
  const tablet = responsive ? columnCount(own(responsive, "tablet") ?? mobile) : Math.min(2, desktop);
  root.dataset.gap = literal(own(mount.node.props, "gap"), gaps, "md");
  root.style.setProperty("--kui-grid-desktop", String(desktop));
  root.style.setProperty("--kui-grid-tablet", String(tablet));
  root.style.setProperty("--kui-grid-mobile", String(mobile));
  mountSlot(mount, append(root, "div", "kui-grid-content"), "/children");
  return root;
}

function section(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "section");
  const heading = textField(mount, root, "h2", "kui-section-title", "title");
  labelFrom(root, heading, mount.context.instanceId + "-title");
  mountSlot(mount, append(root, "div", "kui-section-content"), "/children");
  return root;
}

function compare(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "section");
  const heading = textField(mount, root, "h2", "kui-compare-title", "title");
  labelFrom(root, heading, mount.context.instanceId + "-title");
  const panels = own(mount.node.props, "panels");
  if (!Array.isArray(panels)) throw new Error("Missing normalized comparison panels");

  const content = append(root, "div", "kui-compare-content");
  panels.forEach((metadata: JsonValue, index: number) => {
    if (!isObject(metadata)) throw new Error("Invalid normalized comparison panel");
    const panel = append(content, "section", "kui-compare-panel");
    const title = append(panel, "h3", "kui-compare-panel-title");
    watchText(mount, own(metadata, "title"), ["panels", index, "title"], value => { title.textContent = value; });
    labelFrom(panel, title, mount.context.instanceId + "-panel-" + index);
    mountSlot(mount, append(panel, "div", "kui-compare-panel-content"), "/panels/" + index + "/children");
  });
  return root;
}

const renderers = {
  hero, text, markdown, metric, badge, callout, divider, stack, grid, section, compare,
  table, formula, progress, tabs, collapse,
} satisfies Record<BasicType, BasicRenderer>;

const validators: Partial<Record<BasicType, ComponentSemanticValidator>> = {
  table: validateTable, progress: validateProgress, tabs: validateTabs,
};

export const basicRegistrations: readonly ComponentRegistration[] = basicTypes.map(type => {
  const schema = v1ComponentSchema(type);
  const validate = validators[type];
  return {
    definition: validate ? { ...schema, validate } : schema,
    mount(request) {
      const lifetime = request.context.lifetime.child();
      if (lifetime.signal.aborted) {
        return { ok: false, diagnostics: [diagnostic(request, "render.basic-disposed", "Component lifetime ended")] };
      }

      try {
        const root = renderers[type]({ ...request, lifetime });
        return { ok: true, value: { root, dispose: () => lifetime.dispose() }, diagnostics: [] };
      } catch (error) {
        lifetime.dispose();
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, diagnostics: [diagnostic(request, "render.basic-mount", message)] };
      }
    },
  };
});
