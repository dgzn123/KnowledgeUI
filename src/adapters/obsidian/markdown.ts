import { readMarkdown, webLink } from "../markdown.ts";
import type { MarkdownPart } from "../markdown.ts";

// Entity-encode punctuation so user text cannot form new Markdown or HTML tokens.
function literal(text: string): string {
  return text.replace(/[!-/:-@[-^\x60{-~]/g, (character) => "&#" + character.charCodeAt(0) + ";");
}

const wikiPath = /^[\p{L}\p{M}\p{N} _./#^()'-]+$/u;

export function isLocalWikiPath(path: string): boolean {
  return wikiPath.test(path) && !path.startsWith("/") && !path.split("/").includes("..");
}

const texCommands = new Set([
  "frac", "dfrac", "tfrac", "sqrt", "left", "right", "big", "Big", "bigg", "Bigg",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta",
  "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "phi", "varphi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Omega", "infty",
  "cdot", "cdots", "ldots", "dots", "times", "div", "pm", "mp", "partial", "nabla",
  "le", "ge", "leq", "geq", "lt", "gt", "ne", "neq", "approx", "equiv", "sim", "propto",
  "sin", "cos", "tan", "arcsin", "arccos", "arctan", "exp", "log", "ln", "min", "max",
  "lim", "sum", "prod", "int", "oint", "mathrm", "mathbf", "mathit", "mathbb", "mathcal",
  "text", "operatorname", "begin", "end", "overline", "underline", "hat", "vec", "bar",
  "to", "mapsto", "rightarrow", "leftarrow", "Rightarrow", "in", "notin", "subset",
  "cup", "cap", "quad", "qquad", "\\", " ", "{", "}", ",", ";", "!", "%", "|", "_",
]);
const texEnvironment = /^(?:\{(?:aligned|gathered|cases|[bBpvV]?matrix)\})/;

function math(text: string, display: boolean): string {
  const source = text.trim();
  if (!source || /[\x60<>$%!]|\[\[|\]\s*\(|~{3,}/.test(source)
      || (!display && source.includes("&"))) return literal(display ? "$$" + text + "$$" : "$" + text + "$");
  for (const match of source.matchAll(/\\([A-Za-z]+|[\s\S])/g)) {
    const command = match[1] ?? "";
    if (!texCommands.has(command) || ((command === "begin" || command === "end")
        && !texEnvironment.test(source.slice(match.index + match[0].length)))) {
      return literal(display ? "$$" + text + "$$" : "$" + text + "$");
    }
  }
  return display ? "$$\n" + source + "\n$$" : "$" + source + "$";
}

function code(text: string, block: boolean): string {
  let width = block ? 3 : 1;
  for (const match of text.matchAll(/\x60+/g)) width = Math.max(width, match[0].length + 1);
  const fence = String.fromCharCode(96).repeat(width);
  return block ? fence + "\n" + text + "\n" + fence : fence + " " + text + " " + fence;
}

export function nativeMarkdown(
  markdown: string,
  resolveImage: (target: string) => string | undefined,
): string {
  function inline(content: Extract<MarkdownPart, { kind: "paragraph" }>["content"]): string {
    return content.map((token) => {
      switch (token.kind) {
        case "text": return literal(token.text);
        case "strong": return "**" + literal(token.text) + "**";
        case "emphasis": return "*" + literal(token.text) + "*";
        case "code": return code(token.text, false);
        case "math": return math(token.text, false);
        case "wiki": {
          if (!isLocalWikiPath(token.target)) return literal(token.text);
          const alias = token.text === token.target ? "" : "|" + literal(token.text);
          return "[[" + token.target + alias + "]]";
        }
        case "link": {
          const href = webLink(token.target)?.replace(/[()]/g, (value) => value === "(" ? "%28" : "%29");
          return href ? "[" + literal(token.text) + "](" + href + ")" : literal(token.text);
        }
        case "attachment": {
          const source = resolveImage(token.target);
          return source ? "![[" + source + "]]" : literal(token.text + "（附件）");
        }
      }
    }).join("");
  }

  function renderBlocks(parts: readonly MarkdownPart[]): string {
    return parts.map((part, index) => {
      const separator = index === 0 ? "" : part.blankBefore ? "\n\n" : "\n";
      return separator + block(part);
    }).join("");
  }

  function block(part: MarkdownPart): string {
    switch (part.kind) {
      case "heading": return "#".repeat(part.level) + " " + inline(part.content);
      case "paragraph": return inline(part.content);
      case "quote": return renderBlocks(part.blocks).split("\n").map((line) => "> " + line).join("\n");
      case "divider": return "---";
      case "code": return code(part.text, true);
      case "math": return math(part.text, true);
      case "list": return part.items.map((item, index) => {
        const [first = "", ...rest] = renderBlocks(item.content).split("\n");
        const indent = " ".repeat(item.marker.length + 1);
        const blank = index > 0 && item.blankBefore ? "\n" : "";
        return blank + [item.marker + " " + first, ...rest.map((line) => line ? indent + line : "")].join("\n");
      }).join("\n");
    }
  }

  return renderBlocks(readMarkdown(markdown));
}
