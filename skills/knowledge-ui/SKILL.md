---
name: knowledge-ui
description: 编写、重构或审查使用 Knowledge UI Protocol v1 的 Obsidian 教学笔记。适用于需要选型、编写或修复 kui 围栏、图表、图解、离散演示和自测的场景。普通 Markdown 编辑无需启用。
---

# Knowledge UI 教学笔记

1. 明确读者的预备知识、要回答的问题和学完后能做的判断。先用原生 Markdown 写出核心结论、因果链、关键公式或步骤，连同模型条件和图解结论。参考 [教学重构](references/teaching.md) 核对事实、公式和来源。
2. 每个交互块只服务一个学习问题。用下方决策树选原语，按组件名检索 [活动组件参考](references/components.md)。核对必填项、插槽及允许插值的位置，按 [Protocol v1](references/protocol.md) 写 YAML。
3. 静态图标清单位、映射和读图结论。交互先写默认值、边界和可独立复算的预期，再设计状态。相关模式见 [图形与可视化](references/visualization.md)、[状态与步进](references/interaction.md) 和 [排版](references/design-system.md)。
4. 在 Knowledge UI 源码检出中使用生产 CLI 显式校验目标笔记。按文件和行号修正诊断，复验默认状态、边界和学习任务。条件允许时用正式 Preview 加载笔记，查看深浅色、窄宽容器和键盘操作。报告实际核验范围。

## 选型决策树

- 结论、解释、列表、引用或少量公式能读懂时，保留原生 Markdown。有关键值或单个重要注意点时，可用 `metric` 或 `callout` 辅助。并排对比用 `compare`，二维查值用 `table`，补充推导可放进 `collapse`。
- 读取变化趋势、分布或数值关系时用 `chart`。理解空间、结构或几何对应时用 `svg`。理解节点连通性和指针时用 `graph`，跟踪参与者之间的消息时用 `sequence`。
- 阅读源码、终端记录和目录时分别用 `code`、`terminal`、`file-tree`。需要逐帧定位代码或图形时，用一个 `interactive` 中的 `stepper` 同步显示。
- 要改变有意义的模型输入时，用 `slider` 探索范围、`number-input` 精确输入、`select` 切换方案或 `toggle` 切换布尔条件。练习需要即时反馈时，用 `quiz` 给出可解释的选项和反馈。
- 先组合现有原语。已有内置符号和模板可以复用，按所在产品版本核对名称与参数。读者必须能从围栏外的 Markdown 获取学习结论。

## 可运行范例

- [两点分布的期望](examples/two-point-mean.md)展示滑块、计算和连续更新的柱形图。
- [二分查找插入位置](examples/lower-bound.md)展示一个可核对不变量的离散过程。
- [杠杆力矩平衡](examples/lever-equilibrium.md)展示给出假设和单位的公式与示意图。

领域参考按需阅读 [模拟电子技术](references/domains/analog-electronics.md)或 [Linux 与操作系统](references/domains/linux-os.md)。

## 验证

从含当前运行时的仓库根目录运行，路径可为绝对路径。安装方式见源码检出内的 [README](../../README.md#codex-skill)。

```sh
npm run validate -- "/path/to/note.md"
node skills/knowledge-ui/scripts/validate.mjs
```

第二条命令校验本 Skill 的黄金示例。需要定位版本、YAML、结构或语义错误时，使用 CLI 返回的文件位置、诊断代码和字段路径。验收时检查围栏外可读性、引用与复算、默认和边界输出、图形标签及失败时的可读性。
