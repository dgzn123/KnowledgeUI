# 图表与函数可视化

## 比较记录值

区域表示基准范围，柱形和散点表示各次记录，折线显示随序号变化的趋势。这里只比较示例数据。相邻记录之间的连线用于阅读趋势。

```kui
version: 1
type: chart
title: 四次记录
xAxis: {label: 记录序号, min: 0, max: 5}
yAxis: {label: 读数, unit: 单位, min: 0, max: 12}
series:
  - type: area
    label: 基准趋势
    tone: neutral
    points: [{x: 1, y: 3}, {x: 2, y: 4}, {x: 3, y: 4}, {x: 4, y: 5}]
  - type: bar
    label: 第一组记录
    tone: info
    points: [{x: 1, y: 4}, {x: 2, y: 7}, {x: 3, y: 5}, {x: 4, y: 8}]
  - type: line
    label: 目标趋势
    tone: success
    points: [{x: 1, y: 6}, {x: 2, y: 7}, {x: 3, y: 8}, {x: 4, y: 9}]
  - type: scatter
    label: 第二组记录
    tone: danger
    points: [{x: 1, y: 6.5}, {x: 2, y: 5.5}, {x: 3, y: 8.5}, {x: 4, y: 9.5, label: 第四次}]
referenceLines:
  - {axis: y, value: 8, label: 参考读数 8, tone: warning}
regions:
  - {axis: y, from: 3, to: 5, label: 基准范围}
```

## 观察当前工作点

假设响应满足无量纲模型 y = k·x²，横坐标在 0 至 4 之间。移动滑块可改变系数和工作点。曲线通过有限采样近似显示，工作点的数值直接由模型计算。

```kui
version: 1
type: interactive
state:
  factor: {type: number, label: 系数 k, default: 1, min: 0.5, max: 2, step: 0.5}
  position: {type: number, label: 当前位置, default: 2, min: 0, max: 4, step: 0.25}
computed:
  response: factor * position ^ 2
layout:
  type: stack
  children:
    - {type: slider, bind: factor}
    - {type: slider, bind: position}
    - type: chart
      title: 二次响应
      xAxis: {label: 位置 x, min: 0, max: 4}
      yAxis: {label: 响应 y, min: 0, max: 32}
      series:
        - {type: function, label: "k = {{factor}}", tone: info, expr: "factor * x ^ 2", samples: 97}
        - {type: function, label: "k = 1", tone: neutral, expr: "x ^ 2", samples: 97}
      referenceLines:
        - {axis: x, value: "{{position}}", tone: info}
      markers:
        - {x: "{{position}}", y: "{{response}}", label: "工作点 y = {{response}}"}
```

## 查看跨数量级的关系

对数轴上的等距离对应相同倍数。下图在 1 至 1000 的正值区间比较无量纲恒等关系，每次乘以 10 时，横纵坐标各自在轴上移动的距离保持相同。

```kui
version: 1
type: chart
title: 对数坐标下的 y = x
xAxis: {label: x, scale: log, min: 1, max: 1000}
yAxis: {label: y, scale: log, min: 1, max: 1000}
series:
  - {type: function, expr: x, samples: 97, tone: info}
  - type: scatter
    label: 整十倍位置
    tone: success
    points: [{x: 1, y: 1}, {x: 10, y: 10}, {x: 100, y: 100}, {x: 1000, y: 1000}]
```
