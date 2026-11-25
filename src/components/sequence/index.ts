import type { ComponentRegistration, ComponentSemanticValidator, Diagnostic, JsonObject } from "#contracts";
import { v1ComponentSchema } from "#protocol-schema";
import { frameTask } from "../../core/expression/frame.ts";
import {
  arrowHead, attr, figure, hasBinding, isId, isStep, isText, isTone, issue, mountDiagram,
  occurrences, paint, setText, svg, watch, watchField, watchWhen,
} from "../svg/diagram.ts";
import type { Mount, Occurrence } from "../svg/diagram.ts";

const columnWidth = 156;
const side = 20;
const firstRow = 86;
const rowHeight = 58;
const center = (column: number) => side + (column + 0.5) * columnWidth;

const validate: ComponentSemanticValidator = ({ node }) => {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const [index, participant] of (node.props.participants as readonly JsonObject[]).entries()) {
    const id = participant.id as string;
    if (ids.has(id)) diagnostics.push(issue(node, ["participants", index, "id"], "semantic",
      "sequence-duplicate-id", `Duplicate sequence participant "${id}".`));
    ids.add(id);
  }

  for (const [index, message] of (node.props.messages as readonly JsonObject[]).entries()) {
    for (const field of ["from", "to"]) {
      const id = message[field] as string;
      if (!hasBinding(id) && !ids.has(id)) diagnostics.push(issue(node, ["messages", index, field], "semantic",
        "sequence-endpoint", `Unknown sequence participant "${id}".`));
    }
  }
  return diagnostics;
};

function participantHeader(mount: Mount, drawing: SVGElement, participant: JsonObject, index: number) {
  const line = svg(drawing, "line");
  attr(line, "class", "kui-sequence-lifeline");
  attr(line, "x1", center(index));
  attr(line, "x2", center(index));
  attr(line, "y1", 49);
  const box = svg(drawing, "svg");
  attr(box, "class", "kui-sequence-participant");
  attr(box, "x", center(index) - columnWidth / 2 + 6);
  attr(box, "y", 12);
  attr(box, "width", columnWidth - 12);
  attr(box, "height", 38);
  attr(box, "overflow", "hidden");
  const backdrop = svg(box, "rect");
  attr(backdrop, "x", 1);
  attr(backdrop, "y", 1);
  attr(backdrop, "width", columnWidth - 14);
  attr(backdrop, "height", 36);
  attr(backdrop, "rx", 6);
  const name = svg(box, "text");
  attr(name, "x", columnWidth / 2 - 6);
  attr(name, "y", 19);
  attr(name, "text-anchor", "middle");
  attr(name, "dominant-baseline", "central");
  const tooltip = svg(box, "title");
  watch(mount, mount.context.bindings, ["participants", index, "label"], participant.label as string,
    isText, "text", value => { setText(name, value); setText(tooltip, value); });
  return line;
}

function messageRow(
  mount: Mount, drawing: SVGElement, occurrence: Occurrence, index: number, width: number, change: () => void,
) {
  const group = svg(drawing, "g");
  attr(group, "class", "kui-sequence-message");
  const backdrop = svg(group, "rect");
  attr(backdrop, "class", "kui-sequence-highlight");
  attr(backdrop, "x", 6);
  attr(backdrop, "y", -29);
  attr(backdrop, "width", width - 12);
  attr(backdrop, "height", rowHeight - 4);
  attr(backdrop, "rx", 6);
  const path = svg(group, "path");
  attr(path, "class", "kui-sequence-shaft");
  if (occurrence.value.kind === "return") attr(path, "stroke-dasharray", "5 4");
  const head = svg(group, "path");
  const text = svg(group, "text");
  attr(text, "text-anchor", "middle");
  attr(text, "y", -9);
  let visible = false;
  let from: string | undefined;
  let to: string | undefined;
  let step = occurrence.value.step === undefined ? index : undefined;
  watchWhen(mount, occurrence, value => { visible = value; change(); });
  watchField(mount, occurrence, "from", isId, "a participant ID", value => { from = value; change(); });
  watchField(mount, occurrence, "to", isId, "a participant ID", value => { to = value; change(); });
  watchField(mount, occurrence, "step", isStep, "a nonnegative integer step", value => { step = value; change(); });
  watchField(mount, occurrence, "label", isText, "text", value => setText(text, value));
  watchField(mount, occurrence, "tone", isTone, "a semantic tone", value => {
    group.style.color = value === "neutral" ? "" : paint(value);
  });

  return {
    group, occurrence,
    get visible() { return visible && from !== undefined && to !== undefined; },
    get from() { return from!; },
    get to() { return to!; },
    get step() { return step; },
    clear() { attr(group, "display", "none"); },
    active(active: boolean) {
      if (active) attr(group, "aria-current", "step");
      else if (group.hasAttribute("aria-current")) group.removeAttribute("aria-current");
    },
    draw(row: number, first: number, second: number) {
      attr(group, "display", "inline");
      attr(group, "transform", `translate(0 ${firstRow + row * rowHeight})`);
      const a = center(first);
      const b = center(second);
      if (first === second) {
        const loop = a + 48;
        attr(path, "d", `M ${a} 0 H ${loop} V 17 H ${a}`);
        attr(head, "d", arrowHead({ x: a, y: 17 }, { x: loop, y: 17 }));
        attr(text, "x", a + 24);
      } else {
        attr(path, "d", `M ${a} 0 H ${b}`);
        attr(head, "d", arrowHead({ x: b, y: 0 }, { x: a, y: 0 }));
        attr(text, "x", (a + b) / 2);
      }
    },
  };
}

export const sequenceRegistrations: readonly ComponentRegistration[] = [{
  definition: { ...v1ComponentSchema("sequence"), validate },
  mount: mountDiagram(mount => {
    const messages = occurrences(mount, "messages", 200);
    if (!Array.isArray(messages)) return [messages];
    const participants = mount.node.props.participants as readonly JsonObject[];
    const width = side * 2 + participants.length * columnWidth;
    const { root, drawing } = figure(mount, "Sequence diagram", true);
    attr(drawing, "width", width);
    const columns = new Map(participants.map((participant, index) => [participant.id as string, index]));
    const lines = participants.map((participant, index) => participantHeader(mount, drawing, participant, index));

    let step: number | undefined;
    let displayed: ReturnType<typeof messageRow>[] = [];
    let ready = false;
    const task = frameTask(sync);
    mount.lifetime.add(() => task.dispose());
    const rows = messages.map((message, index) => messageRow(mount, drawing, message, index, width, () => {
      if (ready) task.schedule();
    }));
    const activeStep = mount.node.props.activeStep;
    if (activeStep !== undefined) {
      watch(mount, mount.context.bindings, ["activeStep"], activeStep, isStep, "a nonnegative integer step", value => {
        step = value;
        if (ready) highlight();
      });
    }

    function highlight(): void {
      for (const row of displayed) row.active(step !== undefined && row.step === step);
    }

    function sync(): void {
      const next: typeof displayed = [];
      for (const row of rows) {
        if (!row.visible) {
          row.clear();
          row.active(false);
          continue;
        }
        const first = columns.get(row.from);
        const second = columns.get(row.to);
        if (first === undefined || second === undefined) {
          mount.report(issue(mount.node, [...row.occurrence.path, first === undefined ? "from" : "to"], "render",
            "sequence-endpoint", `Unknown sequence participant "${first === undefined ? row.from : row.to}".`));
          row.clear();
          row.active(false);
        } else {
          row.draw(next.length, first, second);
          next.push(row);
        }
      }
      const height = firstRow + Math.max(0, next.length - 1) * rowHeight + 34;
      for (const line of lines) attr(line, "y2", height - 8);
      attr(drawing, "viewBox", `0 0 ${width} ${height}`);
      displayed = next;
      highlight();
    }

    sync();
    ready = true;
    return root;
  }),
}];
