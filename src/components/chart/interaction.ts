import type { Lifetime } from "#contracts";
import { formatNumber } from "./geometry.ts";
import { attr, element, placePoint, textContent } from "./plot.ts";
import type { Hit } from "./plot.ts";

export interface AxisLabels {
  readonly x: string;
  readonly y: string;
  readonly xUnit: string;
  readonly yUnit: string;
}

type InputMethod = "mouse" | "touch" | "keyboard";

export class ChartInteraction {
  readonly #surface: HTMLElement;
  readonly #output: HTMLElement;
  readonly #cursor: SVGCircleElement;
  #hits: readonly Hit[] = [];
  #labels: AxisLabels = { x: "", y: "", xUnit: "", yUnit: "" };
  #active: string | undefined;
  #method: InputMethod | undefined;

  constructor(root: HTMLElement, surface: HTMLElement, cursor: SVGCircleElement, hintId: string, lifetime: Lifetime) {
    this.#surface = surface;
    this.#cursor = cursor;
    const hint = element(root, "span", "kui-chart-hint");
    hint.id = hintId;
    hint.textContent = "Use Left and Right to explore data points, Home or End to jump, and Escape to clear the value.";
    attr(surface, "aria-describedby", hintId);
    this.#output = element(root, "div", "kui-chart-readout");
    attr(this.#output, "role", "status");
    attr(this.#output, "aria-atomic", "true");
    surface.tabIndex = 0;
    attr(surface, "role", "group");

    const listen = <K extends keyof HTMLElementEventMap>(type: K, callback: (event: HTMLElementEventMap[K]) => void) => {
      surface.addEventListener(type, callback);
      lifetime.add(() => surface.removeEventListener(type, callback));
    };
    listen("pointermove", event => {
      if (event.pointerType === "mouse") this.#pointer(event, "mouse");
    });
    listen("pointerup", event => {
      if (event.isPrimary && event.button === 0) this.#pointer(event, event.pointerType === "mouse" ? "mouse" : "touch");
    });
    listen("pointerleave", () => {
      if (this.#method === "mouse") this.#select(undefined, undefined);
    });
    listen("focus", () => {
      if (this.#active === undefined && surface.matches(":focus-visible")) this.#select(this.#hits[0], "keyboard");
    });
    listen("blur", () => {
      if (this.#method === "keyboard") this.#select(undefined, undefined);
    });
    listen("keydown", event => this.#keyboard(event));
  }

  update(hits: readonly Hit[], labels: AxisLabels, name: string): void {
    this.#hits = hits;
    this.#labels = labels;
    attr(this.#surface, "aria-label", name || "Explore chart data");
    const tabIndex = hits.length === 0 ? -1 : 0;
    if (this.#surface.tabIndex !== tabIndex) this.#surface.tabIndex = tabIndex;
    this.#select(hits.find(hit => hit.key === this.#active), this.#method);
  }

  #keyboard(event: KeyboardEvent): void {
    let index = this.#hits.findIndex(hit => hit.key === this.#active);
    switch (event.key) {
      case "ArrowLeft": index = Math.max(index - 1, 0); break;
      case "ArrowRight": index = Math.min(index + 1, this.#hits.length - 1); break;
      case "Home": index = 0; break;
      case "End": index = this.#hits.length - 1; break;
      case "Escape": index = -1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.#select(this.#hits[index], "keyboard");
  }

  #pointer(event: PointerEvent, method: "mouse" | "touch"): void {
    const svg = this.#cursor.ownerSVGElement!;
    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const x = (event.clientX - bounds.left) * svg.viewBox.baseVal.width / bounds.width;
    const y = (event.clientY - bounds.top) * svg.viewBox.baseVal.height / bounds.height;
    let nearest: Hit | undefined;
    let distance = (method === "touch" ? 36 : 26) ** 2;
    for (const hit of this.#hits) {
      const next = (hit.x - x) ** 2 + (hit.y - y) ** 2;
      if (next < distance) {
        distance = next;
        nearest = hit;
      }
    }
    this.#select(nearest, method);
  }

  #select(hit: Hit | undefined, method: InputMethod | undefined): void {
    this.#active = hit?.key;
    this.#method = method;
    attr(this.#cursor, "visibility", hit ? "visible" : "hidden");
    if (!hit) {
      textContent(this.#output, "");
      return;
    }
    placePoint(this.#cursor, hit.x, hit.y);
    const { x, y, label } = hit.point;
    const { x: xLabel, y: yLabel, xUnit, yUnit } = this.#labels;
    const xText = [xLabel || "x", formatNumber(x), xUnit].filter(Boolean).join(" ");
    const yText = [yLabel || "y", formatNumber(y), yUnit].filter(Boolean).join(" ");
    textContent(this.#output, [hit.group, label, xText, yText].filter(Boolean).join(" · "));
  }
}
