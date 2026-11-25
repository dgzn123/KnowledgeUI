import type { ComponentSemanticValidator, FieldPath } from "#contracts";
import { asRange, isHighlightList, lineCount } from "./code-lines.ts";
import type { Annotation, Highlight, LineRange } from "./code-lines.ts";
import { lineIssue } from "./dom.ts";

interface HighlightIssue {
  readonly path: FieldPath;
  readonly code: "code-line-out-of-range" | "code-range-order";
  readonly message: string;
}

export function checkHighlights(items: readonly Highlight[], count?: number): {
  readonly ranges: LineRange[];
  readonly issues: HighlightIssue[];
} {
  const ranges: LineRange[] = [];
  const issues: HighlightIssue[] = [];
  for (const [index, item] of items.entries()) {
    const path = ["highlight", index];
    const range = asRange(item);
    if (range.from > range.to) {
      issues.push({ path, code: "code-range-order", message: "The first line must precede or equal the last line." });
    } else if (count !== undefined && range.to > count) {
      issues.push({ path, code: "code-line-out-of-range", message: `The code contains ${count} lines.` });
    } else {
      ranges.push(range);
    }
  }
  return { ranges, issues };
}

export const validateCode: ComponentSemanticValidator = ({ node, sourceId }) => {
  const { code, highlight, annotations } = node.props;
  const count = typeof code === "string" && !code.includes("{{") ? lineCount(code) : undefined;
  const issues = highlight !== undefined && isHighlightList(highlight) ? checkHighlights(highlight, count).issues : [];
  if (count !== undefined) {
    const notes = (annotations ?? []) as unknown as readonly Annotation[];
    for (const [index, { line }] of notes.entries()) {
      if (line > count) {
        issues.push({ path: ["annotations", index, "line"], code: "code-line-out-of-range",
          message: `The code contains ${count} lines.` });
      }
    }
  }
  return issues.map(({ path, code: issue, message }) => lineIssue(node, sourceId, "semantic", path, issue, message));
};
