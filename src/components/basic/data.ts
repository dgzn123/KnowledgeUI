import { V1_LIMITS } from "#contracts";
import type { ComponentSemanticValidator, JsonObject, JsonScalar, JsonValue } from "#contracts";
import { frameTask } from "../../core/expression/frame.ts";
import { append, diagnostic, labelFrom, own, rootElement, semanticIssue, setTone, textField, watch, watchText } from "./mount.ts";
import type { BasicMount } from "./mount.ts";

type Rows = readonly (readonly JsonScalar[])[];

const isFiniteNumber = (value: JsonValue): value is number => typeof value === "number" && Number.isFinite(value);
const isNonnegative = (value: JsonValue): value is number => isFiniteNumber(value) && value >= 0;
const isPositive = (value: JsonValue): value is number => isFiniteNumber(value) && value > 0;
const isScalar = (value: JsonValue): value is JsonScalar =>
  value === null || typeof value === "string" || typeof value === "boolean" || isFiniteNumber(value);

const rowWidthMessage = "Each row must have one cell per column.";
const progressRangeMessage = "Progress value must not exceed its maximum.";

export const validateTable: ComponentSemanticValidator = input => {
  const { columns, rows } = input.node.props;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => row.length === columns.length ? [] :
    [semanticIssue(input, "semantic.table-row-width", rowWidthMessage, ["rows", index])]);
};

export const validateProgress: ComponentSemanticValidator = input => {
  const { value, max = 1 } = input.node.props;
  return typeof value === "number" && typeof max === "number" && value > max
    ? [semanticIssue(input, "semantic.progress-range", progressRangeMessage, ["value"])] : [];
};

function setCell(cell: HTMLTableCellElement, value: JsonScalar): void {
  const text = value === null ? "" : String(value);
  if (cell.textContent !== text) cell.textContent = text;
}

export function table(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "div");
  root.tabIndex = 0;
  root.setAttribute("role", "region");
  mount.context.host.isolateInteraction(root, mount.lifetime);
  const grid = append(root, "table", "kui-table-grid");
  const caption = textField(mount, grid, "caption", "kui-table-caption", "caption");
  labelFrom(root, caption, mount.context.instanceId + "-caption");
  if (!caption && mount.node.ariaLabel === undefined) root.setAttribute("aria-label", "Table");
  const head = append(append(grid, "thead"), "tr");
  const body = append(grid, "tbody");
  const columns = own(mount.node.props, "columns") as readonly JsonObject[];
  const rows = own(mount.node.props, "rows")!;

  function styleCell(cell: HTMLTableCellElement, column: JsonObject): void {
    const align = own(column, "align");
    cell.dataset.align = align === "center" || align === "end" ? align : "start";
    if (own(column, "emphasis") === true) cell.classList.add("kui-table-emphasis");
  }

  for (const [index, column] of columns.entries()) {
    const cell = append(head, "th");
    cell.scope = "col";
    styleCell(cell, column);
    watchText(mount, own(column, "label"), ["columns", index, "label"], label => { cell.textContent = label; });
  }

  function appendRow(): readonly HTMLTableCellElement[] {
    const row = append(body, "tr");
    return columns.map(column => {
      const cell = append(row, "td");
      styleCell(cell, column);
      return cell;
    });
  }

  if (typeof rows === "string") {
    const cells: (readonly HTMLTableCellElement[])[] = [];
    const acceptsRows = (value: JsonValue): value is Rows => Array.isArray(value) &&
      value.length <= V1_LIMITS.yamlNodes && value.every(row =>
        Array.isArray(row) && row.length === columns.length && row.every(isScalar));
    watch(mount, rows, ["rows"], acceptsRows, "an array of rows with one scalar cell per column", values => {
      while (cells.length > values.length) {
        cells.pop();
        body.lastElementChild?.remove();
      }
      for (const [index, row] of values.entries()) {
        let current = cells[index];
        if (!current) {
          current = appendRow();
          cells.push(current);
        }
        row.forEach((value, column) => setCell(current[column]!, value));
      }
    });
  } else {
    for (const [index, row] of (rows as Rows).entries()) {
      const cells = appendRow();
      row.forEach((value, column) => {
        watch(mount, value, ["rows", index, column], isScalar, "a scalar or null",
          resolved => setCell(cells[column]!, resolved));
      });
    }
  }
  return root;
}

export function progress(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "div", "group");
  setTone(mount, root);
  const header = append(root, "div", "kui-progress-header");
  const label = textField(mount, header, "span", "kui-progress-label", "label");
  const reading = append(header, "span", "kui-progress-reading");
  reading.textContent = "—";
  reading.setAttribute("aria-hidden", "true");
  const track = append(root, "progress", "kui-progress-track");
  track.hidden = true;
  const { ariaLabel, props } = mount.node;
  if (label && ariaLabel === undefined) labelFrom(track, label, mount.context.instanceId + "-label");
  else track.setAttribute("aria-label", ariaLabel ?? "Progress");
  const rawMax = own(props, "max");
  let max: number | undefined = rawMax === undefined ? 1 : undefined;
  let value: number | undefined;
  let ready = false;
  let outOfRange = false;
  const update = frameTask(render);
  mount.lifetime.add(() => update.dispose());
  const refresh = () => { if (ready) update.schedule(); };

  function render(): void {
    if (value === undefined || max === undefined) return;
    if (value > max) {
      if (!outOfRange) mount.context.report(diagnostic(mount, "render.progress-range", progressRangeMessage, ["value"]));
      outOfRange = true;
      return;
    }
    outOfRange = false;
    track.max = max;
    track.value = value;
    reading.textContent = String(value) + " / " + String(max);
    track.hidden = false;
  }

  watch(mount, own(props, "value"), ["value"], isNonnegative, "a finite nonnegative number",
    next => { value = next; refresh(); }, () => { value = undefined; refresh(); });
  watch(mount, rawMax, ["max"], isPositive, "a finite positive number",
    next => { max = next; refresh(); }, () => { max = undefined; refresh(); });
  ready = true;
  render();
  return root;
}
