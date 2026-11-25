import type { HostAdapter } from "#contracts";
import { readMarkdown, webLink } from "../markdown.ts";
import type { MarkdownPart } from "../markdown.ts";

function renderInline(
  destination: HTMLElement,
  content: Extract<MarkdownPart, { kind: "paragraph" }>["content"],
): void {
  const document = destination.ownerDocument;
  for (const token of content) {
    if (token.kind === "text") {
      destination.append(token.text);
    } else if (token.kind === "link") {
      const href = webLink(token.target);
      if (!href) {
        destination.append(token.text);
        continue;
      }
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = token.text;
      destination.append(anchor);
    } else {
      const element = document.createElement(
        token.kind === "strong" ? "strong" : token.kind === "emphasis" ? "em"
          : token.kind === "code" || token.kind === "math" ? "code" : "span",
      );
      element.textContent = token.text;
      if (token.kind === "math") {
        element.className = "kui-markdown-latex";
        element.title = "LaTeX 原文";
      } else if (token.kind === "wiki" || token.kind === "attachment") {
        element.className = "kui-markdown-reference";
        element.title = token.target;
        element.textContent += token.kind === "wiki" ? "（内部链接）" : "（附件）";
      }
      destination.append(element);
    }
  }
}

function renderBlocks(root: HTMLElement, parts: readonly MarkdownPart[]): void {
  const document = root.ownerDocument;
  for (const part of parts) {
    switch (part.kind) {
      case "divider":
        root.append(document.createElement("hr"));
        break;
      case "code":
      case "math": {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = part.text;
        if (part.kind === "math") {
          pre.className = "kui-markdown-latex";
          pre.setAttribute("aria-label", "LaTeX 原文");
        }
        pre.append(code);
        root.append(pre);
        break;
      }
      case "list": {
        const list = document.createElement(part.start === undefined ? "ul" : "ol");
        if (part.start !== undefined) list.setAttribute("start", String(part.start));
        for (const item of part.items) {
          const element = document.createElement("li");
          renderBlocks(element, item.content);
          list.append(element);
        }
        root.append(list);
        break;
      }
      case "quote": {
        const quote = document.createElement("blockquote");
        renderBlocks(quote, part.blocks);
        root.append(quote);
        break;
      }
      case "heading":
      case "paragraph": {
        const element = document.createElement(part.kind === "heading" ? "h" + part.level : "p");
        renderInline(element, part.content);
        root.append(element);
        break;
      }
    }
  }
}

export function createBrowserHost(): HostAdapter {
  return {
    kind: "browser",
    async renderMarkdown({ markdown, container, lifetime }) {
      if (lifetime.signal.aborted) return { ok: true, value: undefined, diagnostics: [] };
      const document = container.ownerDocument;
      const root = document.createElement("div");
      root.className = "kui-browser-markdown";
      renderBlocks(root, readMarkdown(markdown));
      if (!lifetime.signal.aborted) {
        container.append(root);
        lifetime.add(() => root.remove());
      }
      return { ok: true, value: undefined, diagnostics: [] };
    },
    isolateInteraction() {
      // Browser preview has no enclosing editor to isolate.
    },
  };
}
