export const previewDocuments = [
  { label: "示例笔记", source: "preview/sample.md", output: "sample.md" },
  { label: "组件 Gallery", source: "examples/Component Gallery.md", output: "component-gallery.md" },
  { label: "MOSFET 特性与小信号", source: "examples/notes/mosfet.md", output: "mosfet.md" },
  { label: "Linux 进程与文件描述符", source: "examples/notes/linux-fork-exec-fd.md", output: "linux-fork-exec-fd.md" },
  { label: "TCP 握手与拥塞窗口", source: "examples/notes/tcp-handshake-congestion.md", output: "tcp-handshake-congestion.md" },
  { label: "链表反转与树遍历", source: "examples/notes/linked-list-reversal.md", output: "linked-list-reversal.md" },
  { label: "二阶系统的阻尼", source: "examples/notes/second-order-system.md", output: "second-order-system.md" },
] as const;

export const componentSamples = { label: "组件专项样例", output: "gallery.md" } as const;
