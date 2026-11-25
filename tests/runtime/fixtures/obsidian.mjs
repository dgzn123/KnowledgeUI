// Lifecycle fake for the public Obsidian APIs used by the adapter and entry point.
export class Component {
  children = new Set();
  cleanups = [];
  loaded = false;

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.onload?.();
    for (const child of this.children) child.load();
  }

  unload() {
    if (!this.loaded) return;
    this.loaded = false;
    this.onunload?.();
    for (const child of this.children) child.unload();
    for (const callback of this.cleanups.splice(0)) callback();
  }

  addChild(child) {
    this.children.add(child);
    if (this.loaded) child.load();
    return child;
  }

  removeChild(child) {
    if (this.children.delete(child)) child.unload();
    return child;
  }

  register(callback) {
    this.cleanups.push(callback);
  }
}

export class MarkdownRenderChild extends Component {
  constructor(containerEl) {
    super();
    this.containerEl = containerEl;
  }
}

export class Plugin extends Component {
  constructor(app) {
    super();
    this.app = app;
  }

  registerMarkdownCodeBlockProcessor(language, handler) {
    this.language = language;
    this.processor = handler;
  }
}

export class MarkdownRenderer {
  static render;
}

export const prismFixture = { load: async () => undefined };

export function loadPrism() {
  return prismFixture.load();
}
