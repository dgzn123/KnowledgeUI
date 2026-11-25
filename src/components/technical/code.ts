import type { Lifetime } from "#contracts";
import { frameTask } from "../../core/expression/frame.ts";
import { applySyntax, isHighlightList, mountLines } from "./code-lines.ts";
import type { Annotation, CodeLine, Highlight } from "./code-lines.ts";
import { append, lineIssue, scrollSurface, watch, watchText } from "./dom.ts";
import type { Mount } from "./dom.ts";
import { checkHighlights } from "./validation.ts";

export function mountCode(mount: Mount, root: HTMLElement): void {
  const { node, context, lifetime } = mount;
  const { language, code, highlight, annotations, lineNumbers } = node.props;
  const grammar = typeof language === "string" ? language : undefined;
  const surface = scrollSurface(mount, root, "Code listing");
  const source = append(surface, "code", "kui-code-source");
  // Obsidian rewrites the children of code blocks marked with a language class.
  if (grammar !== undefined) source.dataset.language = grammar;
  const status = grammar === undefined ? undefined : append(root, "p", "kui-code-syntax-status");
  const notes = (annotations ?? []) as unknown as readonly Annotation[];
  const noteList = notes.length ? append(root, "ul", "kui-code-annotations") : undefined;
  noteList?.setAttribute("role", "list");
  const noteRows = notes.map(({ line, text }, index) => {
    const row = append(noteList!, "li", "kui-code-annotation");
    append(row, "span", "kui-code-annotation-line").textContent = `Line ${line}`;
    const body = append(row, "span", "kui-code-annotation-text");
    watchText(mount, text, ["annotations", index, "text"], value => { body.textContent = value; });
    return row;
  });

  let syntaxRequest: Lifetime | undefined;
  let currentCode: string | undefined;
  let nextCode = "";
  let highlights: readonly Highlight[] = [];
  let lines: readonly CodeLine[] = [];
  let selected = new Set<number>();

  function setSyntax(state: "plain" | "pending" | "highlighted"): void {
    root.dataset.syntax = state;
    if (status) {
      status.hidden = state !== "plain";
      status.textContent = state === "plain" ? `${grammar} · Syntax highlighting unavailable` : "";
    }
  }

  function highlightSyntax(text: string, rows: readonly CodeLine[]): void {
    syntaxRequest?.dispose();
    const { host } = context;
    const { highlightCode } = host;
    if (grammar === undefined || highlightCode === undefined) {
      syntaxRequest = undefined;
      setSyntax("plain");
      return;
    }
    const scope = lifetime.child();
    syntaxRequest = scope;
    setSyntax("pending");
    void (async () => {
      try {
        const tokens = await highlightCode.call(host, text, grammar, scope.signal);
        if (scope.signal.aborted) return;
        if (tokens && tokens.map(token => token.text).join("") === text) {
          applySyntax(rows, tokens);
          setSyntax("highlighted");
        } else {
          setSyntax("plain");
        }
      } catch {
        if (!scope.signal.aborted) setSyntax("plain");
      } finally {
        if (syntaxRequest === scope) syntaxRequest = undefined;
        scope.dispose();
      }
    })();
  }

  function update(): void {
    if (currentCode !== nextCode) {
      currentCode = nextCode;
      lines = mountLines(source, currentCode, lineNumbers === true);
      selected.clear();
      for (const [index, { line }] of notes.entries()) {
        const outside = line > lines.length;
        noteRows[index]!.hidden = outside;
        if (outside) context.report(lineIssue(node, context.sourceId, "render", ["annotations", index, "line"],
          "code-line-out-of-range", `The code contains ${lines.length} lines.`));
      }
      if (noteList) noteList.hidden = noteRows.every(row => row.hidden);
      highlightSyntax(currentCode, lines);
    }

    const { ranges, issues } = checkHighlights(highlights, lines.length);
    for (const issue of issues) {
      context.report(lineIssue(node, context.sourceId, "render", issue.path, issue.code, issue.message));
    }
    const next = new Set<number>();
    if (issues.length === 0) {
      let last = 0;
      for (const { from, to } of ranges.sort((left, right) => left.from - right.from)) {
        for (let line = Math.max(from, last + 1); line <= to; line++) next.add(line);
        last = Math.max(last, to);
      }
    }
    for (const line of selected) {
      if (!next.has(line)) lines[line - 1]!.row.removeAttribute("data-highlighted");
    }
    for (const line of next) {
      if (!selected.has(line)) lines[line - 1]!.row.setAttribute("data-highlighted", "");
    }
    selected = next;
  }

  // When both values are bound, wait for both observers before checking line boundaries.
  const batch = typeof code === "string" && code.includes("{{") && typeof highlight === "string"
    ? frameTask(update) : undefined;
  if (batch) lifetime.add(() => batch.dispose());
  let ready = false;
  const refresh = () => {
    if (!ready) return;
    if (batch) batch.schedule();
    else update();
  };
  if (code !== undefined) watchText(mount, code, ["code"], value => {
    if (value === nextCode) return;
    nextCode = value;
    refresh();
  });
  if (highlight !== undefined) {
    watch(mount, highlight, ["highlight"], isHighlightList, "a list of up to 256 one-based line numbers or ranges", value => {
      highlights = value ?? [];
      refresh();
    });
  }
  ready = true;
  update();
}
