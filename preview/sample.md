# 读懂一个比例

比例用于比较同一单位下的量。先确认分子和分母，再描述它们之间的关系。

~~~kui
version: 1
type: section
title: 样本完成情况
children:
  - type: metric
    label: 已完成
    value: 3
    unit: 项
  - type: callout
    tone: info
    title: 分母决定解释
    body: 总数为 4 项，所以完成率为 75%。
~~~

这里的已完成项数与总项数都是整数。总数大于零时，完成率等于已完成项数除以总项数。
