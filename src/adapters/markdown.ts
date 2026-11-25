type Inline =
  | { readonly kind: "text" | "code" | "math" | "strong" | "emphasis"; readonly text: string }
  | { readonly kind: "link" | "wiki" | "attachment"; readonly text: string; readonly target: string };

interface ListItem {
  readonly marker: string;
  readonly content: readonly MarkdownPart[];
  readonly blankBefore: boolean;
}

type MarkdownBlock =
  | { readonly kind: "heading"; readonly level: number; readonly content: readonly Inline[] }
  | { readonly kind: "paragraph"; readonly content: readonly Inline[] }
  | { readonly kind: "quote"; readonly blocks: readonly MarkdownPart[] }
  | { readonly kind: "list"; readonly start: number | undefined; readonly items: readonly ListItem[] }
  | { readonly kind: "code" | "math"; readonly text: string }
  | { readonly kind: "divider" };

export type MarkdownPart = MarkdownBlock & { readonly blankBefore: boolean };

const inlinePattern = /\\([\\!\x60*$[\]<>_])|(\x60{1,16})(.+?)\2|(!?)\[\[([^\][\n]+)\]\]|(!?)\[([^\][\n]*)\]\(([^()\s<>]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(?<!\$)\$([^\n$]+)\$(?!\$)/g;

function readInline(text: string): Inline[] {
  const tokens: Inline[] = [];
  let previous = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > previous) tokens.push({ kind: "text", text: text.slice(previous, match.index) });
    const [original, escaped, , code, wikiEmbed, wiki, linkEmbed, label, target, strong, emphasis, math] = match;
    if (escaped !== undefined) tokens.push({ kind: "text", text: escaped });
    else if (code !== undefined) tokens.push({ kind: "code", text: code.trim() });
    else if (wiki !== undefined) {
      const [link = "", alias] = wiki.split("|", 2);
      tokens.push({ kind: wikiEmbed ? "attachment" : "wiki", text: alias ?? link, target: link });
    } else if (target !== undefined) {
      tokens.push({ kind: linkEmbed ? "attachment" : "link", text: label ?? target, target });
    } else if (strong !== undefined) tokens.push({ kind: "strong", text: strong });
    else if (emphasis !== undefined) tokens.push({ kind: "emphasis", text: emphasis });
    else if (math !== undefined) tokens.push({ kind: "math", text: math });
    previous = match.index + original.length;
  }
  if (previous < text.length) tokens.push({ kind: "text", text: text.slice(previous) });
  return tokens;
}

const fencePattern = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;
const headingPattern = /^ {0,3}(#{1,6})\s+(.+)$/;
const listPattern = /^( {0,3})([-+*]|\d{1,9}[.)])(?=[ \t]|$)([ \t]*)(.*)$/;
const quotePattern = /^ {0,3}>[ \t]?(.*)$/;
const dividerPattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const maxContainerDepth = 32;

interface ListMarker {
  readonly marker: string;
  readonly start: number | undefined;
  readonly indent: number;
  readonly body: string;
}

function indentationWidth(whitespace: string, start: number): number {
  let column = start;
  for (const character of whitespace) column += character === "\t" ? 4 - (column % 4) : 1;
  return column - start;
}

function readListMarker(line: string): ListMarker | undefined {
  const match = listPattern.exec(line);
  if (!match || dividerPattern.test(line)) return undefined;
  const [, leading = "", marker = "", whitespace = "", body = ""] = match;
  const width = leading.length + marker.length;
  const gap = indentationWidth(whitespace, width);
  const indent = width + (body && gap <= 4 ? gap : 1);
  return {
    marker,
    start: /^\d/.test(marker) ? Number.parseInt(marker, 10) : undefined,
    indent,
    body: body && " ".repeat(width + gap - indent) + body,
  };
}

function stripIndent(line: string, indent: number): string | undefined {
  let column = 0;
  let index = 0;
  while (column < indent) {
    if (line[index] === " ") column += 1;
    else if (line[index] === "\t") column += 4 - (column % 4);
    else return undefined;
    index += 1;
  }
  return " ".repeat(column - indent) + line.slice(index);
}

function skipBlankLines(lines: readonly string[], index: number): number {
  while (index < lines.length && !lines[index]?.trim()) index += 1;
  return index;
}

function listBlock(lines: readonly string[], index: number, first: ListMarker, depth: number) {
  const items: ListItem[] = [];
  let marker = first;
  let cursor = index;
  let blankBefore = false;
  while (true) {
    const body = [marker.body];
    cursor += 1;
    while (cursor < lines.length) {
      const next = skipBlankLines(lines, cursor);
      const content = stripIndent(lines[next] ?? "", marker.indent);
      if (content === undefined) break;
      if (next !== cursor) body.push("");
      body.push(content);
      cursor = next + 1;
    }
    items.push({ marker: marker.marker, content: readBlocks(body, depth + 1), blankBefore });

    const next = skipBlankLines(lines, cursor);
    const sibling = readListMarker(lines[next] ?? "");
    if (!sibling || sibling.marker.at(-1) !== first.marker.at(-1)) return { items, next: cursor };

    blankBefore = next !== cursor;
    marker = sibling;
    cursor = next;
  }
}

function openingFence(line: string): string | undefined {
  const match = fencePattern.exec(line);
  const fence = match?.[1];
  if (fence?.startsWith("\x60") && match?.[2]?.includes("\x60")) return undefined;
  return fence;
}

function readBlocks(lines: readonly string[], depth: number): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  let paragraph: string[] = [];
  let blankBefore = false;

  function push(part: MarkdownBlock) {
    parts.push({ ...part, blankBefore });
    blankBefore = false;
  }

  function flush() {
    if (paragraph.length > 0) push({ kind: "paragraph", content: readInline(paragraph.join(" ")) });
    paragraph = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = openingFence(line);
    const heading = headingPattern.exec(line);
    const quote = depth < maxContainerDepth ? quotePattern.exec(line) : null;
    const item = depth < maxContainerDepth ? readListMarker(line) : undefined;
    const displayMath = /^ {0,3}\$\$(.*?)\$\$\s*$/.exec(line);
    if (!line.trim()) {
      flush();
      blankBefore = true;
    } else if (fence) {
      flush();
      const closes = new RegExp("^ {0,3}" + fence[0] + "{" + fence.length + ",}[ \\t]*$");
      const content: string[] = [];
      while (++index < lines.length && !closes.test(lines[index] ?? "")) content.push(lines[index] ?? "");
      push({ kind: "code", text: content.join("\n") });
    } else if (displayMath) {
      flush();
      push({ kind: "math", text: displayMath[1] ?? "" });
    } else if (line.trim() === "$$") {
      flush();
      const content: string[] = [];
      while (++index < lines.length && lines[index]?.trim() !== "$$") content.push(lines[index] ?? "");
      push({ kind: "math", text: content.join("\n") });
    } else if (heading) {
      flush();
      push({ kind: "heading", level: heading[1]?.length ?? 1, content: readInline(heading[2] ?? "") });
    } else if (dividerPattern.test(line)) {
      flush();
      push({ kind: "divider" });
    } else if (quote) {
      flush();
      const content = [quote[1] ?? ""];
      while (index + 1 < lines.length) {
        const next = quotePattern.exec(lines[index + 1] ?? "");
        if (!next) break;
        content.push(next[1] ?? "");
        index += 1;
      }
      push({ kind: "quote", blocks: readBlocks(content, depth + 1) });
    } else if (item && (paragraph.length === 0 || (item.body && (item.start === undefined || item.start === 1)))) {
      flush();
      const list = listBlock(lines, index, item, depth);
      push({ kind: "list", start: item.start, items: list.items });
      index = list.next - 1;
    } else paragraph.push(line.trim());
  }
  flush();
  return parts;
}

export function readMarkdown(markdown: string): MarkdownPart[] {
  return readBlocks(markdown.split(/\r\n?|\n/), 0);
}

export function webLink(target: string): string | undefined {
  if (!/^https?:\/\/[^\s\\]+$/i.test(target)) return undefined;
  try {
    const url = new URL(target);
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
