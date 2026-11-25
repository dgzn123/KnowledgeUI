import { Component, loadPrism, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";
import type { CodeToken, HostAdapter } from "#contracts";
import { runCleanup } from "../../core/renderer/lifetime.ts";
import { isLocalWikiPath, nativeMarkdown } from "./markdown.ts";

const imageTypes = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
const interactionEvents = [
  "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click", "dblclick",
] as const;

type PrismPart = string | { type: string; alias?: string | string[]; content: PrismPart | PrismPart[] };

async function highlightCode(code: string, language: string, signal: AbortSignal): Promise<readonly CodeToken[] | undefined> {
  if (signal.aborted || !/^[a-z_][a-z0-9_]{0,63}$/i.test(language)) return undefined;
  try {
    const prism: { languages: Readonly<Record<string, unknown>>; tokenize(code: string, grammar: object): PrismPart[] } = await loadPrism();
    if (signal.aborted || !Object.hasOwn(prism.languages, language)) return undefined;
    const grammar = prism.languages[language];
    if (!grammar || typeof grammar !== "object") return undefined;

    const tokens: CodeToken[] = [];
    function append(part: PrismPart | PrismPart[], classes: readonly string[]): void {
      if (typeof part === "string") {
        tokens.push({ text: part, classes });
      } else if (Array.isArray(part)) {
        for (const item of part) append(item, classes);
      } else {
        const aliases = typeof part.alias === "string" ? [part.alias] : part.alias ?? [];
        const names = [part.type, ...aliases].filter(name => /^[a-z][a-z0-9_-]*$/i.test(name));
        append(part.content, [...new Set([...classes, ...names])]);
      }
    }
    append(prism.tokenize(code, grammar), []);
    return tokens.map(token => token.text).join("") === code ? tokens : undefined;
  } catch {
    return undefined;
  }
}

class MarkdownResources extends Component {
  #released = false;

  release(): void {
    this.#released = true;
  }

  override onunload(): void {
    this.release();
  }

  override addChild<T extends Component>(child: T): T {
    if (this.#released) {
      runCleanup(() => child.unload());
      return child;
    }
    return super.addChild(child);
  }

  override register(callback: () => unknown): void {
    if (this.#released) runCleanup(callback);
    else super.register(callback);
  }
}

export function createObsidianHost(app: App, owner: Component): HostAdapter {
  return {
    kind: "obsidian",
    highlightCode,
    async renderMarkdown({ markdown, container, sourceId, lifetime }) {
      const success = { ok: true, value: undefined, diagnostics: [] } as const;
      if (lifetime.signal.aborted) return success;
      const root = container.ownerDocument.createElement("div");
      root.className = "kui-obsidian-markdown";
      const resources = new MarkdownResources();
      const renderScope = lifetime.child();
      renderScope.add(() => {
        resources.release();
        root.replaceChildren();
        root.remove();
        owner.removeChild(resources);
      });
      try {
        owner.addChild(resources);
        const sourcePath = sourceId ?? "";
        const input = nativeMarkdown(markdown, (target) => {
          if (!isLocalWikiPath(target) || /[#^]/.test(target)) return undefined;
          const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
          if (file && imageTypes.has(file.extension.toLowerCase())
              && isLocalWikiPath(file.path) && !/[#^]/.test(file.path)) return file.path;
          return undefined;
        });
        if (lifetime.signal.aborted) return success;
        const cancelled = new Promise<void>((resolve) => renderScope.add(resolve));
        const rendering = MarkdownRenderer.render(app, input, root, sourcePath, resources).finally(() => {
          if (renderScope.signal.aborted) root.replaceChildren();
        });
        await Promise.race([rendering, cancelled]);
        if (!renderScope.signal.aborted) container.append(root);
        return success;
      } catch {
        renderScope.dispose();
        root.replaceChildren();
        if (lifetime.signal.aborted) return success;
        return { ok: false, diagnostics: [{
          phase: "host", code: "host.markdown-failed", severity: "error", path: [],
          message: "Obsidian could not render this Markdown.",
          ...(sourceId !== undefined && { sourceId }),
        }] };
      }
    },
    isolateInteraction(element, lifetime) {
      if (lifetime.signal.aborted) return;
      const stop = (event: Event) => event.stopPropagation();
      for (const type of interactionEvents) element.addEventListener(type, stop);
      lifetime.add(() => {
        for (const type of interactionEvents) element.removeEventListener(type, stop);
      });
    },
  };
}
