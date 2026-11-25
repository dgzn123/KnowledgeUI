import { append, label, listen, report, root, watchState } from "./dom.ts";
import type { Mount } from "./dom.ts";

export function stepper(mount: Mount): HTMLElement {
  const store = mount.context.state!;
  const { props } = mount.node;
  const bind = props.bind as string;
  const labels = props.labels as readonly string[];
  const last = labels.length - 1;
  const interval = typeof props.intervalMs === "number" ? props.intervalMs : 800;
  const wrapper = root(mount, "div");
  const heading = append(wrapper, "span", "kui-control-label");
  wrapper.setAttribute("role", "group");
  heading.id = mount.context.instanceId + "-label";
  if (mount.node.ariaLabel === undefined) wrapper.setAttribute("aria-labelledby", heading.id);
  label(mount, wrapper, bind, heading);

  const reading = append(wrapper, "p", "kui-stepper-reading");
  reading.setAttribute("role", "status");
  const actions = append(wrapper, "div", "kui-stepper-actions");
  const previous = button("Previous", () => move(-1));
  const next = button("Next", () => move(1));
  button("Reset", () => {
    pause();
    report(mount, store.dispatch({ type: "reset", bind }));
  });
  const play = button("Play", () => { if (playing) pause(); else start(); });

  let playing = false;
  let timer: number | undefined;
  const view = wrapper.ownerDocument.defaultView ?? window;
  const position = () => store.get(bind) as number;

  function button(text: string, activate: () => void): HTMLButtonElement {
    const element = append(actions, "button", "kui-stepper-action");
    element.type = "button";
    element.textContent = text;
    listen(mount, element, "click", () => {
      if (element.getAttribute("aria-disabled") !== "true") activate();
    });
    return element;
  }
  function disable(element: HTMLButtonElement, disabled: boolean): void {
    element.setAttribute("aria-disabled", String(disabled));
  }
  function move(by: number): boolean {
    const target = position() + by;
    if (target < 0 || target > last) return false;
    const result = store.set(bind, target);
    report(mount, result);
    return result.ok;
  }
  function pause(): void {
    playing = false;
    if (timer !== undefined) view.clearTimeout(timer);
    timer = undefined;
    play.textContent = "Play";
    disable(play, position() >= last);
  }
  function tick(): void {
    timer = undefined;
    if (!playing || mount.lifetime.signal.aborted) return;
    if (move(1) && position() < last) timer = view.setTimeout(tick, interval);
    else pause();
  }
  function start(): void {
    if (playing || position() >= last || mount.lifetime.signal.aborted) return;
    playing = true;
    play.textContent = "Pause";
    disable(play, false);
    timer = view.setTimeout(tick, interval);
  }
  watchState(mount, store, bind, value => {
    if (typeof value !== "number") return;
    reading.textContent = String(value + 1) + " / " + String(labels.length) + " · " + labels[value];
    disable(previous, value <= 0);
    disable(next, value >= last);
    if (value >= last) pause();
    else disable(play, false);
  });
  mount.lifetime.add(pause);
  if (props.autoplay === true) start();
  return wrapper;
}
