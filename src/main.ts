import { MarkdownRenderChild, Plugin } from "obsidian";
import type { BlockRenderer, HostAdapter } from "#contracts";
import { createObsidianHost } from "./adapters/obsidian/index.ts";
import { diagnosticItem, diagnosticList } from "./core/renderer/diagnostics.ts";
import { createLifetime } from "./core/renderer/lifetime.ts";

export function createKnowledgeUiPlugin(createRenderer: (host: HostAdapter) => BlockRenderer): typeof Plugin {
  return class KnowledgeUiPlugin extends Plugin {
    readonly #blocks = new Set<MarkdownRenderChild>();
    #running = false;

    override onload(): void {
      this.#running = true;
      this.registerMarkdownCodeBlockProcessor("kui", (yaml, container, context) => {
        if (!this.#running) return;
        const app = this.app;
        const blocks = this.#blocks;
        const sourceId = context.sourcePath;
        const child = new class extends MarkdownRenderChild {
          readonly #lifetime = createLifetime();

          override onload(): void {
            if (!blocks.has(this) || this.#lifetime.signal.aborted) return;
            try {
              const host = createObsidianHost(app, this);
              const mount = createRenderer(host).mountBlock({ source: { yaml, sourceId }, container });
              this.#lifetime.add(() => mount.dispose());
            } catch {
              if (this.#lifetime.signal.aborted) return;
              const list = diagnosticList(container, "Knowledge UI diagnostics");
              list.append(diagnosticItem(container.ownerDocument, {
                phase: "host", code: "host.block-failed", severity: "error",
                message: "Knowledge UI could not start this block.", path: [], sourceId,
              }));
              this.#lifetime.add(() => list.remove());
            }
          }

          override onunload(): void {
            blocks.delete(this);
            this.#lifetime.dispose();
          }
        }(container);
        blocks.add(child);
        try {
          context.addChild(child);
        } catch (error) {
          blocks.delete(child);
          child.unload();
          throw error;
        }
      });
    }

    override onunload(): void {
      this.#running = false;
      for (const block of this.#blocks) block.unload();
      this.#blocks.clear();
    }
  };
}
