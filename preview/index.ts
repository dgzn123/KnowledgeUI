import type { BlockRenderer, Disposable, HostAdapter, MarkdownBlockScanner } from "#contracts";
import { createBrowserHost } from "../src/adapters/browser/index.ts";
import { diagnosticItem, diagnosticList } from "../src/core/renderer/diagnostics.ts";
import { createLifetime } from "../src/core/renderer/lifetime.ts";
import { segmentDocument } from "./document.ts";

export type PreviewSource = { readonly label: string } & (
  | { readonly markdown: string; readonly sourceId?: string }
  | { readonly path: string }
);

const defaults: readonly PreviewSource[] = [
  { label: "示例笔记", path: "./sample.md" },
  { label: "组件 Gallery", path: "./gallery.md" },
];

const widths = [
  ["桌面宽屏", "1100"],
  ["桌面窄窗", "840"],
  ["平板", "650"],
  ["手机（375 px）", "375"],
] as const;

function labeledSelect(
  document: Document, label: string, options: readonly (readonly [string, string])[],
): { wrapper: HTMLLabelElement; select: HTMLSelectElement } {
  const wrapper = document.createElement("label");
  const select = document.createElement("select");
  for (const [name, value] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = name;
    select.append(option);
  }
  wrapper.append(label, select);
  return { wrapper, select };
}

export function mountPreview(
  container: HTMLElement,
  createRenderer: (host: HostAdapter) => BlockRenderer,
  scanner: MarkdownBlockScanner,
  sources: readonly PreviewSource[] = defaults,
): Disposable {
  const document = container.ownerDocument;
  const lifetime = createLifetime();
  const host = createBrowserHost();
  const renderer = createRenderer(host);

  const shell = document.createElement("div");
  shell.className = "kui-preview theme-light";
  shell.dataset.theme = "light";
  const header = document.createElement("header");
  header.className = "kui-preview-header";
  const title = document.createElement("h1");
  title.textContent = "Knowledge UI 预览";
  const controls = document.createElement("div");
  controls.className = "kui-preview-controls";
  const sourceSelect = labeledSelect(document, "笔记", [
    ...sources.map(({ label }, index) => [label, String(index)] as const),
    ["本地文件", "file"],
  ]);
  const theme = labeledSelect(document, "主题", [["浅色", "light"], ["深色", "dark"]]);
  const width = labeledSelect(document, "宽度", widths);
  const fileLabel = document.createElement("label");
  fileLabel.className = "kui-preview-file";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".md,.markdown,text/markdown,text/plain";
  fileLabel.append("打开 Markdown", file);
  controls.append(sourceSelect.wrapper, fileLabel, theme.wrapper, width.wrapper);
  const limits = document.createElement("p");
  limits.className = "kui-preview-limits";
  limits.textContent = "浏览器以原文显示 LaTeX、内部链接与附件。Reading View 和 Live Preview 需在 Obsidian 中验证。";
  const status = document.createElement("p");
  status.className = "kui-preview-status";
  status.setAttribute("role", "status");
  header.append(title, controls, limits, status);

  const viewport = document.createElement("main");
  viewport.className = "kui-preview-viewport";
  viewport.setAttribute("aria-label", "笔记预览");
  viewport.style.setProperty("--kui-preview-width", width.select.value + "px");
  const article = document.createElement("article");
  article.className = "kui-preview-document";
  viewport.append(article);
  shell.append(header, viewport);
  container.append(shell);
  lifetime.add(() => shell.remove());

  let active = lifetime.child();
  let localFile: File | undefined;

  async function open(
    label: string, load: (signal: AbortSignal) => Promise<{ markdown: string; sourceId: string }>,
  ): Promise<void> {
    active.dispose();
    const scope = lifetime.child();
    active = scope;
    article.replaceChildren();
    status.textContent = "正在打开 " + label;
    const output = document.createElement("div");
    article.append(output);
    scope.add(() => output.remove());
    try {
      const { markdown, sourceId } = await load(scope.signal);
      if (scope.signal.aborted) return;
      const scan = scanner.scan(markdown, sourceId);
      if (scan.diagnostics.length) {
        const list = diagnosticList(output, "Markdown 扫描诊断");
        for (const diagnostic of scan.diagnostics) list.append(diagnosticItem(document, diagnostic));
      }
      for (const segment of segmentDocument(markdown, scan.ok ? scan.value : [])) {
        if (scope.signal.aborted) return;
        if (segment.kind === "block") {
          const target = document.createElement("div");
          target.className = "kui-preview-block";
          output.append(target);
          const block = renderer.mountBlock({ source: segment.block, container: target });
          scope.add(() => block.dispose());
        } else if (segment.markdown.trim()) {
          await host.renderMarkdown({ markdown: segment.markdown, container: output, sourceId, lifetime: scope });
        }
      }
      if (!scope.signal.aborted) status.textContent = "已打开 " + label;
    } catch {
      if (scope.signal.aborted) return;
      scope.dispose();
      status.textContent = "无法打开 " + label;
    }
  }

  function openSelected(): void {
    if (sourceSelect.select.value === "file") {
      if (localFile) {
        const selected = localFile;
        void open(selected.name, async () => ({ markdown: await selected.text(), sourceId: selected.name }));
      } else {
        active.dispose();
        status.textContent = "请选择 Markdown 文件";
      }
      return;
    }
    const source = sources[Number(sourceSelect.select.value)];
    if (!source) return;
    void open(source.label, async (signal) => {
      if ("markdown" in source) return { markdown: source.markdown, sourceId: source.sourceId ?? source.label };
      const url = new URL(source.path, document.baseURI);
      if (url.origin !== document.location?.origin || !/^https?:$/.test(url.protocol)
          || url.username || url.password) throw new Error("Expected a local preview resource");
      const response = await fetch(url, { signal, redirect: "error", credentials: "omit" });
      if (!response.ok) throw new Error("Preview resource could not be read");
      return { markdown: await response.text(), sourceId: source.path };
    });
  }

  const updateFile = () => {
    if (!file.files?.[0]) return;
    localFile = file.files[0];
    file.value = "";
    sourceSelect.select.value = "file";
    openSelected();
  };
  const updateTheme = () => {
    const dark = theme.select.value === "dark";
    shell.dataset.theme = theme.select.value;
    shell.classList.toggle("theme-dark", dark);
    shell.classList.toggle("theme-light", !dark);
  };
  const updateWidth = () => { viewport.style.setProperty("--kui-preview-width", width.select.value + "px"); };
  for (const [element, listener] of [
    [sourceSelect.select, openSelected], [file, updateFile],
    [theme.select, updateTheme], [width.select, updateWidth],
  ] as const) {
    element.addEventListener("change", listener);
    lifetime.add(() => element.removeEventListener("change", listener));
  }
  openSelected();
  return lifetime;
}
