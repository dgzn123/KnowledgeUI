# 二阶系统的阶跃响应与频率响应

要让系统更快地稳定下来，加大阻尼总是有效吗？比较同一固有角频率下的欠阻尼、临界阻尼和过阻尼响应。欠阻尼系统会超调，过阻尼系统虽不超调，却可能比临界阻尼系统更慢接近稳态。

## 统一模型与单位

考虑零初值、直流增益为 1 的连续时间线性二阶低通，且无零点。模型为 `y'' + 2ζωn y' + ωn² y = ωn² u(t)`。`u(t)` 为单位阶跃，`y` 为无量纲归一化输出，`t` 以秒计，固有角频率 `ωn > 0` 以 rad/s 计，阻尼比 `ζ > 0` 无量纲。代入拉普拉斯变换得 `H(s) = ωn²/(s² + 2ζωn s + ωn²)`。所有极点的实部均为负，稳态阶跃输出为 1。

在质量—弹簧—阻尼系统中，若阶跃力的幅值为 `F₀`，位移的稳态值为 `F₀/k`。用稳态位移归一化后可得到上式。此时 `ωn = √(k/m)`，`ζ = c/(2√(km))`，其中 `m` 用 kg，`k` 用 N/m，`c` 用 N·s/m。模型省略额外极点、零点、延迟、摩擦非线性和执行器饱和。 [MIT 2.003 二阶机械系统阶跃响应](https://www.ocw.mit.edu/courses/2-003-modeling-dynamics-and-control-i-spring-2005/96347b94470d97e77646da0f8cbc3a1f_notesinstalment3.pdf)

```kui
version: 1
type: formula
latex: 'H(s)=\frac{\omega_n^2}{s^2+2\zeta\omega_n s+\omega_n^2}'
variables:
  - {symbol: 'ζ', meaning: 阻尼比, unit: 无量纲}
  - {symbol: 'ωₙ', meaning: 固有角频率, unit: rad/s}
conditions: 连续线性、零初值、直流增益为 1
```

## 时域：三种阻尼

令 `τ = ωn t`。求特征方程的根，并由 `y(0) = y'(0) = 0` 确定系数，得到以下响应。

- `0 < ζ < 1`，设 `q = √(1 − ζ²)`。`y = 1 − exp(−ζτ)[cos(qτ) + (ζ/q)sin(qτ)]`。
- `ζ = 1`。`y = 1 − (1 + τ)exp(−τ)`。
- `ζ > 1`，设 `q = √(ζ² − 1)`。`y = 1 + [(ζ−q)exp(−(ζ+q)τ) − (ζ+q)exp(−(ζ−q)τ)]/(2q)`。

欠阻尼响应对时间求导后，首个正峰出现在 `tp = π/(ωn√(1 − ζ²))`，百分比超调为 `Mp = 100 exp(−πζ/√(1 − ζ²))`。临界和过阻尼均单调趋向稳态，超调为 0。首峰时间记为 `—`。过阻尼时较慢极点的衰减率是 `ωn(ζ − √(ζ² − 1))`，随阻尼比增加而减小。固定 `ζ` 并调高 `ωn` 会压缩时间轴，百分比超调保持一致。 [MIT 16.06 二阶阶跃响应](https://ocw.mit.edu/courses/16-06-principles-of-automatic-control-fall-2012/82a3a9b474b86097dda269af65cd26a4_MIT16_06F12_Recitation_2.pdf)

## 频域：欠阻尼不一定产生谐振峰

把 `s = jω` 代入，令 `r = ω/ωn`，得幅值 `|H(jω)| = 1/√((1 − r²)² + (2ζr)²)`。分贝值为 `20 log10|H(jω)|`。用对数横轴观察正频率，等距表示频率相差相同倍数。零频率不在对数图上，低频极限是 0 dB。

对幅值式的分母平方关于 `r` 求导。只在 `0 < ζ < 1/√2` 时存在正频率峰，`ωr = ωn√(1 − 2ζ²)`，峰值幅值 `Mr = 1/(2ζ√(1 − ζ²))`。`ζ = 1/√2` 时最大幅值在零频率处。取 `ζ = 0.8` 可以阶跃超调，但不会出现正频率谐振峰。高频时幅值约按 `ω⁻²` 衰减，即每十倍频降约 40 dB。 [MIT 2.161 二阶系统 Bode 幅频特性](https://ocw.mit.edu/courses/2-161-signal-processing-continuous-and-discrete-fall-2008/a9a6fa4c4c56513e2d5df392df6123ee_bode.pdf)

## 对照读数

固定 `ωn = 2 rad/s`。阶跃图在 `t = 0` 从零起步，最终趋向 1。对数幅频图在 `ω = ωn` 处的幅值是 `1/(2ζ)`。有限时间的阶跃图只展示该时间窗内的行为，低固有频率或大阻尼可能使稳态延至图外。

每行依次给出 `y(1 s)`、百分比超调、首峰时间（s）和 `ωn` 处的幅值（dB）。

- ζ = 0.5 · 0.8494 · 16.3034% · 1.8138 · 0 dB
- ζ = 1.0 · 0.5940 · 0% · — · -6.0206 dB
- ζ = 2.0 · 0.3696 · 0% · — · -12.0412 dB

蓝线使用选定阻尼，灰线使用同一固有角频率下的临界阻尼。先保持 2 rad/s，把阻尼从 0.5 调到 0.8，比较仍存在的阶跃超调和已经消失的正频率谐振峰。再调到 1，两组曲线应重合。频率轴从 0.05 到 50 rad/s，幅值用 dB。

```kui
version: 1
type: interactive
state:
  zeta: {type: number, label: 阻尼比 ζ, default: 0.5, min: 0.2, max: 2, step: 0.05}
  omega: {type: number, label: 固有角频率 ωn, default: 2, min: 0.5, max: 5, step: 0.5, unit: rad/s}
computed:
  q: sqrt(abs(1 - zeta ^ 2))
  fast: zeta + q
  overshoot: "zeta < 1 ? 100 * exp(-PI * zeta / q) : 0"
  peakTime: "zeta < 1 ? fmt(PI / (omega * q), 3) : '—'"
  resonance: "zeta < sqrt(0.5) ? fmt(omega * sqrt(1 - 2 * zeta ^ 2), 3) : '—'"
  regime: "zeta < 1 ? '欠阻尼' : (zeta == 1 ? '临界阻尼' : '过阻尼')"
layout:
  type: stack
  children:
    - type: grid
      columns: {desktop: 2, mobile: 1}
      children:
        - {type: slider, bind: zeta}
        - {type: slider, bind: omega}
    - type: grid
      columns: {desktop: 3, tablet: 2, mobile: 1}
      children:
        - {type: metric, label: "超调 · {{regime}}", value: "{{fmt(overshoot, 2)}}", unit: "%"}
        - {type: metric, label: 首峰时间, value: "{{peakTime}}", unit: "{{zeta < 1 ? 's' : ''}}"}
        - {type: metric, label: 正频率谐振峰, value: "{{resonance}}", unit: "{{zeta < sqrt(0.5) ? 'rad/s' : ''}}"}
    - type: chart
      title: 单位阶跃响应
      xAxis: {label: 时间, unit: s, min: 0, max: 12}
      yAxis: {label: 归一化输出, min: 0, max: 1.65}
      series:
        - type: function
          label: 所选阻尼
          tone: info
          expr: >-
            zeta < 1 ? 1 - exp(-zeta * omega * x) * (cos(q * omega * x) + zeta / q * sin(q * omega * x))
            : (zeta == 1 ? 1 - (1 + omega * x) * exp(-omega * x)
            : 1 + (exp(-fast * omega * x) / fast - fast * exp(-omega * x / fast)) / (2 * q))
          samples: 241
        - {type: function, label: 临界阻尼 ζ = 1, tone: neutral, expr: "1 - (1 + omega * x) * exp(-omega * x)", samples: 241}
      referenceLines:
        - {axis: y, value: 1, label: 稳态值, tone: neutral}
    - type: chart
      title: 幅频响应
      xAxis: {label: 角频率, unit: rad/s, scale: log, min: 0.05, max: 50}
      yAxis: {label: 幅值, unit: dB, min: -85, max: 10}
      series:
        - type: function
          label: 所选阻尼
          tone: info
          expr: "-10 * log10((1 - (x / omega) ^ 2) ^ 2 + (2 * zeta * x / omega) ^ 2)"
          samples: 241
        - type: function
          label: 临界阻尼 ζ = 1
          tone: neutral
          expr: "-20 * log10(1 + (x / omega) ^ 2)"
          samples: 241
      referenceLines:
        - {axis: x, value: "{{omega}}", label: 固有角频率, tone: warning}
```

**自测**：把 `ωn` 从 2 增至 4 rad/s，保持 `ζ = 0.5`。首峰时间减半，超调仍为约 16.3%，谐振峰频率由约 1.414 增至 2.828 rad/s，峰高仍约为 1.25 dB。
