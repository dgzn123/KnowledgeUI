import type { FieldPath, JsonValue, Result } from "#contracts";
import { append, diagnostic, own, watchText } from "./mount.ts";
import type { BasicMount } from "./mount.ts";

export function mountMarkdown(mount: BasicMount, root: HTMLElement): void {
  watchMarkdown(mount, root, own(mount.node.props, "body"), ["body"]);
}

export function watchMarkdown(
  mount: BasicMount, root: HTMLElement, value: JsonValue | undefined, field: FieldPath,
  format: (text: string) => string | undefined = text => text,
): void {
  const { context, lifetime } = mount;
  let active: typeof lifetime | undefined;
  let lastText: string | undefined;

  watchText(mount, value, field, text => {
    if (text === lastText) return;
    lastText = text;
    active?.dispose();
    if (lifetime.signal.aborted || text !== lastText) return;
    const revision = lifetime.child();
    active = revision;
    const target = append(root, "div", "kui-markdown-content");
    revision.add(() => target.remove());
    const markdown = format(text);
    if (markdown === undefined) {
      target.classList.add("kui-markdown-fallback");
      target.textContent = text;
      return;
    }
    void render(markdown);

    async function render(markdown: string): Promise<void> {
      let result: Result<void>;
      try {
        result = await context.host.renderMarkdown({
          markdown,
          container: target,
          lifetime: revision,
          ...(context.sourceId !== undefined && { sourceId: context.sourceId }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          ok: false,
          diagnostics: [diagnostic(mount, "host.basic-markdown", message, field)],
        };
      }
      if (revision.signal.aborted) return;

      if (!result.ok) {
        revision.dispose();
        if (lifetime.signal.aborted || active !== revision) return;
        const fallback = lifetime.child();
        active = fallback;
        const plain = append(root, "div", "kui-markdown-content kui-markdown-fallback");
        plain.textContent = text;
        fallback.add(() => plain.remove());
      }
      for (const item of result.diagnostics) context.report(item);
    }
  });
}
