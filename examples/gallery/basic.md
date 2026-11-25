# 基础组件 Gallery

一份可复核的记录应交代结论、依据和适用范围。简记适合延续同一个问题，完整记录适合交接给不了解上下文的读者。

```kui
version: 1
type: stack
gap: lg
children:
  - type: hero
    title: 让结论可复核
    subtitle: 为下一次阅读保留必要的上下文
    body: 先写下结论，再标注依据和适用范围。这样即使过了一段时间，读者也能沿着原来的线索重新判断。
  - type: stack
    direction: row
    align: center
    gap: sm
    ariaLabel: 记录类别
    children:
      - type: badge
        label: 阅读记录
      - type: badge
        label: 可复核示例
        tone: info
  - type: section
    title: 复核前检查哪些信息
    children:
      - type: grid
        columns: { desktop: 3, tablet: 2, mobile: 1 }
        gap: lg
        ariaLabel: 本例记录摘要
        children:
          - type: metric
            label: 原始记录
            value: 12
            unit: 条
            detail: 本次整理范围内的记录数
          - type: metric
            label: 附有出处
            value: 9
            unit: 条
            detail: 可定位到原文页码或段落
            tone: success
          - type: metric
            label: 待补出处
            value: 3
            unit: 条
            detail: 复核时优先处理这组记录
            tone: warning
      - type: text
        variant: caption
        body: 数字为排版示例，计数单位为条，范围仅限这批样例记录。
      - type: callout
        tone: warning
        title: 有出处仍需核对
        body: 核对原文时，顺带确认引用的结论是否依赖特定条件，并把这些条件写在记录里。
```

以下两种记录方式使用同一套判断标准。区别在于下一位读者会带来多少上下文。

```kui
version: 1
type: stack
gap: lg
children:
  - type: divider
    label: 记录方式
  - type: compare
    title: 根据读者选择记录粒度
    panels:
      - title: 简记
        children:
          - type: text
            body: 留下当前结论、出处和一个待确认的问题。
          - type: text
            body: 适合自己沿着原有线索继续阅读。
            variant: caption
      - title: 完整记录
        children:
          - type: text
            body: 加上背景、证据和结论适用的边界，让第一次接触材料的读者也能复核。
          - type: text
            body: 适合交接、复盘或跨页引用。
            variant: caption
  - type: section
    title: 写完后的快速检查
    children:
      - type: text
        variant: label
        body: 从最终读者的角度重读
      - type: text
        markdown: true
        body: '**复核顺序**：先看结论，再回到依据。'
      - type: markdown
        body: |
          1. 用一句话复述结论。
          2. 定位支撑结论的原文。
          3. 标出适用条件和待确认的问题。
```
