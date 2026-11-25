# Knowledge UI

[English](README.md)

Knowledge UI 是一个 Obsidian 插件，把 Markdown 里的 `kui` 代码块渲染成交互笔记。可以用滑块探索模型、用步进器同步代码高亮与图解，也可以直接展示公式、表格、图表和时序图。笔记中的结论和推导仍用普通 Markdown 编写，交互状态只存在于当前块的内存中。

Protocol v1 提供 31 个核心组件和一个声明式模板入口。Obsidian 插件、离线浏览器预览和校验 CLI 使用同一套协议和组件定义。

## 快速开始

需要 Git、Node.js 24.22.3 或同一主版本的较新版本，以及 npm 11。克隆或解压本仓库，然后在仓库根目录运行。

```sh
npm ci
npm run preview
```

浏览器打开 `http://127.0.0.1:4173/`，从顶部选择器打开「组件 Gallery」或任一示范笔记。可以切换深浅色和四档容器宽度，也可以打开本地 Markdown 文件。端口占用时运行 `npm run preview -- 4200`。预览服务监听本机回环地址，构建后的两种宿主都可离线使用。独立浏览器预览会用可读文本呈现 LaTeX、Obsidian 内链和附件。

### 自带示范

| 示例 | 可以体验的功能 |
|---|---|
| [组件 Gallery](examples/Component%20Gallery.md) | 32 个活动类型，包含布局、数据展示、控件、图解及模板 |
| [MOSFET 特性与小信号](examples/notes/mosfet.md) | 调整电压和阈值，观察特性曲线、工作点与电路符号 |
| [Linux 进程与文件描述符](examples/notes/linux-fork-exec-fd.md) | 逐步观察 `fork`、`exec` 与描述符表，代码高亮同步变化 |
| [TCP 握手与拥塞窗口](examples/notes/tcp-handshake-congestion.md) | 握手时序、慢启动及不同丢包情形下的窗口演化 |
| [链表反转与树遍历](examples/notes/linked-list-reversal.md) | 用步进器查看指针图与递归遍历过程 |
| [二阶系统的阻尼](examples/notes/second-order-system.md) | 对照阶跃响应、幅频曲线及首峰读数 |

## 安装到 Obsidian

### 从发行版安装

从 [GitHub Releases](https://github.com/dgzn123/KnowledgeUI/releases/latest) 下载同一版本的 `main.js`、`manifest.json` 和 `styles.css`。关闭目标 Vault，把三个文件放入 `<Vault>/.obsidian/plugins/knowledge-ui/`，再重新打开，在 **设置 → 第三方插件** 中启用 **Knowledge UI**。使用自定义配置目录的 Vault，把 `.obsidian` 换成实际目录名。

Android 可以用显示隐藏文件的文件管理器访问 `.obsidian`。iPhone 和 iPad 可以用有权访问 Vault 且能显示隐藏目录的文件工具。启用后用阅读视图打开包含 `kui` 的笔记。 [Obsidian 移动端配置目录说明](https://obsidian.md/help/configuration-folder)

### 从源码安装

先用 Obsidian 打开目标 Vault，使其已有配置目录。等当前同步结束并关闭目标 Vault，再把命令中的路径替换为 Vault 根目录。对同一个 Vault 使用同一份源码检出，以便沿用本地回滚历史。

```sh
npm run deploy -- --vault "/path/to/Vault"
```

命令先构建并运行测试，通过后把同一版的 `main.js`、`manifest.json` 和 `styles.css` 写入 `<Vault>/.obsidian/plugins/knowledge-ui/`。重新打开 Obsidian，在 **设置 → 第三方插件** 中刷新列表并启用 **Knowledge UI**，然后用阅读视图打开一篇含 `kui` 块的笔记。可以先把 Gallery 或任意示范笔记复制到 Vault。

手动安装时，先运行 `npm run build`，再将 `dist/obsidian/` 中的三个文件一起复制到当前 Vault 的活动配置目录下的 `plugins/knowledge-ui/`。自定义配置目录和逐设备安装可用这个方法。手动更新前，将原有三件套备份到 Vault 外。

### 更新和回滚

更新时重新运行部署命令。升级前的备份保存在源码检出的 `backups/`。回退到最近一次部署前的版本时，在关闭 Vault 后运行下面的命令。如果部署中断且输出 `Recovery pending`，先处理文件占用或磁盘问题，再用带 `--recover` 的命令恢复中断前的文件。

```sh
npm run rollback -- --vault "/path/to/Vault"
npm run rollback -- --vault "/path/to/Vault" --recover
```

使用 Remotely Save 或 OneDrive 时，可继续同步笔记并在每台设备安装同一版插件。实际 Vault 的同步配置、过滤规则和设备兼容性需在对应环境核对。

## 写一篇交互笔记

把下面的内容粘贴进 Obsidian 笔记。切到阅读视图后，拖动滑块会更新同一块里的读数。

````markdown
拖动滑块，观察每移动一步时完成度如何变化。

```kui
version: 1
type: interactive
state:
  level: { type: number, label: 完成度, default: 25, min: 0, max: 100, step: 5 }
layout:
  type: stack
  direction: column
  children:
    - type: slider
      bind: level
    - type: metric
      label: 当前完成度
      value: "{{level}}"
      unit: "%"
```
````

`state` 定义可修改的值，`bind` 将控件连接到该值，`{{level}}` 把当前值传给显示组件。将 Markdown 文件交给本地预览器检查显示，或运行以下命令检查 YAML、组件字段、表达式和扩展引用。 [Protocol v1](skills/knowledge-ui/references/protocol.md) · [组件参考](skills/knowledge-ui/references/components.md)

```sh
npm run validate -- "/path/to/note.md"
```

## Codex Skill

配套 Skill 提供组件选型、交互设计、笔记校验流程和三份可运行范例。Linux 上可在仓库根目录用下面的命令安装到当前仓库。已经存在同名 Skill 时，先核对它指向的目录。 [Skill 入口](skills/knowledge-ui/SKILL.md)

```sh
mkdir -p .agents/skills
ln -sT ../../skills/knowledge-ui .agents/skills/knowledge-ui
```

在一条新 Codex 会话中试用「用 `$knowledge-ui` 把这段讲解改成一篇含可复算图表的笔记」。若在另一仓库使用，让该仓库的 `.agents/skills/knowledge-ui` 指向本项目 `skills/knowledge-ui/` 的绝对路径。在本项目根目录运行 `npm run validate` 时，可用绝对路径校验另一仓库的笔记。

## 开发和验证

| 命令 | 用途 |
|---|---|
| `npm run dev` | 监听源码、样式、Manifest 和预览示例变动，重建插件和预览 |
| `npm run preview` | 启动本地 Preview，开发时刷新页面查看变化 |
| `npm run check` | 运行 TypeScript 检查并核对组件参考 |
| `npm run test` | 执行自动化测试，Chromium 和本机编译工具可用于对应的宿主及系统调用测试 |
| `npm run validate` | 校验自带 Gallery、示范和 Skill 示例 |
| `npm run build` | 生成 `dist/obsidian/`、`dist/preview/` 和 `dist/contracts/` |

```text
src/                 共享协议、渲染核心、组件、扩展和宿主适配
preview/             浏览器预览页面
cli/                 笔记静态校验入口
scripts/             构建、预览、部署和回滚
examples/            Gallery 和示范笔记
skills/knowledge-ui/ Codex Skill 与协议、组件参考
tests/               自动化测试与测试数据
```

声明式符号和模板通过 `src/extensions/` 注册，随构建进入两种宿主和 CLI。新增扩展后用显式笔记调用验证 `namespace:name`、参数与渲染结果。 [内置符号](src/extensions/electronics.ts) · [内置模板](src/extensions/common.ts)

## 验证范围

Linux Chromium 和 Obsidian 1.15.1 已用于验证预览、阅读视图、实时预览和临时 Vault 安装回滚。Windows、macOS、iOS/iPadOS 和 Android 的 Obsidian 运行待实机验证。二阶系统的阶跃图使用 0–12 s 固定窗口，部分参数下的首峰读数可能落在图窗外。

## 许可证

项目源码从 0.1.1 起采用 [MIT 许可证](LICENSE)。插件在 Obsidian 内本地解析和渲染笔记，可离线使用。随插件打包的 `yaml` 采用 ISC 许可证，其版权和许可原文随 JavaScript 制品分发。 [yaml 项目](https://github.com/eemeli/yaml)
