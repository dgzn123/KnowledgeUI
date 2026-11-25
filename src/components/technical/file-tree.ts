import type { FieldPath } from "#contracts";
import { append, watchText } from "./dom.ts";
import type { Mount } from "./dom.ts";

type Entry =
  | { readonly kind: "file"; readonly name: string; readonly detail?: string }
  | { readonly kind: "directory"; readonly name: string; readonly children: readonly Entry[] };

export function mountFileTree(mount: Mount, root: HTMLElement): void {
  const { entries, openDepth } = mount.node.props;
  const initialDepth = typeof openDepth === "number" ? openDepth : 1;

  function mountList(parent: HTMLElement, items: readonly Entry[], depth: number, field: FieldPath): HTMLUListElement {
    const list = append(parent, "ul", "kui-file-tree-list");
    list.setAttribute("role", "list");
    for (const [index, entry] of items.entries()) {
      const row = append(list, "li", "kui-file-tree-entry");
      if (entry.kind === "directory") {
        const directory = append(row, "details", "kui-file-tree-directory");
        directory.open = depth < initialDepth;
        append(directory, "summary", "kui-file-tree-summary").textContent = entry.name;
        if (entry.children.length) mountList(directory, entry.children, depth + 1, [...field, index, "children"]);
      } else {
        const file = append(row, "div", "kui-file-tree-file");
        append(file, "span", "kui-file-tree-name").textContent = entry.name;
        if (entry.detail !== undefined) {
          const detail = append(file, "span", "kui-file-tree-detail");
          watchText(mount, entry.detail, [...field, index, "detail"], value => { detail.textContent = value; });
        }
      }
    }
    return list;
  }

  const list = mountList(root, entries as unknown as readonly Entry[], 0, ["entries"]);
  mount.context.host.isolateInteraction(list, mount.lifetime);
}
