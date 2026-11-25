# 杠杆力矩平衡

一根忽略自重的刚性杠杆水平静止，支点摩擦忽略不计。两个竖直向下的力作用在支点两侧，力臂是支点到各力作用线的垂直距离。左侧的力使杠杆趋向逆时针转动，右侧的力使它趋向顺时针转动。支点反力的作用线经过支点，关于支点的力矩为零。

取逆时针为正，净力矩为 F左 × d左 − F右 × d右，静止时等于零。左侧 6 N 的力距支点 0.20 m，产生 +1.20 N·m 的力矩。右侧力臂为 0.30 m，需要 4 N 产生 −1.20 N·m 的力矩。两侧力也由支点竖直向上的 10 N 反力平衡。示意图画出两个外加力，省略支点反力，箭头长度用于定位力的方向。

```kui
version: 1
type: svg
title: 两个力关于支点的作用
ariaLabel: 左侧六牛、力臂零点二米，右侧四牛、力臂零点三米
viewBox: '0 0 340 148'
elements:
  - {kind: line, x1: 34, y1: 82, x2: 308, y2: 82, stroke: current, strokeWidth: 3}
  - kind: polygon
    points: [{x: 150, y: 82}, {x: 136, y: 104}, {x: 164, y: 104}]
    fill: neutral
  - {kind: arrow, x1: 50, y1: 37, x2: 50, y2: 80, stroke: info, strokeWidth: 2}
  - {kind: arrow, x1: 300, y1: 37, x2: 300, y2: 80, stroke: info, strokeWidth: 2}
  - {kind: text, x: 50, y: 27, text: '6 N', align: middle}
  - {kind: text, x: 300, y: 27, text: '4 N', align: middle}
  - {kind: text, x: 100, y: 127, text: '0.20 m', align: middle}
  - {kind: text, x: 225, y: 127, text: '0.30 m', align: middle}
```

```kui
version: 1
type: formula
latex: 'F_L d_L = F_R d_R'
variables:
  - {symbol: 'F_L, F_R', meaning: 左右两侧施力的大小, unit: N}
  - {symbol: 'd_L, d_R', meaning: 左右两侧到各力作用线的垂直距离, unit: m}
conditions: 图示水平杠杆，两侧外力方向竖直，净力矩为零。
```

保持左侧条件不变，若右侧力臂缩短到 0.15 m，右侧需要 8 N。若施力方向倾斜，应重新计算垂直力臂。杠杆自重或支点摩擦显著时，还需计入相应力矩。
