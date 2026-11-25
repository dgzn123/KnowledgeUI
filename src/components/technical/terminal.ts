import { append, scrollSurface, watchText } from "./dom.ts";
import type { Mount } from "./dom.ts";

interface TerminalLine {
  readonly kind: "command" | "output" | "error";
  readonly text: string;
  readonly prompt?: string;
}

export function mountTerminal(mount: Mount, root: HTMLElement): void {
  const { lines, prompt } = mount.node.props;
  const surface = scrollSurface(mount, root, "Terminal transcript");
  const transcript = append(surface, "code", "kui-terminal-transcript");
  for (const [index, item] of (lines as unknown as readonly TerminalLine[]).entries()) {
    if (index > 0) transcript.append("\n");
    const row = append(transcript, "span", "kui-terminal-line");
    row.dataset.kind = item.kind;
    if (item.kind === "command" || item.prompt !== undefined) {
      const marker = append(row, "span", "kui-terminal-prompt");
      const setPrompt = (value: string) => {
        marker.textContent = value === "" || /\s$/.test(value) ? value : value + " ";
      };
      setPrompt(item.kind === "command" ? (typeof prompt === "string" ? prompt : "$") : "");
      if (item.prompt !== undefined) watchText(mount, item.prompt, ["lines", index, "prompt"], setPrompt);
    }
    const body = append(row, "span");
    watchText(mount, item.text, ["lines", index, "text"], value => { body.textContent = value; });
  }
}
