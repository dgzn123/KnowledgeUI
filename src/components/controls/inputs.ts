import type { JsonValue, StateAction } from "#contracts";
import { ownData } from "../../core/state/constraints.ts";
import { append, controlLabel, listen, report, root, watchState, watchText } from "./dom.ts";
import type { Mount } from "./dom.ts";
import type { Choice } from "./types.ts";

export function numeric(mount: Mount): HTMLElement {
  const { props, type } = mount.node;
  const store = mount.context.state!;
  const bind = props.bind as string;
  const definition = ownData(store.definitions, bind);
  if (!definition || definition.type !== "number") throw new Error("Missing numeric state.");

  const { unit } = definition;
  const range = type === "slider";
  const wrapper = root(mount, "div");
  const input = append(wrapper, "input", "kui-control-input");
  input.type = range ? "range" : "number";
  if (definition.min !== undefined) input.min = String(definition.min);
  if (definition.max !== undefined) input.max = String(definition.max);
  input.step = definition.step === undefined ? "any" : String(definition.step);
  // Native number inputs use this value as the step base when no minimum exists.
  input.defaultValue = String(definition.default);
  controlLabel(mount, wrapper, input, bind);
  const output = range ? append(wrapper, "span", "kui-control-reading") : undefined;
  if (output) output.setAttribute("aria-hidden", "true");
  if (unit !== undefined && !range) {
    const unitLabel = append(wrapper, "span", "kui-control-unit");
    unitLabel.id = input.id + "-unit";
    unitLabel.textContent = unit;
    input.setAttribute("aria-describedby", unitLabel.id);
  }
  const format = (value: number) => unit === undefined ? String(value) : String(value) + " " + unit;
  function update(value: JsonValue | undefined): void {
    if (typeof value !== "number") return;
    if (input.valueAsNumber !== value) input.value = String(value);
    input.removeAttribute("aria-invalid");
    if (output) output.textContent = format(value);
    if (range && unit !== undefined) input.setAttribute("aria-valuetext", format(value));
  }
  watchState(mount, store, bind, update);
  listen(mount, input, range ? "input" : "change", () => {
    const result = store.set(bind, input.valueAsNumber);
    if (range || result.ok) {
      if (!result.ok) update(store.get(bind));
      else input.removeAttribute("aria-invalid");
    } else {
      input.setAttribute("aria-invalid", "true");
    }
    report(mount, result);
  });
  return wrapper;
}

export function select(mount: Mount): HTMLElement {
  const store = mount.context.state!;
  const bind = mount.node.props.bind as string;
  const options = mount.node.props.options as unknown as readonly Choice[];
  const wrapper = root(mount, "div");
  const input = append(wrapper, "select", "kui-control-input");
  controlLabel(mount, wrapper, input, bind);
  for (const [index, choice] of options.entries()) {
    const option = append(input, "option");
    option.value = String(index);
    watchText(mount, choice.label, ["options", index, "label"], value => { option.textContent = value; });
  }
  const update = (value: JsonValue | undefined) => {
    const index = options.findIndex(choice => choice.value === value);
    if (input.selectedIndex !== index) input.selectedIndex = index;
  };
  watchState(mount, store, bind, update);
  listen(mount, input, "change", () => {
    const option = options[input.selectedIndex];
    if (!option) return;
    const result = store.set(bind, option.value);
    if (!result.ok) update(store.get(bind));
    report(mount, result);
  });
  return wrapper;
}

export function toggle(mount: Mount): HTMLElement {
  const store = mount.context.state!;
  const bind = mount.node.props.bind as string;
  const wrapper = root(mount, "div");
  const input = append(wrapper, "input", "kui-control-input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  controlLabel(mount, wrapper, input, bind);
  watchState(mount, store, bind, value => { input.checked = value === true; });
  listen(mount, input, "change", () => {
    const result = store.set(bind, input.checked);
    if (!result.ok) input.checked = store.get(bind) === true;
    report(mount, result);
  });
  return wrapper;
}

export function actionButton(mount: Mount): HTMLElement {
  const store = mount.context.state!;
  const button = root(mount, "button");
  button.type = "button";
  if (mount.node.props.tone === "info") button.dataset.tone = "info";
  watchText(mount, mount.node.props.label!, ["label"], value => { button.textContent = value; });
  listen(mount, button, "click", () => report(mount, store.dispatch(mount.node.props.action as unknown as StateAction)));
  return button;
}
