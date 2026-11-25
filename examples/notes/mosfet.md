# MOSFET 的工作区、特性曲线与小信号分析

一个共源级为什么能把几十毫伏的输入变化放大，又为什么会在输入摆幅过大时失真？先用大信号模型找出直流工作点，再在该点附近用斜率估算增量。两步使用同一个电流模型。

## 从栅压到反型沟道

以长沟道增强型 nMOS 为例。p 型体区中的两个 n⁺ 区分别是源极和漏极。绝缘层把栅极与硅隔开。栅压升高后，表面空穴被排斥，形成耗尽区。偏压进一步升高，表面电子浓度上升，源漏间形成反型沟道。栅极通过电场控制沟道电荷。稳态直流分析可忽略理想栅电流，动态驱动仍需为栅电容充放电。

以下把体端与源极短接，固定温度，选源极为参考。`VGS`、`VDS` 和 `Vth` 分别表示栅源电压、漏源电压和本偏置条件下的阈值，单位为 V。过驱动电压 `VOV = VGS − Vth`。模型限制为 `VDS ≥ 0`。漏电流 `ID` 取从漏到源的常规电流方向。

由源到漏，沟道电势 `v` 逐渐上升，局部反型电荷量的大小近似正比于 `VOV − v`。漏端电势逼近 `VOV` 时，漏端反型电荷趋近零，出现夹断。电子仍由源端注入，经漏端高电场区到达漏端，漏电流继续流动。双极型晶体管的饱和通常涉及基极与发射极、集电极两个结均正偏，工作机制与 nMOS 夹断不同。 [MIT 6.012 渐变沟道近似](https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-fall-2009/eeb94eab00ebb62a3fde0eec1484bc08_MIT6_012F09_lec11_gradual.pdf)

## 工作区与连续分段模型

对沿沟道的电势积分，长沟道渐变沟道近似给出 `ID0 = β(VOV·VDS − VDS²/2)`。`β = μn Cox W/L`，由电子迁移率、单位面积栅氧电容和宽长比决定。达到夹断条件后，理想电流以 `VDS = VOV` 代入，得到 `β VOV²/2`。

- **截止**。`VOV ≤ 0` 时，`ID0 = 0`。
- **线性区**。`VOV > 0` 且 `0 ≤ VDS < VOV` 时，`ID0 = β(VOV·VDS − VDS²/2)`。
- **饱和区**。`VOV > 0` 且 `VDS ≥ VOV` 时，`ID0 = β VOV²/2`。

计算例统一取 `β = 1.00 mA/V²`、`λ = 0.050 V⁻¹`。本教学模型在两段导通公式上统一乘以 `1 + λ VDS`，即 `ID = ID0(1 + λ VDS)`，在饱和区近似体现沟道长度调制造成的正斜率。线性区沿用同一经验因子以保持模型一致。它不用于拟合某个器件。线性与饱和公式在 `VDS = VOV` 给出同一电流及同一漏压斜率。固定正 `VDS` 并让 `VOV` 趋向零时，电流也连续趋于零。`VDS = 0` 时，即使沟道已打开，也没有沿沟道的净漏电流。

以下读数按 `VGS / VDS / Vth` 的顺序记录电压，单位为 V。

- 1.0 / 4.0 / 1.0 · 截止 · 0 mA
- 3.0 / 0.0 / 1.0 · 线性区 · 0 mA
- 3.0 / 1.0 / 1.0 · 线性区 · 1.575 mA
- 3.0 / 2.0 / 1.0 · 饱和区 · 2.200 mA
- 3.0 / 4.0 / 1.0 · 饱和区 · 2.400 mA
- 3.0 / 4.0 / 2.0 · 饱和区 · 0.600 mA

读输出特性时，横轴是 `VDS`，纵轴是 `ID`。固定 `VGS` 后，曲线从原点出发，在 `VDS = VOV` 进入饱和区。`VGS` 上升或 `Vth` 下降都会增大 `VOV`，提高饱和电流并把边界推向更高的 `VDS`。曲线上任一点可以作为待分析的偏置。接入外电路后，真正的静态 Q 点还需满足外电路约束。

模型省略亚阈值电流、体效应、短沟道速度饱和、击穿和自热。离开给定偏置条件后，应重新评估阈值与参数。短沟道器件的转移特性不一定服从平方律。 [MIT 6.012 大信号模型](https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-fall-2009/resources/mit6_012f09_lec11/)

把栅源和阈值电压设为 3 V 和 1 V，再把漏源电压从 2 V 移到 4 V。游标电流应从 2.20 mA 增至 2.40 mA。将栅源电压降到阈值，整条输出曲线会落到零电流。灰色线是下一节例题的外电路负载线，交点才满足该电路的静态约束。

```kui
version: 1
type: interactive
state:
  gate: {type: number, label: 栅源电压 VGS, default: 3, min: 0, max: 4, step: 0.1, unit: V}
  drain: {type: number, label: 漏源电压 VDS, default: 4, min: 0, max: 10, step: 0.1, unit: V}
  threshold: {type: number, label: 阈值电压 Vth, default: 1, min: 0.5, max: 2, step: 0.1, unit: V}
data:
  beta: 1
  lambda: 0.05
computed:
  overdrive: max(0, gate - threshold)
  channelDrop: min(drain, overdrive)
  current: beta * (overdrive * channelDrop - channelDrop ^ 2 / 2) * (1 + lambda * drain)
  transconductance: beta * channelDrop * (1 + lambda * drain)
  regime: "gate <= threshold ? '截止' : (drain < overdrive ? '线性区' : '饱和区')"
layout:
  type: stack
  children:
    - type: grid
      columns: {desktop: 3, tablet: 2, mobile: 1}
      children:
        - {type: slider, bind: gate}
        - {type: slider, bind: drain}
        - {type: slider, bind: threshold}
    - type: grid
      columns: {desktop: 3, mobile: 1}
      children:
        - {type: metric, label: 工作区, value: "{{regime}}"}
        - {type: metric, label: 漏电流 ID, value: "{{fmt(current, 3)}}", unit: mA}
        - {type: metric, label: 跨导 gm, value: "{{fmt(transconductance, 3)}}", unit: mS}
    - type: chart
      title: 输出曲线与游标工作点
      xAxis: {label: 漏源电压 VDS, unit: V, min: 0, max: 10}
      yAxis: {label: 漏电流 ID, unit: mA, min: 0, max: 10}
      series:
        - type: function
          label: "nMOS · VGS = {{fmt(gate, 1)}} V"
          tone: info
          expr: beta * (overdrive * min(x, overdrive) - min(x, overdrive) ^ 2 / 2) * (1 + lambda * x)
          samples: 161
        - type: line
          label: 例题负载线
          tone: neutral
          points: [{x: 0, y: 4}, {x: 10, y: 0}]
      referenceLines:
        - {axis: x, value: "{{overdrive}}", label: "{{gate > threshold ? '夹断边界' : '截止'}}", tone: warning}
      markers:
        - {x: "{{drain}}", y: "{{current}}", label: "游标 · {{fmt(current, 3)}} mA"}
```

## 在 Q 点附近线性化

记很小的增量为 `vgs` 和 `vds`。对选定工作点作一阶展开得到 `id ≈ gm·vgs + gds·vds`。在饱和区，固定 `VDS` 后对 `VGS` 求偏导，`gm = β VOV(1 + λ VDS) = 2 ID/VOV`。固定 `VGS` 后对 `VDS` 求偏导，`gds = λ β VOV²/2`。输出电阻为 `ro = 1/gds`，也可写成 `(1 + λ VDS)/(λ ID)`。`gm`、`gds` 用 mS，`ro` 用 kΩ。对线性区求同样的栅压偏导得到 `gm = β VDS(1 + λ VDS)`。这些斜率用于低频小信号近似，摆幅、寄生电容或体端小信号不可忽略时，应扩展模型。 [MIT 6.012 小信号模型与单管放大级](https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-fall-2009/pages/lecture-notes/)

共源电路的连接顺序如下。电阻 `RD` 从 `VDD` 接到漏极，漏极为输出 `vout`，源极及体端接参考地，栅极接带直流偏置的输入。低频增量分析中，理想电源是交流地。输入升高使漏电流增大，`RD` 压降随之增大，漏极电压下降。

```kui
version: 1
type: svg
title: 电阻负载共源级
ariaLabel: 电源经漏极电阻接到输出节点，增强型 nMOS 的源极和体端接地，栅极接输入
viewBox: "0 0 340 272"
elements:
  - kind: group
    transform: [{kind: translate, x: 186, y: 32}, {kind: rotate, degrees: 90}]
    elements:
      - {kind: use-symbol, symbol: "electronics:resistor", x: 0, y: 0, width: 100, height: 40}
  - {kind: use-symbol, symbol: "electronics:mosfet", x: 123, y: 155, width: 60, height: 60}
  - {kind: use-symbol, symbol: "electronics:ground", x: 146, y: 229, width: 40, height: 32}
  - {kind: line, x1: 166, y1: 132, x2: 166, y2: 155}
  - {kind: line, x1: 166, y1: 215, x2: 166, y2: 229}
  - {kind: line, x1: 166, y1: 144, x2: 258, y2: 144, stroke: info}
  - {kind: line, x1: 69, y1: 185, x2: 123, y2: 185, stroke: info}
  - {kind: circle, cx: 166, cy: 144, r: 3, fill: info, stroke: none}
  - {kind: circle, cx: 166, cy: 32, r: 3, fill: current, stroke: none}
  - {kind: text, x: 166, y: 19, align: middle, text: VDD}
  - {kind: text, x: 196, y: 86, text: RD}
  - {kind: text, x: 266, y: 149, text: vout}
  - {kind: text, x: 25, y: 190, text: vin}
  - {kind: text, x: 198, y: 191, text: nMOS}
```

- **共源（栅 → 漏）**。反相电压增益。理想低频栅输入电阻很高。
- **共漏（栅 → 源）**。也称源极跟随器。同相，增益通常小于 1，输出阻抗低，可缓冲。
- **共栅（源 → 漏）**。同相，输入阻抗低。忽略体效应及有限 `ro` 等影响时约为 `1/gm`。

## 例题与自测

设 `VDD = 10 V`、`RD = 2.50 kΩ`、`VGS = 3.00 V`。饱和假设给出 `ID = 2(1 + 0.05 VDS) mA`，负载线是 `VDS = 10 − 2.50 ID`。求交点得 `VDS = 4.00 V`、`ID = 2.40 mA`。`4.00 V ≥ 2.00 V`，饱和假设成立。该点 `gm = 2.40 mS`、`gds = 0.100 mS`、`ro = 10.0 kΩ`。无外接负载时，`RD` 与 `ro` 并联为 `2.00 kΩ`，所以从栅到漏的增益约为 `−4.80 V/V`。在偏置附近，栅压增加 `10 mV`，输出约降低 `48 mV`。

1. 若保持 `VGS = 3 V`、`Vth = 1 V`，把 `VDS` 从 `2 V` 调到 `4 V`，电流如何变化？两点均在模型的饱和区，电流从 `2.20 mA` 增至 `2.40 mA`。
2. 若换一只器件让 `Vth` 升为 `2 V`，在相同 `VGS` 下夹断边界在哪？`VOV = 1 V`，所以边界在 `VDS = 1 V`。若实际电路接有 `RD`，需重算负载线交点。
3. 输入摆幅大到使漏端跌过工作区边界时，还能用 `−4.80 V/V` 吗？增量模型仅在偏置附近有效。跨区时应用大信号方程重新计算。

```kui
version: 1
type: quiz
question: 固定 VGS = 3 V、Vth = 1 V，把 VDS 从 2 V 调到 4 V，电流为什么略微增大？
options:
  - {label: 电流已经关断，读数来自栅电流, correct: false, explanation: 夹断发生在漏端，源端仍向沟道注入载流子。}
  - {label: 沟道长度调制使饱和区斜率为正, correct: true, explanation: 过驱动保持 2 V，模型的调制因子由 1.10 增至 1.20。}
  - {label: 更大的漏压把器件推回线性区, correct: false, explanation: 线性区要求 VDS 小于 2 V，这两个读数均满足饱和区条件。}
```
