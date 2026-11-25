# 图解 Gallery

## SVG · 坐标、裁剪与动态图元

取景框裁掉轨道两侧的线段。拖动滑块查看标记的位置变化。下方的三枚刻度由同一条声明按只读数据重复绘制。

```kui
version: 1
type: interactive
state:
  offset: { type: number, default: 100, min: 60, max: 380, step: 10 }
data:
  marks: [100, 220, 340]
layout:
  type: stack
  children:
    - { type: slider, bind: offset, label: 水平位置 }
    - type: svg
      title: 轨道与标记
      viewBox: "0 0 440 108"
      elements:
        - kind: clip
          id: track
          elements:
            - { kind: rect, x: 60, y: 20, width: 320, height: 44, rx: 10 }
        - { kind: line, x1: 28, y1: 42, x2: 412, y2: 42, clip: track, strokeWidth: 2 }
        - { kind: circle, cx: "{{offset}}", cy: 42, r: 8, fill: info, stroke: none, transition: fast }
        - kind: group
          repeat: { items: marks, as: mark }
          transform: [{ kind: translate, x: "{{mark}}", y: 0 }]
          elements:
            - { kind: line, x1: 0, y1: 55, x2: 0, y2: 63 }
            - { kind: text, x: 0, y: 80, align: middle, text: "位置 {{mark}}" }
```

## Graph · 显式网格与边路由

网格用零基行、列定位节点左上角。输入经过整理到达输出。反馈边用曲线返回输入。边走向由端点和路由类型决定。

```kui
version: 1
type: graph
title: 输入、整理与输出
grid: { columnWidth: 176, rowHeight: 96 }
nodes:
  - { id: input, label: 输入, position: { row: 0, column: 0 } }
  - { id: process, label: 整理, position: { row: 0, column: 1 }, tone: info }
  - { id: output, label: 输出, position: { row: 1, column: 2 }, tone: success }
edges:
  - { from: input, to: process, route: straight }
  - { from: process, to: output, route: orthogonal }
  - { from: output, to: input, route: curve, label: 反馈 }
```

## Sequence · 固定列与逐步高亮

参与者从左至右按声明排序。步进器依次高亮请求、处理和返回，虚线表示返回消息。

```kui
version: 1
type: interactive
state:
  step: { type: number, default: 0, min: 0, max: 2, step: 1 }
layout:
  type: stack
  children:
    - { type: stepper, bind: step, labels: [请求, 处理, 返回] }
    - type: sequence
      title: 请求与返回
      participants:
        - { id: sender, label: 发起方 }
        - { id: receiver, label: 接收方 }
      messages:
        - { from: sender, to: receiver, label: 提交请求 }
        - { from: receiver, to: receiver, label: 处理请求 }
        - { from: receiver, to: sender, label: 返回结果, kind: return }
      activeStep: "{{step}}"
```
