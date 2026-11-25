# 声明式扩展

## 模板参数与实例状态

两个实例都把偏移量加到各自的初始值上，数值为无量纲计数。编辑任一个偏移量，只影响该实例。移动外层滑块会更新第一个实例的初始值，并把它的偏移量重置为 0。第二个实例的初始值固定为 8，保留自己的偏移量。

```kui
version: 1
type: interactive
state:
  baseline: { type: number, label: 第一个实例的初始值, default: 3, min: 1, max: 10, step: 1 }
layout:
  type: stack
  children:
    - type: slider
      bind: baseline
    - type: template
      name: common:adjustable-value
      ariaLabel: 随滑块变化的实例
      params: { seed: "{{baseline}}", caption: "初始值 {{baseline}}", unit: 个 }
    - type: template
      name: common:adjustable-value
      ariaLabel: 固定初始值的实例
      params: { seed: 8, showBaseline: false }
```

## 基础模拟电路符号

从左到右依次为电阻、无极性电容、增强型 n 沟道 MOSFET、运算放大器和参考地。MOSFET 的体端接源极。运放省略电源引脚。

图形坐标以 SVG 用户单位标注。各符号独立展示，实际引脚、封装尺寸、电压和电流范围以器件数据表为准。

```kui
version: 1
type: svg
title: 基础模拟电路符号
ariaLabel: 电阻、无极性电容、n 沟道 MOSFET、运放和参考地
viewBox: "0 0 550 98"
elements:
  - { kind: use-symbol, symbol: "electronics:resistor", x: 12, y: 12, width: 84, height: 50 }
  - { kind: use-symbol, symbol: "electronics:capacitor", x: 122, y: 12, width: 84, height: 50 }
  - { kind: use-symbol, symbol: "electronics:mosfet", x: 244, y: 12, width: 50, height: 50 }
  - { kind: use-symbol, symbol: "electronics:op-amp", x: 340, y: 12, width: 67, height: 50 }
  - { kind: use-symbol, symbol: "electronics:ground", x: 466, y: 12, width: 50, height: 50 }
  - { kind: text, x: 54, y: 83, align: middle, text: 电阻 }
  - { kind: text, x: 164, y: 83, align: middle, text: 电容 }
  - { kind: text, x: 269, y: 83, align: middle, text: nMOS }
  - { kind: text, x: 374, y: 83, align: middle, text: 运放 }
  - { kind: text, x: 491, y: 83, align: middle, text: 参考地 }
```
