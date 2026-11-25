import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createProtocolSchema, v1Components } from "#protocol-schema";
import { activeRegistrations } from "../../../src/composition/protocol.ts";
import { createProtocolCatalog } from "../../../src/core/protocol/index.ts";

const reference = new URL("../references/components.md", import.meta.url);
const builtSchema = new URL("../../../dist/contracts/protocol-v1.schema.json", import.meta.url);
const bindingPattern = "^\\{\\{[\\s\\S]+\\}\\}$";

function byComponentType(left, right) {
  const a = left.properties.type.const;
  const b = right.properties.type.const;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparableSchema(schema) {
  const ordered = structuredClone(schema);
  // Registration order may differ from declaration order. Preserve order inside individual schemas.
  ordered.$defs.Node.oneOf?.sort(byComponentType);
  ordered.allOf[0].oneOf?.sort(byComponentType);
  return ordered;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function code(value) {
  return "`" + String(value).replaceAll("|", "\\|") + "`";
}

function alternatives(schema) {
  const branches = schema.anyOf ?? schema.oneOf ?? [];
  return schema["x-kui-value"] === "binding"
    ? branches.filter(branch => !isDeepStrictEqual(branch, { type: "string", pattern: bindingPattern }))
    : branches;
}

function shape(schema) {
  if (schema === true) return "任意值";
  if (schema === false) return "禁止";
  if ("const" in schema) return code(JSON.stringify(schema.const));
  if (schema.enum) return schema.enum.map(value => code(JSON.stringify(value))).join(" / ");
  if (schema.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    return name === "Node" ? "组件节点" : "[" + name + "](#" + name.toLowerCase() + ")";
  }
  const branches = alternatives(schema);
  if (branches.length) return [...new Set(branches.map(shape))].join(" / ");

  const constraints = [
    ["minimum", "≥"], ["maximum", "≤"], ["exclusiveMinimum", ">"], ["exclusiveMaximum", "<"],
    ["minLength", "字符数 ≥"], ["maxLength", "字符数 ≤"], ["minItems", "项数 ≥"], ["maxItems", "项数 ≤"],
  ].filter(([keyword]) => keyword in schema).map(([keyword, label]) => label + " " + schema[keyword]);
  if (schema.pattern) constraints.push("模式 " + code(schema.pattern));
  if (schema.not) constraints.push("排除 " + shape(schema.not));
  if (schema.type === "object" && schema.additionalProperties === false) constraints.push("拒绝未知字段");
  return [schema.type ? code(schema.type) : "值", ...constraints].join("，");
}

function fieldRow(path, schema, required) {
  const slot = schema["x-kui-slot"];
  const value = schema["x-kui-value"];
  const annotations = [
    slot === "single" ? "单节点插槽" : slot === "list" ? "节点列表插槽" : slot,
    value === "binding" ? "允许插值" : value === "expression" ? "原始表达式" : value,
  ].filter(Boolean);
  return "| " + code(path) + " | " + required + " | " + shape(schema) + " | " + annotations.join("，") + " |";
}

function nestedRows(path, schema) {
  if (schema.properties) {
    return Object.entries(schema.properties).flatMap(([name, field]) =>
      fieldRows(path + "." + name, field, schema.required?.includes(name) ? "是" : "可选"));
  }
  if (schema.items && !schema["x-kui-slot"]) return fieldRows(path + "[]", schema.items, "—");
  if (schema.propertyNames) {
    return [
      ...fieldRows(path + "{键}", schema.propertyNames, "—"),
      ...fieldRows(path + "{值}", schema.additionalProperties, "—"),
    ];
  }
  const branches = alternatives(schema);
  return branches.flatMap((branch, index) => {
    const hasFields = branch.properties || branch.items || branch.propertyNames || branch.anyOf || branch.oneOf;
    if (!hasFields) return [];
    if (branches.length === 1) return nestedRows(path, branch);
    const tag = Object.entries(branch.properties ?? {}).find(([, field]) => "const" in field);
    const variant = tag ? tag[0] + "=" + tag[1].const : "分支 " + (index + 1);
    return fieldRows(path + "(" + variant + ")", branch, "—");
  });
}

function fieldRows(path, schema, required) {
  return [fieldRow(path, schema, required), ...nestedRows(path, schema)];
}

function table(rows) {
  return ["| 字段 | 必填 | 字面结构与约束 | 协议标记 |", "|---|---|---|---|", ...rows, ""];
}

export function renderReference(catalog) {
  const components = [...catalog.components.values()].sort((a, b) => byComponentType(a.schema, b.schema));
  const schema = comparableSchema(catalog.schema);
  const digest = createHash("sha256").update(JSON.stringify(canonical(schema))).digest("hex");
  const first = components[0].schema;
  const common = Object.entries(first.properties).filter(([key, field]) => key !== "type"
    && components.every(component => isDeepStrictEqual(component.schema.properties[key], field)
      && component.schema.required.includes(key) === first.required.includes(key)));

  const shared = [
    ...fieldRows("version", schema.allOf[0].oneOf[0].properties.version, "根节点建议填写"),
    ...common.flatMap(([key, field]) => fieldRows(key, field, first.required.includes(key) ? "是" : "可选")),
  ];
  return [
    "# Protocol v1 组件参考",
    "",
    "<!-- Generated by skills/knowledge-ui/scripts/component-reference.mjs --write -->",
    "",
    "当前生产目录含 " + components.length + " 个组件。以下表格列出字面结构、必填项、插槽和表达式标记。",
    "每个组件的 `type` 必填，值为该节标题。`[]` 指数组项，`{键}` 和 `{值}` 指字典键值，括号标出联合类型分支。嵌套的「是」仅在其父项或分支存在时生效。",
    "作用域、绑定结果、关联字段及渲染边界见 [协议](protocol.md)、[交互](interaction.md)和[图形](visualization.md)。",
    "",
    components.map(({ type }) => "[`" + type + "`](#" + type + ")").join(" · "),
    "",
    "## 通用字段",
    "",
    ...table(shared),
    ...components.flatMap(({ type, description, schema: definition }) => {
      const fields = Object.entries(definition.properties).filter(([key]) => key !== "type" && !common.some(([name]) => name === key));
      const rows = fields.flatMap(([key, field]) => fieldRows(key, field, definition.required.includes(key) ? "是" : "可选"));
      return ["## " + type, "", description, "", ...(rows.length ? table(rows) : [])];
    }),
    "## 共享结构",
    "",
    ...Object.entries(schema.$defs).filter(([name]) => name !== "Node").flatMap(([name, definition]) =>
      ["### " + name, "", ...table(fieldRows(name, definition, "—"))]),
    "结构 Schema SHA-256（按键排序，组件分支按类型排序）",
    "",
    code(digest),
    "",
  ].join("\n");
}

function main(args) {
  const mode = args[0] ?? "--check";
  if (args.length > 1 || !["--write", "--check", "--check-built"].includes(mode)) {
    console.error("Usage: node skills/knowledge-ui/scripts/component-reference.mjs [--write|--check|--check-built]");
    return 2;
  }
  const catalog = createProtocolCatalog(activeRegistrations.map(({ definition }) => definition));
  if (!catalog.ok) throw new Error(catalog.diagnostics.map(({ message }) => message).join("\n"));
  const draft = mode === "--check-built"
    ? JSON.parse(readFileSync(builtSchema, "utf8"))
    : createProtocolSchema(v1Components);
  if (!isDeepStrictEqual(comparableSchema(catalog.value.schema), comparableSchema(draft))) {
    throw new Error("The active catalog and the Protocol v1 export schema differ.");
  }
  const generated = renderReference(catalog.value);
  if (mode === "--write") {
    writeFileSync(reference, generated);
  } else if (readFileSync(reference, "utf8").replaceAll("\r\n", "\n") !== generated) {
    throw new Error("Component reference is out of date. Run component-reference.mjs --write and review the diff.");
  }
  console.log("Component reference " + (mode === "--write" ? "updated" : "verified") + " (" + catalog.value.components.size + " active types).");
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
