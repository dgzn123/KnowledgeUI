import { isReservedKey } from "../protocol/support.ts";

export class ExpressionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function refuse(code: string, message: string): never {
  throw new ExpressionError(code, message);
}

type Token =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string" | "name" | "symbol"; readonly value: string }
  | { readonly kind: "end"; readonly value: "" };

const numberPattern = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
const namePattern = /[A-Za-z_][A-Za-z0-9_]*/y;
const operators = new Set(["==", "!=", "<=", ">=", "&&", "||"]);
const escapes = new Map([["n", "\n"], ["r", "\r"], ["t", "\t"], ["b", "\b"], ["f", "\f"],
  ["\\", "\\"], ["/", "/"], ["'", "'"], ['"', '"']]);

class Lexer {
  #offset = 0;

  readonly #source: string;

  constructor(source: string) { this.#source = source; }

  next(): Token {
    while (/\s/.test(this.#source[this.#offset] ?? "")) this.#offset++;
    const char = this.#source[this.#offset];
    if (char === undefined) return { kind: "end", value: "" };
    if (char === "'" || char === '"') return { kind: "string", value: this.#string(char) };

    numberPattern.lastIndex = namePattern.lastIndex = this.#offset;
    const numeric = numberPattern.exec(this.#source);
    if (numeric) {
      this.#offset = numberPattern.lastIndex;
      const value = Number(numeric[0]);
      if (!Number.isFinite(value)) refuse("non-finite", "Numeric literals must be finite.");
      return { kind: "number", value };
    }
    const identifier = namePattern.exec(this.#source);
    if (identifier) {
      this.#offset = namePattern.lastIndex;
      return { kind: "name", value: identifier[0] };
    }

    const pair = this.#source.slice(this.#offset, this.#offset + 2);
    if (operators.has(pair)) {
      this.#offset += 2;
      return { kind: "symbol", value: pair };
    }
    if ("+-*/%^<>!?:.,()[]".includes(char)) {
      this.#offset++;
      return { kind: "symbol", value: char };
    }
    return this.syntax("Unexpected character " + JSON.stringify(char));
  }

  syntax(message: string): never {
    return refuse("syntax", message + " near character " + (this.#offset + 1) + ".");
  }

  #string(quote: string): string {
    let value = "";
    this.#offset++;
    while (this.#offset < this.#source.length) {
      const char = this.#source[this.#offset++]!;
      if (char === quote) return value;
      if (char === "\n" || char === "\r") this.syntax("Unterminated string");
      if (char !== "\\") {
        value += char;
        continue;
      }
      const escaped = this.#source[this.#offset++] ?? "";
      if (escaped === "u") {
        const hex = this.#source.slice(this.#offset, this.#offset + 4);
        if (!/^[A-Fa-f0-9]{4}$/.test(hex)) this.syntax("Invalid Unicode escape");
        value += String.fromCharCode(Number.parseInt(hex, 16));
        this.#offset += 4;
      } else {
        const replacement = escapes.get(escaped);
        if (replacement === undefined) this.syntax("Invalid string escape");
        value += replacement;
      }
    }
    return this.syntax("Unterminated string");
  }
}

type Atom = null | boolean | number | string;
type Unary = "+" | "-" | "!";
const precedence = {
  "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "^": 8,
} as const;
export type Binary = keyof typeof precedence;

export type Tree = { readonly depth: number } & (
  | { readonly kind: "literal"; readonly value: Atom }
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "lookup"; readonly target: Tree; readonly key: Tree }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly Tree[] }
  | { readonly kind: "unary"; readonly op: Unary; readonly operand: Tree }
  | { readonly kind: "binary"; readonly op: Binary; readonly left: Tree; readonly right: Tree }
  | { readonly kind: "condition"; readonly test: Tree; readonly yes: Tree; readonly no: Tree }
);

export const constants: ReadonlyMap<string, Atom> = new Map<string, Atom>([
  ["true", true], ["false", false], ["null", null], ["PI", Math.PI], ["E", Math.E],
]);

type TreeNode = Tree extends infer Node ? Node extends Tree ? Omit<Node, "depth"> : never : never;

class Parser {
  readonly dependencies = new Set<string>();
  readonly #lexer: Lexer;
  #token: Token;

  readonly #maxDepth: number;
  readonly #functions: ReadonlyMap<string, unknown>;

  constructor(source: string, maxDepth: number, functions: ReadonlyMap<string, unknown>) {
    this.#maxDepth = maxDepth;
    this.#functions = functions;
    this.#lexer = new Lexer(source);
    this.#token = this.#lexer.next();
  }

  parse(): Tree {
    const tree = this.#expression(0, 1);
    if (this.#token.kind !== "end") this.#lexer.syntax("Unexpected token");
    return tree;
  }

  #check(depth: number): void {
    if (depth > this.#maxDepth) refuse("depth-limit", "Expression exceeds the allowed depth of " + this.#maxDepth + ".");
  }

  #node(node: TreeNode, children: readonly Tree[] = []): Tree {
    const depth = 1 + Math.max(0, ...children.map(child => child.depth));
    this.#check(depth);
    return { ...node, depth };
  }

  #advance(): Token {
    const token = this.#token;
    this.#token = this.#lexer.next();
    return token;
  }

  #match(symbol: string): boolean {
    if (this.#token.kind !== "symbol" || this.#token.value !== symbol) return false;
    this.#advance();
    return true;
  }

  #require(symbol: string): void {
    if (!this.#match(symbol)) this.#lexer.syntax("Expected " + symbol);
  }

  #expression(minimum: number, nesting: number): Tree {
    this.#check(nesting);
    const token = this.#token;
    let root: Tree;
    if (token.kind === "symbol" && (token.value === "!" || token.value === "+" || token.value === "-")) {
      this.#advance();
      const operand = this.#expression(7, nesting + 1);
      root = this.#node({ kind: "unary", op: token.value, operand }, [operand]);
    } else {
      root = this.#access(this.#primary(nesting), nesting);
    }
    while (this.#token.kind === "symbol" && Object.hasOwn(precedence, this.#token.value)) {
      const op = this.#token.value as Binary;
      const priority = precedence[op];
      if (priority < minimum) break;
      this.#advance();
      const right = this.#expression(op === "^" ? priority : priority + 1, nesting + 1);
      root = this.#node({ kind: "binary", op, left: root, right }, [root, right]);
    }
    if (minimum === 0 && this.#match("?")) {
      const yes = this.#expression(0, nesting + 1);
      this.#require(":");
      const no = this.#expression(0, nesting + 1);
      root = this.#node({ kind: "condition", test: root, yes, no }, [root, yes, no]);
    }
    return root;
  }

  #primary(nesting: number): Tree {
    if (this.#match("(")) {
      const root = this.#expression(0, nesting + 1);
      this.#require(")");
      return root;
    }
    const token = this.#advance();
    if (token.kind === "number" || token.kind === "string") {
      return this.#node({ kind: "literal", value: token.value });
    }
    if (token.kind !== "name") return this.#lexer.syntax("Expected an expression");
    const name = token.value;
    checkKey(name);
    if (this.#match("(")) {
      if (!this.#functions.has(name)) refuse("function", "Calls require a built-in function name.");
      const args: Tree[] = [];
      if (!this.#match(")")) {
        do args.push(this.#expression(0, nesting + 1)); while (this.#match(","));
        this.#require(")");
      }
      return this.#node({ kind: "call", name, args }, args);
    }
    if (this.#functions.has(name)) refuse("function", "Built-in function names must be called.");
    const constant = constants.get(name);
    if (constant !== undefined) return this.#node({ kind: "literal", value: constant });
    this.dependencies.add(name);
    return this.#node({ kind: "variable", name });
  }

  #access(root: Tree, nesting: number): Tree {
    for (;;) {
      let key: Tree;
      if (this.#match(".")) {
        const token = this.#advance();
        if (token.kind !== "name") this.#lexer.syntax("Expected a property name");
        checkKey(token.value);
        key = this.#node({ kind: "literal", value: token.value });
      } else if (this.#match("[")) {
        key = this.#expression(0, nesting + 1);
        this.#require("]");
        if (key.kind === "literal" && typeof key.value === "string") checkKey(key.value);
      } else {
        return root;
      }
      root = this.#node({ kind: "lookup", target: root, key }, [root, key]);
    }
  }
}

export function checkKey(key: string): void {
  if (isReservedKey(key)) refuse("property", "Property " + JSON.stringify(key) + " is reserved.");
}

export function parse(source: string, maxDepth: number, functions: ReadonlyMap<string, unknown>) {
  const parser = new Parser(source, maxDepth, functions);
  return { tree: parser.parse(), dependencies: parser.dependencies };
}
