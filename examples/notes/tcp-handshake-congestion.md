# TCP 三次握手与 Reno 拥塞控制

握手让双方确认彼此的初始序号。传输开始后，发送方再用拥塞窗口限制未确认的数据量。这是两个不同问题。握手中的 ACK 确认 SYN 占用的序号，示例中的这些 ACK 不增加拥塞窗口。

## 三个报文如何同步双向序号

设客户端主动打开，服务端已监听。客户端初始序号为 1000，服务端为 7000。假设无丢包，三个报文均不带应用数据。

1. **客户端 → 服务端** · `SYN` · `seq 1000`。服务端进入 SYN-RECEIVED，并回复自己的 SYN。
2. **服务端 → 客户端** · `SYN + ACK` · `seq 7000` · `ack 1001`。客户端确认自己的 SYN 已被接收，进入 ESTABLISHED。
3. **客户端 → 服务端** · `ACK` · `seq 1001` · `ack 7001`。服务端确认自己的 SYN 已被接收，进入 ESTABLISHED。

`ack` 表示期望收到的下一个序号。SYN 占用一个序号，纯 ACK 不消耗序号。第三个报文确认服务端的 SYN。此后客户端第一字节仍可使用 1001。这里只展开普通主动/被动打开。 [RFC 9293 第 3.4.1–3.4.2 节](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.4.2)

逐步高亮三条消息。第一次和第二次各发送一个 SYN，第三次仅确认服务端的 SYN。把第二条的序号加一，就能复算第三条的确认号。

```kui
version: 1
type: interactive
state:
  step: {type: number, default: 0, min: 0, max: 2, step: 1}
layout:
  type: stack
  children:
    - {type: stepper, bind: step, label: 握手步骤, labels: [客户端发起, 服务端确认并同步, 客户端确认]}
    - type: sequence
      title: 双向序号同步
      participants:
        - {id: client, label: 客户端}
        - {id: server, label: 服务端}
      messages:
        - {from: client, to: server, label: "SYN · seq 1000", step: 0}
        - {from: server, to: client, label: "SYN + ACK · seq 7000 · ack 1001", step: 1}
        - {from: client, to: server, label: "ACK · seq 1001 · ack 7001", step: 2, kind: return}
      activeStep: "{{step}}"
```

## 把丢包前后分成可比较的观测点

`cwnd` 为发送端的拥塞窗口，`rwnd` 为接收方通告的窗口，`FlightSize` 是已发送且尚未被累积确认的数据。发送窗口受 `min(cwnd, rwnd)` 约束，再扣除已在途的数据才能得到本次可发送余量。以下用发送方最大报文段的**数据**大小 SMSS 归一化。一个单位就是 1 SMSS 字节。

教学轨迹采用经典 Reno，依据 RFC 5681 的慢启动、拥塞避免、快速重传和快速恢复。假设接收窗口和应用数据均充足，每个满尺寸新数据段及时得到一个 ACK，回合间按 RTT 汇总。设初始 `cwnd = 1`、`ssthresh = 8`，相等时选择拥塞避免。慢启动每个 ACK 增 1，达到阈值后按一窗新确认数据约增 1。丢包前的 `FlightSize = 10` 恰好等于当时的 `cwnd`。计算阈值使用 `FlightSize`。本例取 `max(FlightSize/2, 2) = 5`。两条分支均省略 Limited Transmit、SACK、ECN 和多重丢失。它们是离散教学轨迹，不代表所有操作系统的默认算法和初始窗口。 [RFC 5681 第 3.1–3.2 节](https://www.rfc-editor.org/rfc/rfc5681.html#section-3)

以下每组读数为 `cwnd / ssthresh`，三项依次对应无丢包、三个重复 ACK、首次 RTO。

- 观测点 0 · 1 / 8 · 1 / 8 · 1 / 8
- 观测点 1 · 2 / 8 · 2 / 8 · 2 / 8
- 观测点 2 · 4 / 8 · 4 / 8 · 4 / 8
- 观测点 3 · 8 / 8 · 8 / 8 · 8 / 8
- 观测点 4 · 9 / 8 · 9 / 8 · 9 / 8
- 观测点 5 · 10 / 8 · 10 / 8 · 10 / 8
- 观测点 6 · 11 / 8 · 8 / 5 · 1 / 5
- 观测点 7 · 12 / 8 · 5 / 5 · 2 / 5
- 观测点 8 · 13 / 8 · 6 / 5 · 4 / 5
- 观测点 9 · 14 / 8 · 7 / 5 · 5 / 5
- 观测点 10 · 15 / 8 · 8 / 5 · 6 / 5

观测点是相同教学阶段的索引。处理重复 ACK、等待 RTO 和正常传输耗时各异，横轴不代表相同的真实时间。

- **三个重复 ACK**：观测点 6 快速重传缺失段，进入快速恢复。此时 `cwnd = ssthresh + 3 = 8`，额外 3 反映已有三个后续段离开网络、被接收端缓存。本轨迹的下一次观测选在修复缺口的累积确认之后，省略此间额外重复 ACK 的临时膨胀。观测点 7 把窗口回落到 5，然后继续拥塞避免。
- **首次 RTO**：观测点 6 重传计时器到期，窗口退到 1，按慢启动恢复。观测点 9 只汇总慢启动到达阈值的部分。真实 ACK 可能继续到达，同一 RTT 可继续推进拥塞避免。
- **无丢包**：窗口在阈值之后近似线性增长，阈值持续为 8。

把观测点推进到 6，再切换丢包情形。对照首次 RTO 的 1 SMSS 和快速恢复的 8 SMSS。两条分支的阈值都降到 5 SMSS。继续到 7，观察快速恢复窗口收缩到 5。图中连线连接离散观测，表示变化方向。

```kui
version: 1
type: interactive
state:
  scenario: {type: string, default: clear}
  point: {type: number, default: 0, min: 0, max: 10, step: 1}
data:
  paths:
    clear:
      cwnd:
        - {x: 0, y: 1}
        - {x: 1, y: 2}
        - {x: 2, y: 4}
        - {x: 3, y: 8}
        - {x: 4, y: 9}
        - {x: 5, y: 10}
        - {x: 6, y: 11}
        - {x: 7, y: 12}
        - {x: 8, y: 13}
        - {x: 9, y: 14}
        - {x: 10, y: 15}
      threshold:
        - {x: 0, y: 8}
        - {x: 1, y: 8}
        - {x: 2, y: 8}
        - {x: 3, y: 8}
        - {x: 4, y: 8}
        - {x: 5, y: 8}
        - {x: 6, y: 8}
        - {x: 7, y: 8}
        - {x: 8, y: 8}
        - {x: 9, y: 8}
        - {x: 10, y: 8}
    duplicate:
      cwnd:
        - {x: 0, y: 1}
        - {x: 1, y: 2}
        - {x: 2, y: 4}
        - {x: 3, y: 8}
        - {x: 4, y: 9}
        - {x: 5, y: 10}
        - {x: 6, y: 8}
        - {x: 7, y: 5}
        - {x: 8, y: 6}
        - {x: 9, y: 7}
        - {x: 10, y: 8}
      threshold:
        - {x: 0, y: 8}
        - {x: 1, y: 8}
        - {x: 2, y: 8}
        - {x: 3, y: 8}
        - {x: 4, y: 8}
        - {x: 5, y: 8}
        - {x: 6, y: 5}
        - {x: 7, y: 5}
        - {x: 8, y: 5}
        - {x: 9, y: 5}
        - {x: 10, y: 5}
    timeout:
      cwnd:
        - {x: 0, y: 1}
        - {x: 1, y: 2}
        - {x: 2, y: 4}
        - {x: 3, y: 8}
        - {x: 4, y: 9}
        - {x: 5, y: 10}
        - {x: 6, y: 1}
        - {x: 7, y: 2}
        - {x: 8, y: 4}
        - {x: 9, y: 5}
        - {x: 10, y: 6}
      threshold:
        - {x: 0, y: 8}
        - {x: 1, y: 8}
        - {x: 2, y: 8}
        - {x: 3, y: 8}
        - {x: 4, y: 8}
        - {x: 5, y: 8}
        - {x: 6, y: 5}
        - {x: 7, y: 5}
        - {x: 8, y: 5}
        - {x: 9, y: 5}
        - {x: 10, y: 5}
computed:
  trace: paths[scenario]
  windowNow: trace.cwnd[point].y
  thresholdNow: trace.threshold[point].y
layout:
  type: stack
  children:
    - type: select
      bind: scenario
      label: 丢包情形
      options:
        - {value: clear, label: 无丢包}
        - {value: duplicate, label: 三个重复 ACK}
        - {value: timeout, label: 首次 RTO}
    - type: stepper
      bind: point
      label: 拥塞窗口观测点
      labels: [初始, 慢启动 I, 慢启动 II, 达到初始阈值, 拥塞避免 I, 分支前, 分支生效, 下一观测, 后续 I, 后续 II, 后续 III]
    - type: grid
      columns: {desktop: 2, mobile: 1}
      children:
        - {type: metric, label: 拥塞窗口 cwnd, value: "{{windowNow}}", unit: SMSS}
        - {type: metric, label: 慢启动阈值 ssthresh, value: "{{thresholdNow}}", unit: SMSS}
    - type: chart
      title: Reno 的窗口与阈值
      xAxis: {label: 观测点索引, min: 0, max: 10}
      yAxis: {label: 窗口大小, unit: SMSS, min: 0, max: 16}
      series:
        - {type: line, label: cwnd, tone: info, points: "{{trace.cwnd}}"}
        - {type: line, label: ssthresh, tone: warning, points: "{{trace.threshold}}"}
      referenceLines:
        - {axis: x, value: "{{point}}", tone: neutral}
      markers:
        - {x: "{{point}}", y: "{{windowNow}}", label: "cwnd · {{windowNow}} SMSS"}
```

**自测**：如果 `cwnd = 10` 而真正的 `FlightSize` 只有 6，首次超时按本模型设出的阈值和窗口分别是多少？应得到 `ssthresh = 3`、`cwnd = 1`。只减半窗口会得到错误的阈值。
