# Linux 与操作系统笔记

先声明系统、API、内核或工具版本范围。区分接口保证与具体实现，共享状态按对象层级讲解。例如进程内的文件描述符条目引用打开文件描述，后者维护文件偏移。进程复制后可共享打开文件描述，描述符标志仍属于各自条目。成功更换进程映像时，标有 close-on-exec 的描述符会被关闭。用观察结果说明每个步骤判断的对象层。

用 `stepper` 同步 `svg` 节点和 `code` 行高亮，可用 `terminal` 呈现标注过的演示记录。显式说明哪些行是执行所得，哪些是简化示意。核对返回值、失败处理、继承关系及事件先后。若调度允许多种交错，把观测到的示例顺序与 API 保证分开。具体接口细节以目标系统的手册页或对应规范为准。

文件描述符、打开文件描述和 exec 时的保留规则可查 Linux 手册的 DESCRIPTION。 [open(2)](https://man7.org/linux/man-pages/man2/open.2.html) · [fork(2)](https://man7.org/linux/man-pages/man2/fork.2.html) · [execve(2)](https://man7.org/linux/man-pages/man2/execve.2.html)
