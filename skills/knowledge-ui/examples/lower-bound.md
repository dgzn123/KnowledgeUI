# 二分查找插入位置

在升序排列的数组中，查找第一项大于或等于目标值的位置。数组索引从 0 开始。对 `[2, 4, 4, 9]` 查找 4，答案是索引 1，即两个 4 中靠前的一个。若所有项都小于目标值，返回数组长度。

始终维持两个条件。`lo` 之前的元素都小于目标，`hi` 及之后的元素都大于或等于目标。在 `[lo, hi)` 查中点。中点值较小时令 `lo = mid + 1`，否则令 `hi = mid`。候选区间每次严格缩小，`lo = hi` 时两条条件共同确定边界。对长度为 n 的随机访问数组，这个算法做 O(log(n + 1)) 次比较。

| 当前区间 | 中点及值 | 下一步 |
|---|---|---|
| [0, 4) | 索引 2，值 4 | 令 hi = 2 |
| [0, 2) | 索引 1，值 4 | 令 hi = 1 |
| [0, 1) | 索引 0，值 2 | 令 lo = 1 |
| [1, 1) | 候选区间为空 | 返回 1 |

```kui
version: 1
type: interactive
state:
  step: {type: number, default: 0, min: 0, max: 3, step: 1}
data:
  frames:
    - {detail: '[0, 4) 内，a[2] = 4，令 hi = 2。', lines: [3, 4, 7]}
    - {detail: '[0, 2) 内，a[1] = 4，令 hi = 1。', lines: [3, 4, 7]}
    - {detail: '[0, 1) 内，a[0] = 2，令 lo = 1。', lines: [3, 4, 5]}
    - {detail: '[1, 1) 已空，返回索引 1。', lines: [8]}
layout:
  type: stack
  children:
    - {type: stepper, bind: step, label: 候选区间变化, labels: ['[0, 4)', '[0, 2)', '[0, 1)', '[1, 1)']}
    - {type: text, body: '{{frames[step].detail}}'}
    - type: code
      title: 查找第一个大于或等于 target 的位置
      language: python
      lineNumbers: true
      code: |-
        lo, hi = 0, len(a)
        while lo < hi:
            mid = (lo + hi) // 2
            if a[mid] < target:
                lo = mid + 1
            else:
                hi = mid
        return lo
      highlight: '{{frames[step].lines}}'
```

试着预测同一数组查找 10 的返回值。所有元素均小于 10，因此插入位置是数组末尾，索引为 4。
