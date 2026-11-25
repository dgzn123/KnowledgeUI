# 两点分布的期望

一种假想抽样每次给出 0 分或 4 分。设抽到 4 分的概率为 p，抽到 0 分的概率为 1 − p。平均得分的模型值是 0 × (1 − p) + 4 × p = 4p 分。p 无量纲，范围为 0 到 1。固定 p 的多次独立抽样中，样本均值随样本数增大趋近这个期望。单次结果只能取 0 或 4 分。

预测 p 从 0.25 调到 0.75 时的变化。两根柱的高度分别是 1 − p 与 p，总和保持 1。期望从 1 分增加到 3 分。端点 p = 0 和 p = 1 时结果分别固定在 0 分和 4 分。图中显示给定模型的概率。

```kui
version: 1
type: interactive
state:
  p: {type: number, label: 抽到 4 分的概率 p, default: 0.25, min: 0, max: 1, step: 0.25}
computed:
  meanScore: 4 * p
layout:
  type: stack
  children:
    - {type: slider, bind: p}
    - {type: metric, label: 期望得分, value: '{{meanScore}}', unit: 分}
    - type: chart
      title: 两种得分的概率
      ariaLabel: 横轴是得分，纵轴是概率，两点取值为零分和四分
      xAxis: {label: 得分, unit: 分, min: -1, max: 5}
      yAxis: {label: 概率, min: 0, max: 1}
      series:
        - type: bar
          label: 概率
          tone: info
          points:
            - {x: 0, y: '{{1 - p}}', label: 零分}
            - {x: 4, y: '{{p}}', label: 四分}
```
