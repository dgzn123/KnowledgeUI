import { V1_LIMITS } from "#contracts";
import type { DocumentSource, FieldPath, JsonValue, ProtocolValues, Result, SourceRange, YamlReader } from "#contracts";
import { Composer, CST, Lexer, LineCounter, Parser, isAlias, isMap, isScalar, isSeq } from "yaml";
import type { Node, Range, YAMLError } from "yaml";
import { Diagnostics, isReservedKey, pointer, record } from "./support.ts";

function sourceRanges(source: string): (start: number, end: number) => SourceRange {
  const lines = new LineCounter();
  lines.addNewLine(0);
  for (let offset = source.indexOf("\n"); offset !== -1; offset = source.indexOf("\n", offset + 1)) {
    lines.addNewLine(offset + 1);
  }
  const position = (index: number) => {
    const offset = Math.max(0, Math.min(index, source.length));
    const { line, col } = lines.linePos(offset);
    return { offset, line, column: col };
  };
  return (start, end) => ({ start: position(start), end: position(end) });
}

type RangeFactory = ReturnType<typeof sourceRanges>;

function limit(diagnostics: Diagnostics, span: RangeFactory, kind: "depth" | "nodes", offset: number): void {
  const message = kind === "depth"
    ? `YAML nesting exceeds ${V1_LIMITS.yamlDepth} levels.`
    : `YAML contains more than ${V1_LIMITS.yamlNodes} nodes.`;
  diagnostics.report("yaml", "yaml." + kind + "-limit", [], message, span(offset, offset + 1));
}

/** Counts actual CST nodes, including scalar keys and nodes implied by omitted values. */
function withinBudget(document: CST.Document, diagnostics: Diagnostics, span: RangeFactory): boolean {
  let count = 0;
  function visit(token: CST.Token | null | undefined, depth: number, offset: number): boolean {
    const start = token?.offset ?? offset;
    if (depth > V1_LIMITS.yamlDepth) {
      limit(diagnostics, span, "depth", start);
      return false;
    }
    if (++count > V1_LIMITS.yamlNodes) {
      limit(diagnostics, span, "nodes", start);
      return false;
    }
    if (!CST.isCollection(token)) return true;

    const map = token.type === "block-map"
      || (token.type === "flow-collection" && token.start.type === "flow-map-start");
    for (const item of token.items) {
      const itemStart = item.start[0]?.offset ?? start;
      if (item.key !== undefined) {
        // A flow sequence may contain an implicit one-pair mapping.
        if (!map && ++count > V1_LIMITS.yamlNodes) {
          limit(diagnostics, span, "nodes", itemStart);
          return false;
        }
        const childDepth = depth + (map ? 1 : 2);
        if (!visit(item.key, childDepth, itemStart) || !visit(item.value, childDepth, itemStart)) return false;
      } else if (item.value || item.start.some(part => part.type === "seq-item-ind" || part.type === "tag" || part.type === "anchor")) {
        if (!visit(item.value, depth + 1, itemStart)) return false;
      }
    }
    return true;
  }
  return visit(document.value, 1, document.offset);
}

function scan(source: string, diagnostics: Diagnostics, span: RangeFactory): CST.Token[] | undefined {
  const parser = new Parser();
  const tokens: CST.Token[] = [];
  let documents = 0;
  let explicitNodes = 0;
  let scalar = false;

  for (const lexeme of new Lexer().lex(source)) {
    const kind: CST.TokenType | null = scalar ? null : CST.tokenType(lexeme);
    scalar = kind === "scalar";
    const offset = parser.offset;
    if (kind === "directive-line") {
      diagnostics.report("yaml", "yaml.directive", [], "YAML directives are forbidden.", span(offset, offset + lexeme.length));
      return;
    }
    if (kind === "doc-mode" && ++documents > 1) {
      diagnostics.report("yaml", "yaml.multiple-documents", [], "Expected a single YAML document.", span(offset, offset + 3));
      return;
    }
    if (kind === "scalar" || kind === "alias" || kind === "flow-map-start" || kind === "flow-seq-start") {
      if (++explicitNodes > V1_LIMITS.yamlNodes) {
        limit(diagnostics, span, "nodes", offset);
        return;
      }
    }
    for (const token of parser.next(lexeme)) tokens.push(token);
    // The stack can contain one document frame and one pending scalar frame.
    // Check exact depth again on the completed CST before the recursive composer runs.
    if (parser.stack.length > V1_LIMITS.yamlDepth + 2) {
      limit(diagnostics, span, "depth", offset);
      return;
    }
  }
  for (const token of parser.end()) tokens.push(token);
  const document = tokens.find(token => token.type === "document");
  if (document && !withinBudget(document, diagnostics, span)) return;
  return tokens;
}

function readYaml({ yaml, sourceId }: DocumentSource): Result<ProtocolValues> {
  const locations = new Map<string, SourceRange>();
  const locate: ProtocolValues["locate"] = path => locations.get(pointer(path));
  const diagnostics = new Diagnostics(sourceId, locate);
  const finish = (value: JsonValue = null) => diagnostics.finish({ value, locate });

  if (yaml.length > V1_LIMITS.sourceBytes || new TextEncoder().encode(yaml).length > V1_LIMITS.sourceBytes) {
    diagnostics.report("yaml", "yaml.source-limit", [], `YAML source exceeds ${V1_LIMITS.sourceBytes} UTF-8 bytes.`);
    return finish();
  }
  const span = sourceRanges(yaml);
  const tokens = scan(yaml, diagnostics, span);
  if (!tokens) return finish();

  const composer = new Composer({ version: "1.2", schema: "core", merge: false, uniqueKeys: false, strict: true });
  const documents = [...composer.compose(tokens, true, yaml.length)];
  const document = documents[0];
  locations.set("", span(0, yaml.length));
  if (!document || documents.length > 1) {
    const second = documents[1]?.range;
    diagnostics.report("yaml", "yaml.multiple-documents", [], "Expected a single YAML document.",
      second && span(second[0], second[0] + 3));
    return finish();
  }

  const warnings = document.warnings.filter(warning => warning.code !== "TAG_RESOLVE_FAILED");
  const fields = document.errors.length || warnings.length ? [] as { path: FieldPath; range: SourceRange }[] : undefined;

  function range(node: { range?: Range | null } | null | undefined): SourceRange | undefined {
    return node?.range ? span(node.range[0], node.range[1]) : undefined;
  }

  function rejectProperties(node: Node, path: FieldPath, nodeRange: SourceRange | undefined): boolean {
    if (isAlias(node)) {
      diagnostics.report("yaml", "yaml.alias", path, "YAML aliases are forbidden.", nodeRange);
      return true;
    }
    if (node.anchor !== undefined) diagnostics.report("yaml", "yaml.anchor", path, "YAML anchors are forbidden.", nodeRange);
    if (node.tag !== undefined) diagnostics.report("yaml", "yaml.tag", path, "Explicit YAML tags are forbidden.", nodeRange);
    return false;
  }

  function check(node: Node | null | undefined, path: FieldPath, fallback?: SourceRange): void {
    const nodeRange = range(node) ?? fallback;
    if (nodeRange) {
      locations.set(pointer(path), nodeRange);
      fields?.push({ path, range: nodeRange });
    }
    if (!node || rejectProperties(node, path, nodeRange)) return;
    if (isScalar(node)) {
      const value = node.value;
      if (typeof value === "number" && !Number.isFinite(value)) {
        diagnostics.report("yaml", "yaml.non-finite", path, "Numbers must be finite.", nodeRange);
      } else if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        diagnostics.report("yaml", "yaml.scalar", path, "Expected a JSON-compatible scalar.", nodeRange);
      }
      return;
    }
    if (isSeq<Node>(node)) {
      for (const [index, child] of node.items.entries()) check(child, [...path, index], nodeRange);
    }
    if (isMap<Node, Node | null>(node)) {
      const keys = new Set<string>();
      for (const { key, value } of node.items) {
        const keyRange = range(key) ?? nodeRange;
        if (!isScalar(key) || typeof key.value !== "string") {
          diagnostics.report("yaml", "yaml.mapping-key", path, "Mapping keys must be strings.", keyRange);
          continue;
        }
        const field = [...path, key.value];
        rejectProperties(key, field, keyRange);
        if (key.value === "<<") {
          diagnostics.report("yaml", "yaml.merge-key", field, "YAML merge keys are forbidden.", keyRange);
        } else if (isReservedKey(key.value)) {
          diagnostics.report("yaml", "yaml.reserved-key", field, `Reserved mapping key ${JSON.stringify(key.value)}.`, keyRange);
        } else if (keys.has(key.value)) {
          diagnostics.report("yaml", "yaml.duplicate-key", field, `Duplicate key ${JSON.stringify(key.value)}.`, keyRange);
        } else {
          keys.add(key.value);
          check(value, field, keyRange);
        }
      }
    }
  }

  // Validation has already excluded aliases, unsafe keys and non-JSON scalars.
  function materialize(node: Node | null | undefined): JsonValue {
    if (isScalar(node)) return node.value as JsonValue;
    if (isSeq<Node>(node)) return node.items.map(materialize);
    if (isMap<Node, Node | null>(node)) {
      const object = record<JsonValue>();
      for (const { key, value } of node.items) {
        if (isScalar<string>(key)) object[key.value] = materialize(value);
      }
      return object;
    }
    return null;
  }

  const parserDiagnostic = (error: YAMLError) => {
    const code = error.code === "TAG_RESOLVE_FAILED" ? "yaml.tag" : "yaml.syntax";
    const [start] = error.pos;
    let path: FieldPath = [];
    for (const field of fields ?? []) {
      if (field.path.length > path.length && field.range.start.offset <= start && start <= field.range.end.offset) {
        path = field.path;
      }
    }
    diagnostics.report("yaml", code, path, error.message, span(...error.pos));
  };
  check(document.contents, []);
  // Keep the range lookup bounded even if the composer collects many independent errors.
  document.errors.slice(0, V1_LIMITS.diagnostics + 1).forEach(parserDiagnostic);
  // Unresolved explicit tags are already reported at their field by the AST walk.
  warnings.slice(0, V1_LIMITS.diagnostics + 1).forEach(parserDiagnostic);
  return diagnostics.errorCount ? finish() : finish(materialize(document.contents));
}

export const yamlReader: YamlReader = { read: readYaml };
