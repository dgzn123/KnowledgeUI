# 基础组件补充 Gallery

## 表格与进度

表格比较两批记录。数量与完成进度使用同一组数据。切换批次可观察整行数据、进度上限和计数一起更新。

```kui
version: 1
type: interactive
state:
  batch: {type: number, label: 样例批次, default: 0, min: 0, max: 1, step: 1}
data:
  records:
    - {caption: 首批记录, completed: 2, total: 4, rows: [[已核对, 2, 来源与日期均已核对, 对照原记录], [待核对, 2, 仍需检查摘要与原记录是否一致, 留待下轮]]}
    - {caption: 次批记录, completed: 6, total: 8, rows: [[已核对, 6, 已完成两轮整理并复核出处, 已记录出处与日期], [待核对, 2, 等待补齐缺失说明后逐项核对, 留待下轮]]}
layout:
  type: stack
  children:
    - {type: stepper, bind: batch, labels: [首批, 次批]}
    - type: table
      caption: "{{records[batch].caption}}"
      columns:
        - {label: 状态}
        - {label: 数量, align: end, emphasis: true}
        - {label: 备注}
        - {label: 复查记录}
      rows: "{{records[batch].rows}}"
    - type: progress
      label: 已核对
      value: "{{records[batch].completed}}"
      max: "{{records[batch].total}}"
      tone: success
```

## 公式、变量与推导

完成比例等于已完成数量除以总数量。两种数量都以“项”计，比例无量纲。计算要求总数量大于零。

```kui
version: 1
type: formula
ariaLabel: 完成比例的计算
latex: 'p = \frac{n}{N}'
variables:
  - {symbol: n, meaning: 已完成数量, unit: 项}
  - {symbol: N, meaning: 总数量, unit: 项}
  - {symbol: p, meaning: 完成比例，无量纲}
conditions: 总数量大于零，且已完成数量不超过总数量。
steps:
  - {latex: 'n = 2,\quad N = 4', explanation: 从首批记录取出已完成数量和总数量。}
  - {latex: 'p = \frac{2}{4} = 0.5', explanation: 代入后得到完成比例 0.5，写成百分比为 50%。}
```

## 切换视图与展开细节

页签在概览和检查项之间切换。用方向键移动焦点，按回车或空格切换视图。

```kui
version: 1
type: tabs
ariaLabel: 样例汇总视图
tabs:
  - title: 概览
    children:
      - {type: text, body: 汇总按是否完成核对来区分记录。}
  - title: 检查项
    children:
      - type: collapse
        label: 展开核对步骤
        content:
          type: markdown
          body: |-
            1. 核对记录的出处与日期。
            2. 对照原记录补全摘要。
```
