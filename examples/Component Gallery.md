# Component Gallery

用一份虚构的传感器校准记录浏览 Protocol v1 的 31 个核心组件和 `template`。所有读数均为构造数据。笔记中的控件可用键盘操作。宽表和图解可在窄窗口内横向滚动。

## 摘要与对照

这一轮校准需要核对四个采样点。读者先定位待复查点，再比较调整前后的判断条件。

```kui
version: 1
type: stack
gap: md
children:
  - {type: hero, title: 校准记录, subtitle: 比较传感器读数与参考值, body: "先检查偏差，再用同一套条件复测。"}
  - type: grid
    columns: {desktop: 2, mobile: 1}
    children:
      - {type: metric, label: 计划采样点, value: 4, unit: 个}
      - {type: badge, label: 有读数待复查, tone: warning}
  - {type: divider, label: 读数判定}
  - type: section
    title: 用相同条件复测
    children:
      - type: compare
        panels:
          - title: 初测
            children:
              - {type: text, body: "记录原始温度偏差。", variant: body}
              - {type: markdown, body: "**超限点**应保留原始记录，以便比较调整效果。"}
          - title: 复测
            children:
              - {type: callout, title: 共用参考仪, body: "等两支探头稳定后再记数。", tone: info}
```

## 输入、进度和精确查值

滑块和数字输入都修改已核对的采样点数。默认是 2/4。切换为「复测」会显示复测读数。勾选后可查看判定说明，重置按钮恢复默认核对数量。

```kui
version: 1
type: interactive
state:
  checked: {type: number, label: 已核对采样点, default: 2, min: 0, max: 4, step: 1, unit: 个}
  batch: {type: string, default: initial}
  showRule: {type: boolean, default: false}
data:
  samples:
    initial: [[10, 10.1], [20, 20.4], [30, 30.2], [40, 40.0]]
    repeat: [[10, 10.1], [20, 20.1], [30, 30.2], [40, 40.0]]
layout:
  type: stack
  children:
    - type: grid
      columns: {desktop: 2, mobile: 1}
      children:
        - {type: slider, bind: checked}
        - {type: number-input, bind: checked, label: 手动输入核对数}
        - type: select
          label: 读数批次
          bind: batch
          options: [{label: 初测, value: initial}, {label: 复测, value: repeat}]
        - {type: toggle, bind: showRule, label: 显示判定说明}
    - {type: progress, label: 核对进度, value: "{{checked}}", max: 4}
    - {type: button, label: 重置核对数, action: {type: reset, bind: checked}}
    - {type: text, when: showRule, variant: caption, body: "温度读数与参考值相减，取偏差绝对值再比较允许误差。"}
    - type: tabs
      tabs:
        - title: 读数
          children:
            - type: table
              caption: 按批次查看温度
              columns:
                - {label: 参考温度（°C）, align: end}
                - {label: 传感器温度（°C）, align: end, emphasis: true}
              rows: "{{samples[batch]}}"
        - title: 偏差公式
          children:
            - type: collapse
              label: 展开偏差计算
              content:
                type: formula
                latex: '\Delta T = T_{\mathrm{sensor}} - T_{\mathrm{ref}}'
                conditions: 两者使用同一温标
                variables:
                  - {symbol: 'ΔT', meaning: 有符号偏差, unit: °C}
                steps:
                  - {latex: '20.4 - 20.0 = 0.4', explanation: 初测第二点的偏差为正}
```

```kui
version: 1
type: quiz
question: 初测第二点与参考值相比，高了多少？
options:
  - {label: 0.4 °C, correct: true, explanation: 20.4 减去 20.0 等于 0.4。}
  - {label: 20.4 °C, correct: false, explanation: 20.4 °C 是传感器读数。偏差还需要减去参考温度。}
```

## 比较趋势与观测点

横轴是校准点索引 1 至 4，纵轴是偏差绝对值。柱为初测，线为复测，散点标记初测超限的位置。带状区域标出 0.3 °C 以内的允许范围。

```kui
version: 1
type: chart
title: 校准前后的偏差
xAxis: {label: 采样点索引, min: 0, max: 5}
yAxis: {label: 偏差绝对值, unit: °C, min: 0, max: 0.5}
series:
  - type: bar
    label: 初测
    tone: neutral
    points: [{x: 1, y: 0.1}, {x: 2, y: 0.4}, {x: 3, y: 0.2}, {x: 4, y: 0}]
  - type: line
    label: 复测
    tone: info
    points: [{x: 1, y: 0.1}, {x: 2, y: 0.1}, {x: 3, y: 0.2}, {x: 4, y: 0}]
  - {type: scatter, label: 初测超限, tone: danger, points: [{x: 2, y: 0.4}]}
regions:
  - {axis: y, from: 0, to: 0.3, label: 允许范围, tone: success}
```

## 步进、消息与决策路径

按「下一步」查看工作站如何请求采样、接收结果和将结果归档。时序图按发送和接收方显示消息，流程图显示复查路径。

```kui
version: 1
type: interactive
state:
  phase: {type: number, default: 0, min: 0, max: 2, step: 1}
layout:
  type: stack
  children:
    - {type: stepper, bind: phase, label: 校准消息, labels: [请求采样, 返回读数, 归档结果]}
    - type: sequence
      title: 采样消息
      participants:
        - {id: station, label: 工作站}
        - {id: sensor, label: 传感器}
      messages:
        - {from: station, to: sensor, label: 请求采样}
        - {from: sensor, to: station, label: 返回读数, kind: return}
        - {from: station, to: station, label: 归档结果}
      activeStep: "{{phase}}"
    - type: graph
      title: 复查路径
      grid: {columnWidth: 126, rowHeight: 80}
      nodes:
        - {id: sample, label: 初测, position: {row: 0, column: 0}, width: 97}
        - {id: review, label: 复查, position: {row: 0, column: 1}, width: 97, tone: warning}
        - {id: archive, label: 归档, position: {row: 1, column: 1}, width: 97, tone: success}
      edges:
        - {from: sample, to: review, label: 超限}
        - {from: sample, to: archive, route: curve, label: 通过}
        - {from: review, to: archive, label: 复测通过}
```

## 代码、命令记录和文件

本例的复测偏差为 0.1 °C，低于 0.3 °C 的限值。代码展示判定过程，终端记录显示该结果，文件树标出归档位置。

```kui
version: 1
type: stack
children:
  - type: code
    title: 复测判定
    language: javascript
    lineNumbers: true
    code: |-
      const deviation = 0.1;
      const tolerance = 0.3;
      const status = deviation <= tolerance ? "PASS" : "RECHECK";
    highlight: [3]
  - type: terminal
    title: 复测终端记录
    prompt: "$"
    lines:
      - {kind: command, text: "cat readings/retest.txt"}
      - {kind: output, text: "point=2, deviation=0.1 C, status=PASS"}
  - type: file-tree
    title: 校准文件
    openDepth: 1
    entries:
      - kind: directory
        name: calibration
        children:
          - kind: directory
            name: readings
            children:
              - {kind: file, name: initial.txt}
              - {kind: file, name: retest.txt, detail: 保存复测读数}
```

## 声明式图元与模板

输入侧的串联电阻与对地电容形成 RC 低通。示意图使用内置符号。两份计数模板分别从 3 和 8 开始，调整其中一个实例的偏移可观察各自的结果。

```kui
version: 1
type: stack
children:
  - type: svg
    title: RC 低通示意图
    ariaLabel: 输入经串联电阻连接输出，输出经电容接地
    viewBox: "0 0 330 188"
    elements:
      - {kind: use-symbol, symbol: "electronics:resistor", x: 51, y: 28, width: 100, height: 40}
      - kind: group
        transform: [{kind: translate, x: 201, y: 61}, {kind: rotate, degrees: 90}]
        elements:
          - {kind: use-symbol, symbol: "electronics:capacitor", x: 0, y: 0, width: 80, height: 32}
      - {kind: use-symbol, symbol: "electronics:ground", x: 165, y: 141, width: 40, height: 32}
      - {kind: line, x1: 29, y1: 48, x2: 51, y2: 48}
      - {kind: line, x1: 151, y1: 48, x2: 280, y2: 48}
      - {kind: line, x1: 185, y1: 48, x2: 185, y2: 61}
      - {kind: circle, cx: 185, cy: 48, r: 3, stroke: none, fill: info}
      - {kind: text, x: 25, y: 28, text: 输入}
      - {kind: text, x: 263, y: 28, text: 输出}
      - {kind: text, x: 98, y: 28, text: R}
      - {kind: text, x: 199, y: 104, text: C}
  - type: grid
    columns: {desktop: 2, mobile: 1}
    children:
      - {type: template, name: "common:adjustable-value", ariaLabel: 初始值为 3 的实例, params: {seed: 3, caption: 初始值 3}}
      - {type: template, name: "common:adjustable-value", ariaLabel: 初始值为 8 的实例, params: {seed: 8, caption: 初始值 8}}
```
