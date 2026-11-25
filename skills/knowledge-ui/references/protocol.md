# Protocol v1 写法

`kui` 围栏内是一个 YAML 1.2 Core 映射。根节点写 `version: 1` 和 `type`，子节点只声明自己的 `type` 与对应字段。缺少根版本会按 v1 解释并给出警告。显式版本必须是整数 1。属性与 `type` 同级，字段及嵌套形状见 [组件参考](components.md)。

````markdown
```kui
version: 1
type: metric
label: 已核对
value: 3
unit: 项
```
````

使用单文档、有限数字和字符串键。YAML 拒绝标签、锚点、别名、合并键、指令和重复键。长文本用 `|-`，带反斜杠的 LaTeX 或带 `{{…}}` 的表达式优先用 YAML 单引号。保留字面文本 `true`、`null` 或数字字样时加引号。普通解释放在围栏外。扫描器处理 Markdown 围栏，并跳过 HTML 注释和其它语言围栏内的内容。

## 结构和作用域

- 插槽声明有「单节点」和「节点列表」两种。例子包括 `interactive.layout`、`section.children`、`compare.panels[].children`。保持引号、缩进和结构与参考一致。
- 标为「允许插值」的字段可以写 `'{{value}}'`。独占整个值时保留求值类型，混合文本时生成字符串。标为「原始表达式」的字段使用 `value > 0` 之类的表达式字符串。详见 [状态与步进](interaction.md)。
- `when` 要求布尔表达式。`repeat` 遍历只读数组，`as` 和可选零基 `index` 在当前实例及后代可见。嵌套 `interactive` 的外层结构条件用父作用域，其内部有独立状态模型。
- `template.name` 与 `use-symbol.symbol` 使用随当前版本打包的 `namespace:name`。模板参数在调用处求值，展开体拥有自己的参数和实例状态。符号使用 [SVG 图元结构](components.md#svgelement)。

## 校验边界

生成参考来自活动注册定义及其结构 Schema。共享 CLI 同时检查 YAML 和组件结构，并对跨字段或环境约束给出诊断，例如作用域、状态范围与步长、选项一致性、图形坐标和扩展引用。特别关注运行时才确定的绑定结果、图表采样结果、显示溢出和交互状态，它们需要在 Preview 中实际检查。事实、来源和公式由作者独立核验。

```sh
npm run validate -- "/path/to/note.md"
```

CLI 结果含文件、行列、诊断代码及字段。退出码 `0` 表示无错误，仍可能有警告。`1` 表示校验错误，`2` 表示参数或读取错误。自定义路径始终显式传入，默认命令使用仓库自带的几组产品样例。

可查[组件参考](components.md)和[状态与步进](interaction.md)核对组件语义与表达式规则。生产入口为 `src/composition/protocol.ts`，数值预算以 `src/contracts/shared.ts` 的 `V1_LIMITS` 为准。运行 `npm run build:contracts` 可将协议 Schema 导出到 `dist/contracts/protocol-v1.schema.json`。
