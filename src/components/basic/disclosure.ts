import type { ComponentSemanticValidator, JsonObject } from "#contracts";
import { append, listen, mountSlot, own, rootElement, semanticIssue, watchText } from "./mount.ts";
import type { BasicMount } from "./mount.ts";

export const validateTabs: ComponentSemanticValidator = input => {
  const { tabs, initial } = input.node.props;
  return Array.isArray(tabs) && typeof initial === "number" && initial >= tabs.length
    ? [semanticIssue(input, "semantic.tabs-initial", "Initial tab index must identify a declared tab.", ["initial"])]
    : [];
};

export function tabs(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "div");
  const tablist = append(root, "div", "kui-tabs-list");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", mount.node.ariaLabel ?? "Views");
  mount.context.host.isolateInteraction(tablist, mount.lifetime);
  const panes = append(root, "div", "kui-tabs-panels");
  const { instanceId } = mount.context;
  const items = own(mount.node.props, "tabs") as readonly JsonObject[];
  const handlers = items.map((item, index) => {
    const button = append(tablist, "button", "kui-tabs-tab");
    const panel = append(panes, "div", "kui-tabs-panel");
    button.type = "button";
    button.id = instanceId + "-tab-" + index;
    button.tabIndex = -1;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel.id = instanceId + "-panel-" + index);
    button.setAttribute("aria-selected", "false");
    panel.tabIndex = 0;
    panel.hidden = true;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    watchText(mount, own(item, "title"), ["tabs", index, "title"], value => { button.textContent = value; });
    let mounted = false;
    return { button, panel, mountPanel() {
      if (mounted) return;
      mounted = true;
      mountSlot(mount, panel, "/tabs/" + index + "/children");
    } };
  });
  let selected: number | undefined;
  let focusable: number | undefined;

  function focusableTab(index: number): HTMLButtonElement {
    if (focusable !== undefined) handlers[focusable]!.button.tabIndex = -1;
    const { button } = handlers[index]!;
    button.tabIndex = 0;
    focusable = index;
    return button;
  }

  function select(index: number): void {
    focusableTab(index);
    if (selected === index) return;
    if (selected !== undefined) {
      const previous = handlers[selected]!;
      previous.button.setAttribute("aria-selected", "false");
      previous.panel.hidden = true;
    }
    selected = index;
    const current = handlers[index]!;
    current.button.setAttribute("aria-selected", "true");
    current.panel.hidden = false;
    current.mountPanel();
  }

  for (const [index, { button }] of handlers.entries()) {
    listen(mount, button, "click", () => select(index));
    listen(mount, button, "keydown", event => {
      let next: number;
      switch (event.key) {
        case "ArrowLeft": next = (index + handlers.length - 1) % handlers.length; break;
        case "ArrowRight": next = (index + 1) % handlers.length; break;
        case "Home": next = 0; break;
        case "End": next = handlers.length - 1; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      focusableTab(next).focus();
    });
  }
  const initial = own(mount.node.props, "initial");
  select(typeof initial === "number" ? initial : 0);
  return root;
}

export function collapse(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "details");
  const summary = append(root, "summary", "kui-collapse-label");
  summary.textContent = own(mount.node.props, "label") as string;
  mount.context.host.isolateInteraction(summary, mount.lifetime);
  const content = append(root, "div", "kui-collapse-content");
  let mounted = false;
  const reveal = () => {
    if (!root.open || mounted) return;
    mounted = true;
    mountSlot(mount, content, "/content");
  };
  listen(mount, root, "toggle", reveal);
  root.open = own(mount.node.props, "open") === true;
  reveal();
  return root;
}
