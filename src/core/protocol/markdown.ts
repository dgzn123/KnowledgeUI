import type { MarkdownBlock, MarkdownBlockScanner } from "#contracts";

type Container = { readonly kind: "quote" } | { readonly kind: "list"; readonly padding: number };

interface Cursor {
  readonly index: number;
  readonly column: number;
  /** Remaining columns of a tab partially consumed as indentation. */
  readonly tab: number;
}

const beginning: Cursor = { index: 0, column: 0, tab: 0 };

function advance(cursor: Cursor, amount: number): Cursor {
  return { index: cursor.index + amount, column: cursor.column + amount, tab: 0 };
}

function indent(line: string, cursor: Cursor, maximum: number): Cursor {
  let { index, column, tab } = cursor;
  const end = column + maximum;
  while (column < end) {
    if (tab > 0) {
      const consumed = Math.min(tab, end - column);
      tab -= consumed;
      column += consumed;
    } else if (line[index] === "\t") {
      tab = 4 - column % 4;
      index++;
    } else if (line[index] === " ") {
      index++;
      column++;
    } else {
      break;
    }
  }
  return { index, column, tab };
}

function rest(line: string, cursor: Cursor): string {
  return " ".repeat(cursor.tab) + line.slice(cursor.index);
}

function quote(line: string, cursor: Cursor): Cursor | undefined {
  const start = indent(line, cursor, 3);
  if (start.tab || line[start.index] !== ">") return;
  return indent(line, advance(start, 1), 1);
}

function list(line: string, cursor: Cursor): Cursor | undefined {
  const start = indent(line, cursor, 3);
  if (start.tab || /^(?:([*+-])(?:[ \t]*\1){2,}[ \t]*)$/.test(line.slice(start.index))) return;
  const marker = /^(?:[-+*]|[0-9]{1,9}[.)])(?=[ \t]|$)/.exec(line.slice(start.index))?.[0];
  if (!marker) return;

  const end = advance(start, marker.length);
  const padded = indent(line, end, 5);
  if (padded.column - end.column <= 4 && padded.index < line.length) return padded;
  // Blank list markers and markers followed by indented code use one space.
  const first = indent(line, end, 1);
  return first.column === end.column ? { ...first, column: first.column + 1 } : first;
}

function continueContainer(line: string, cursor: Cursor, container: Container): Cursor | undefined {
  if (container.kind === "quote") return quote(line, cursor);
  const start = indent(line, cursor, container.padding);
  if (start.column - cursor.column === container.padding || /^[ \t]*$/.test(rest(line, start))) return start;
  return undefined;
}

interface Fence {
  readonly marker: string;
  readonly length: number;
  readonly indent: number;
  readonly info: string;
}

function fence(line: string, cursor: Cursor): Fence | undefined {
  const start = indent(line, cursor, 3);
  if (start.tab) return;
  const match = /^(`{3,}|~{3,})([\s\S]*)$/.exec(line.slice(start.index));
  if (!match) return;
  const run = match[1]!;
  const info = match[2]!.replace(/^[ \t]+|[ \t]+$/g, "");
  if (run[0] === "`" && info.includes("`")) return;
  return { marker: run[0]!, length: run.length, indent: start.column - cursor.column, info };
}

interface OpenFence {
  readonly fence: Fence;
  readonly lines: string[];
  readonly startLine: number;
}

export const markdownBlockScanner: MarkdownBlockScanner = {
  scan(markdown, sourceId) {
    const blocks: MarkdownBlock[] = [];
    const containers: Container[] = [];
    let open: OpenFence | undefined;
    let inComment = false;
    let lineNumber = 0;
    const close = (endLine: number) => {
      if (open?.fence.info === "kui") {
        blocks.push({ yaml: open.lines.join(""), startLine: open.startLine, endLine, ...(sourceId !== undefined && { sourceId }) });
      }
      open = undefined;
    };

    for (const match of markdown.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
      if (match[0].length === 0) break;
      lineNumber++;
      const line = lineNumber === 1 ? match[1]!.replace(/^\uFEFF/, "") : match[1]!;
      const eol = match[2] === "\r" ? "\n" : match[2]!;
      let cursor = beginning;
      let matched = 0;
      for (const container of containers) {
        const next = continueContainer(line, cursor, container);
        if (!next) break;
        cursor = next;
        matched++;
      }
      if (matched < containers.length) {
        // Reprocess the first outer line after ending the inner block.
        close(lineNumber);
        inComment = false;
        containers.length = matched;
      }

      if (open) {
        const candidate = fence(line, cursor);
        if (candidate && candidate.marker === open.fence.marker && candidate.length >= open.fence.length && !candidate.info) {
          close(lineNumber + 1);
        } else if (open.fence.info === "kui") {
          open.lines.push(rest(line, indent(line, cursor, open.fence.indent)) + eol);
        }
        continue;
      }

      if (inComment) {
        inComment = !line.includes("-->", cursor.index);
        continue;
      }

      for (;;) {
        const quoted = quote(line, cursor);
        if (quoted) {
          containers.push({ kind: "quote" });
          cursor = quoted;
          continue;
        }
        const listed = list(line, cursor);
        if (!listed) break;
        containers.push({ kind: "list", padding: listed.column - cursor.column });
        cursor = listed;
      }
      // HTML comment blocks start after at most three columns of indentation.
      const start = indent(line, cursor, 3);
      if (!start.tab && line.startsWith("<!--", start.index)) {
        inComment = !line.includes("-->", start.index);
        continue;
      }
      const opening = fence(line, cursor);
      if (opening) open = { fence: opening, startLine: lineNumber + 1, lines: [] };
    }
    close(lineNumber + 1);
    return { ok: true, value: blocks, diagnostics: [] };
  },
};
