import type { CodeToken, JsonValue } from "#contracts";
import { append } from "./dom.ts";

export type LineRange = {
  readonly from: number;
  readonly to: number;
};

export type Highlight = number | LineRange;

export interface Annotation {
  readonly line: number;
  readonly text: string;
}

export function lineCount(code: string): number {
  return code.split(/\r\n|\r|\n/).length;
}

export function isHighlightList(value: JsonValue): value is readonly Highlight[] {
  const isLine = (item: unknown): item is number => typeof item === "number" && Number.isInteger(item) && item > 0;
  return Array.isArray(value) && value.length <= 256 && value.every(item => {
    if (isLine(item)) return true;
    return item !== null && typeof item === "object" && !Array.isArray(item)
      && Object.hasOwn(item, "from") && Object.hasOwn(item, "to")
      && Object.keys(item).length === 2 && isLine(item.from) && isLine(item.to);
  });
}

export function asRange(item: Highlight): LineRange {
  return typeof item === "number" ? { from: item, to: item } : item;
}

export interface CodeLine {
  readonly row: HTMLSpanElement;
  readonly content: HTMLSpanElement;
  readonly text: string;
  readonly ending: string;
}

export function mountLines(source: HTMLElement, code: string, numbered: boolean): CodeLine[] {
  const fragment = source.ownerDocument.createDocumentFragment();
  const parts = code.split(/(\r\n|\r|\n)/);
  const lines: CodeLine[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const row = source.ownerDocument.createElement("span");
    row.className = "kui-code-line";
    if (numbered) {
      const gutter = append(row, "span", "kui-code-number");
      gutter.setAttribute("aria-hidden", "true");
      gutter.dataset.line = String(lines.length + 1);
    }
    const content = append(row, "span", "kui-code-text");
    const text = parts[index]!;
    const ending = parts[index + 1] ?? "";
    content.textContent = text;
    fragment.append(row);
    if (ending) fragment.append(ending);
    // A standalone CR in a text node needs a visual line break in the browser.
    if (ending === "\r") fragment.append(source.ownerDocument.createElement("br"));
    lines.push({ row, content, text, ending });
  }
  source.replaceChildren(fragment);
  if (numbered) source.style.setProperty("--kui-line-digits", String(lines.length).length + "ch");
  return lines;
}

export function applySyntax(lines: readonly CodeLine[], tokens: readonly CodeToken[]): void {
  let offset = 0;
  let tokenIndex = 0;
  let tokenStart = 0;
  for (const { content, text, ending } of lines) {
    const end = offset + text.length;
    const fragment = content.ownerDocument.createDocumentFragment();
    let colored = false;
    while (tokenIndex < tokens.length && tokenStart < end) {
      const token = tokens[tokenIndex]!;
      const tokenEnd = tokenStart + token.text.length;
      const part = token.text.slice(Math.max(0, offset - tokenStart), end - tokenStart);
      if (part) {
        const names = token.classes.filter(name => /^[a-z][a-z0-9_-]*$/i.test(name));
        if (names.length === 0) {
          fragment.append(part);
        } else {
          const span = content.ownerDocument.createElement("span");
          span.classList.add("token", ...names);
          span.textContent = part;
          fragment.append(span);
          colored = true;
        }
      }
      if (tokenEnd > end) break;
      tokenStart = tokenEnd;
      tokenIndex++;
    }
    if (colored) content.replaceChildren(fragment);
    offset = end + ending.length;
  }
}
