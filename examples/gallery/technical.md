# 技术文档组件

发布说明可随交付物归档。先把标题和摘要组装成正文，再用终端记录说明一次发布检查的结果，最后标出正文和附录的位置。

## 逐步查看代码

下例展示如何组装一份发布说明。“取出内容”和“组装正文”对应不同的行。说明文字列在代码下方，可按行号对照。

```kui
version: 1
type: interactive
state:
  step: { type: number, default: 0, min: 0, max: 2, step: 1 }
data:
  linesByStep:
    - [1]
    - [{ from: 2, to: 3 }]
    - [4]
layout:
  type: stack
  direction: column
  children:
    - type: stepper
      bind: step
      labels: [读取记录, 取出内容, 组装正文]
    - type: code
      title: 生成发布说明
      language: javascript
      lineNumbers: true
      code: |-
        const record = { heading: "Release notes", summary: "A short summary of the changes." };
        const heading = record.heading;
        const summary = record.summary;
        const note = [heading, "", summary].join("\n");
      highlight: "{{linesByStep[step]}}"
      annotations:
        - { line: 1, text: 示例记录包含标题与摘要。 }
        - { line: 4, text: 标题与摘要之间保留一个空行。 }
```

## 阅读终端记录

这是一份示意记录。第一次检查找到正文，第二次检查报告附录仍待补全。

```kui
version: 1
type: terminal
title: 发布前检查记录
prompt: "$"
lines:
  - { kind: command, text: "ls draft" }
  - { kind: output, text: "release-notes.md" }
  - { kind: command, text: "ls draft/appendix.md" }
  - { kind: error, text: "ls: draft/appendix.md: No such file or directory" }
```

## 浏览归档结构

`release-notes.md` 放在草稿目录，归档目录留存上一版。目录行可点击，键盘聚焦后可用 Enter 或空格展开。

```kui
version: 1
type: file-tree
title: 发布说明目录
openDepth: 1
entries:
  - kind: directory
    name: release
    children:
      - kind: directory
        name: draft
        children:
          - { kind: file, name: release-notes.md, detail: 本次发布说明 }
      - kind: directory
        name: archive
        children:
          - { kind: file, name: previous.md, detail: 上一版 }
```
