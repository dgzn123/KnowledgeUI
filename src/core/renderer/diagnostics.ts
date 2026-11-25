import type { Diagnostic, FieldPath } from "#contracts";

function formatPath(path: FieldPath): string {
  return path.reduce<string>((label, segment) => {
    if (typeof segment === "number") return `${label}[${segment}]`;
    return /^[A-Za-z_$][\w$-]*$/.test(segment)
      ? `${label}.${segment}`
      : `${label}[${JSON.stringify(segment)}]`;
  }, "$");
}

export function diagnosticList(container: HTMLElement, label: string): HTMLUListElement {
  const list = container.ownerDocument.createElement("ul");
  list.className = "kui-diagnostics";
  list.setAttribute("aria-label", label);
  list.setAttribute("aria-live", "polite");
  container.append(list);
  return list;
}

export function diagnosticItem(document: Document, diagnostic: Diagnostic): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "kui-diagnostic";
  item.dataset.severity = diagnostic.severity;
  const path = formatPath(diagnostic.path);
  const start = diagnostic.range?.start;
  const location = start ? `${path} · ${start.line}:${start.column}` : path;
  const details = document.createElement("code");
  details.textContent = `${diagnostic.code} · ${location}`;
  item.append(`${diagnostic.message} `, details);
  return item;
}
