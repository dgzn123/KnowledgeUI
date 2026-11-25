import type { MarkdownBlock } from "#contracts";

type MarkdownSegment =
  | { readonly kind: "markdown"; readonly markdown: string }
  | { readonly kind: "block"; readonly block: MarkdownBlock };

/** Use the scanner's source extent while retaining the original Markdown between blocks. */
export function segmentDocument(markdown: string, blocks: readonly MarkdownBlock[]): MarkdownSegment[] {
  const lineOffsets = [0];
  for (const newline of markdown.matchAll(/\r\n?|\n/g)) {
    lineOffsets.push(newline.index + newline[0].length);
  }

  const segments: MarkdownSegment[] = [];
  let cursor = 0;
  for (const block of blocks) {
    const opening = lineOffsets[block.startLine - 2] ?? markdown.length;
    if (cursor < opening) segments.push({ kind: "markdown", markdown: markdown.slice(cursor, opening) });
    segments.push({ kind: "block", block });
    cursor = lineOffsets[block.endLine - 1] ?? markdown.length;
  }
  if (cursor < markdown.length) segments.push({ kind: "markdown", markdown: markdown.slice(cursor) });
  return segments;
}
