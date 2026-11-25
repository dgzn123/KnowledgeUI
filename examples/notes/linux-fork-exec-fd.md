# Linux 的 fork、exec 与文件描述符

子进程读了 4 个字节，为什么父进程下一次读取也会从第 5 个字节开始？`fork()` 给子进程自己的描述符表，表项仍指向同一个打开文件描述（open file description）。理解这个区别，也就能预测 `execve()` 之后哪些描述符仍可用。

## 从 FD 到打开文件描述

- 文件描述符（FD）是进程用来定位本进程表项的整数索引。`FD_CLOEXEC` 属于 FD 表项。
- 打开文件描述保存文件偏移与打开状态标志。父子进程对应的 FD 可以指向同一份打开文件描述。
- 对同一路径独立调用两次 `open()` 会得到两份打开文件描述。即使指向同一文件，它们的偏移仍可独立。 [Linux man-pages：open(2)](https://man7.org/linux/man-pages/man2/open.2.html)

`fork()` 在父进程中返回子进程 PID，在子进程中返回 0。两者的虚拟地址空间各自独立，Linux 通常通过写时复制实现私有页面的分离。显式共享映射按各自的映射语义处理。两个进程都可以继续运行，先后顺序由调度和同步决定。 [Linux man-pages：fork(2)](https://man7.org/linux/man-pages/man2/fork.2.html)

成功的 `execve()` 在同一 PID 下用新程序替换地址空间。标了 `FD_CLOEXEC` 的 FD 在成功时关闭，其余 FD 继续指向原来的打开文件描述。若调用以普通错误返回，原程序需处理错误，close-on-exec 也尚未发生。 [Linux man-pages：execve(2)](https://man7.org/linux/man-pages/man2/execve.2.html) · [F_GETFD(2const)](https://man7.org/linux/man-pages/man2/F_GETFD.2const.html)

## 逐步追踪两份打开文件描述

假设单线程程序只以 FD 0、1、2 启动，使用至少 8 字节的普通文件。父进程以只读方式打开同一路径两次，约定得到 FD 3 和 FD 4。FD 3 指向 A，FD 4 指向 B，B 对应的 FD 带 close-on-exec。子进程成功从 A 读取 4 字节，然后执行一个检查所继承 FD 的程序。父进程等待子进程结束，再查看偏移并关闭两个 FD。下文偏移以字节计。

1. **打开完成**。父 FD 3 → A，FD 4 → B。各有 1 个可见表项，偏移都是 0。
2. **fork 返回**。子进程复制两个 FD 表项。A、B 各有 2 个可见表项，偏移都是 0。
3. **子读成功**。A 的共享偏移变为 4，B 保持 0。A、B 仍各有 2 个可见表项。
4. **子 exec 成功**。子 FD 4 被关闭，子 FD 3 保留。A 有 2 个可见表项，B 有 1 个，偏移仍为 4 和 0。
5. **子退出，父 wait 返回**。A、B 各只剩 1 个父进程表项，偏移为 4 和 0。
6. **父关闭两个 FD**。A、B 的可见表项数均为 0，无法再通过这些 FD 查询偏移。

图解可把父、子描述符表画成两列，把 A、B 画成共享对象。`fork()` 后新增两条子进程到打开文件描述的边，`execve()` 成功后删去子 FD 4 的边，同时替换子进程的程序映像。这里的计数只统计本实验两张表的可见引用。Linux 内部可能因临时持有、传递等出现其他引用，因此这里的计数是教学简化。真实设备、管道等也未必有可查询的文件偏移。

以下 C 片段展示调用顺序。`path` 指向输入文件。`inspector`、`argv`、`envp` 由调用方提供。检查程序应在 FD 4 被复用前查询它。片段省略常规错误处理，生产代码应检查打开、读取、执行和等待结果。

```c
int shared = open(path, O_RDONLY);
int private_open = open(path, O_RDONLY | O_CLOEXEC);
pid_t child = fork();
if (child == 0) {
    char bytes[4];
    if (read(shared, bytes, sizeof bytes) != (ssize_t)sizeof bytes) _exit(2);
    execve(inspector, argv, envp);
    _exit(127);
}
waitpid(child, NULL, 0);
off_t shared_pos = lseek(shared, 0, SEEK_CUR);
off_t other_pos = lseek(private_open, 0, SEEK_CUR);
close(shared);
close(private_open);
```

下面是成功路径的示意记录。检查程序用 `fcntl(fd, F_GETFD)` 查询表项，用 `lseek(fd, 0, SEEK_CUR)` 查询偏移。

```text
child after exec: fd 3 offset = 4
child after exec: fd 4 = EBADF
parent after wait: fd 3 offset = 4, fd 4 offset = 0
```

连续前进到「子读 4 字节」，确认只有 A 的偏移增加。再前进一步，图中子进程的 FD 4 连线应消失，A 的偏移和两条有效连线保持一致。图中的连线数对应本例可见 FD 表项。

```kui
version: 1
type: interactive
state:
  phase: {type: number, default: 0, min: 0, max: 5, step: 1}
data:
  frames:
    - {lines: [{from: 1, to: 2}], a: 1, b: 1, offset: "0", parent: true, child: false, inherited: false, image: "—", observation: "父进程独立打开两次，同一文件产生 A、B 两份打开文件描述。"}
    - {lines: [3], a: 2, b: 2, offset: "0", parent: true, child: true, inherited: true, image: "原程序", observation: "子进程复制 FD 表项，两个描述符分别继续引用 A 和 B。"}
    - {lines: [6], a: 2, b: 2, offset: "4", parent: true, child: true, inherited: true, image: "原程序", observation: "子进程从 A 读到 abcd，A 的共享偏移推进 4 字节。"}
    - {lines: [7], a: 2, b: 1, offset: "4", parent: true, child: true, inherited: false, image: "检查程序", observation: "child after exec: fd 3 offset = 4, fd 4 = EBADF"}
    - {lines: [{from: 10, to: 12}], a: 1, b: 1, offset: "4", parent: true, child: false, inherited: false, image: "—", observation: "parent after wait: fd 3 offset = 4, fd 4 offset = 0"}
    - {lines: [{from: 13, to: 14}], a: 0, b: 0, offset: "—", parent: false, child: false, inherited: false, image: "—", observation: "父进程关闭两个 FD，两份打开文件描述均无本例可见引用。"}
computed:
  frame: frames[phase]
layout:
  type: stack
  children:
    - {type: stepper, bind: phase, label: 文件描述符生命周期, labels: [打开完成, fork 返回, 子读 4 字节, 子 exec 成功, 父 wait 返回, 父关闭 FD]}
    - type: svg
      title: 进程映像与打开文件描述
      viewBox: "0 0 420 260"
      elements:
        - {kind: rect, x: 8, y: 12, width: 144, height: 100, rx: 4, fill: none}
        - {kind: text, x: 18, y: 34, text: 父进程 · 原程序映像}
        - {kind: text, x: 18, y: 64, text: "FD 3{{frame.parent ? '' : ' · 已关闭'}}"}
        - {kind: text, x: 18, y: 92, text: "FD 4{{frame.parent ? ' · CLOEXEC' : ' · 已关闭'}}"}
        - kind: group
          when: frame.child
          elements:
            - {kind: rect, x: 8, y: 145, width: 144, height: 100, rx: 4, fill: none}
            - {kind: text, x: 18, y: 167, text: "子进程 · {{frame.image}}"}
            - {kind: text, x: 18, y: 197, text: FD 3}
            - {kind: text, x: 18, y: 225, text: "FD 4{{frame.inherited ? ' · CLOEXEC' : ' · 已关闭'}}"}
        - {kind: rect, x: 261, y: 42, width: 151, height: 76, rx: 4, fill: none}
        - {kind: text, x: 273, y: 67, text: "A · 引用 {{frame.a}}"}
        - {kind: text, x: 273, y: 93, text: "偏移 {{frame.offset}}{{frame.parent ? ' B' : ''}}"}
        - {kind: rect, x: 261, y: 147, width: 151, height: 76, rx: 4, fill: none}
        - {kind: text, x: 273, y: 172, text: "B · 引用 {{frame.b}}"}
        - {kind: text, x: 273, y: 198, text: "偏移 {{frame.parent ? '0 B' : '—'}}"}
        - {kind: arrow, when: frame.parent, x1: 153, y1: 59, x2: 260, y2: 59, stroke: info}
        - {kind: arrow, when: frame.parent, x1: 153, y1: 88, x2: 260, y2: 165, stroke: warning}
        - {kind: arrow, when: frame.child, x1: 153, y1: 193, x2: 260, y2: 102, stroke: info}
        - {kind: arrow, when: frame.inherited, x1: 153, y1: 221, x2: 260, y2: 204, stroke: warning}
    - type: terminal
      title: 当前观测
      lines:
        - {kind: output, text: "{{frame.observation}}"}
    - type: code
      title: 对应的系统调用
      language: c
      lineNumbers: true
      code: |-
        int shared = open(path, O_RDONLY);
        int private_open = open(path, O_RDONLY | O_CLOEXEC);
        pid_t child = fork();
        if (child == 0) {
            char bytes[4];
            if (read(shared, bytes, sizeof bytes) != (ssize_t)sizeof bytes) _exit(2);
            execve(inspector, argv, envp);
            _exit(127);
        }
        waitpid(child, NULL, 0);
        off_t shared_pos = lseek(shared, 0, SEEK_CUR);
        off_t other_pos = lseek(private_open, 0, SEEK_CUR);
        close(shared);
        close(private_open);
      highlight: "{{frame.lines}}"
```

**自测**：若用 `dup(3)` 代替第二次 `open()`，再给得到的 FD 单独设置 `FD_CLOEXEC`，父进程等待后两个 FD 分别在什么位置？两者都在字节偏移 4，因为它们指向同一份打开文件描述。`execve()` 只关闭子进程带标志的 FD。
