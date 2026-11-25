import {
  boolean, bound, choice, component, label, list, nonnegative, number, object, positive, slot, slots, string, text, tone,
  union,
} from "./fields.ts";

const gap = choice("none", "xs", "sm", "md", "lg", "xl");
const align = choice("start", "center", "end", "stretch", "baseline");
const columnCount = { type: "integer", minimum: 1, maximum: 6 } as const;
const panel = object({ title: text, children: slots }, ["title", "children"]);
const cell = bound(union(string, number, boolean, { type: "null" }));
const formulaVariable = object(
  { symbol: text, meaning: text, unit: text },
  ["symbol", "meaning"],
);
const formulaStep = object({ latex: text, explanation: text }, ["latex"]);
const tableColumn = object(
  { label: text, align: choice("start", "center", "end"), emphasis: boolean },
  ["label"],
);

export const basicComponents = [
  component("hero", "Prominent claim or summary", { title: text, subtitle: text, body: text }, ["title"]),
  component("text", "Text with semantic typography", {
    body: text, variant: choice("title", "subtitle", "body", "caption", "label"), tone, markdown: boolean,
  }, ["body"]),
  component("markdown", "Host Markdown content", { body: text }, ["body"]),
  component("metric", "Prominent measurement", {
    label: text, value: bound(union(string, number)), unit: text, detail: text, tone,
  }, ["label", "value"]),
  component("badge", "Compact semantic label", { label: text, tone }, ["label"]),
  component("callout", "Contextual explanation", { title: text, body: text, tone }, ["body"]),
  component("divider", "Section separator", { label: text }),
  component("stack", "Linear layout", {
    direction: choice("row", "column"), gap, align, children: slots,
  }, ["children"]),
  component("grid", "Responsive container grid", {
    columns: union(columnCount, object(
      { desktop: columnCount, tablet: columnCount, mobile: columnCount },
      ["desktop", "mobile"],
    )),
    gap,
    children: slots,
  }, ["columns", "children"]),
  component("section", "Semantic grouping", { title: text, children: slots }, ["children"]),
  component("compare", "Parallel panels for comparison", { title: text, panels: list(panel, 2, 6) }, ["panels"]),
  component("formula", "Host-rendered mathematical notation", {
    latex: text, variables: list(formulaVariable), conditions: text, steps: list(formulaStep),
  }, ["latex"]),
  component("table", "Structured data with column alignment", {
    caption: text, columns: list(tableColumn, 1, 32), rows: bound(list(list(cell, 1, 32))),
  }, ["columns", "rows"]),
  component("progress", "Progress or proportion", { label: text, value: bound(nonnegative), max: bound(positive), tone }, ["value"]),
  component("tabs", "Keyboard-accessible alternate panels", {
    tabs: list(panel, 1, 16),
    initial: { type: "integer", minimum: 0 },
  }, ["tabs"]),
  component("collapse", "Disclosure of supplemental detail", {
    label: label, open: boolean, content: slot,
  }, ["label", "content"]),
] as const;
