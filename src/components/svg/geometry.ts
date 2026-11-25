import { V1_LIMITS } from "#contracts";
import type { JsonValue } from "#contracts";
import { isNumber, isPositive } from "./diagram.ts";

export type ViewBox = readonly [number, number, number, number];
const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const boxSyntax = new RegExp("^\\s*" + number + "(?:[ ,]+" + number + "){3}\\s*$");

export function readViewBox(value: JsonValue | undefined): ViewBox | undefined {
  if (typeof value !== "string" || !boxSyntax.test(value)) return;
  const [x, y, width, height] = value.trim().split(/[ ,]+/).map(Number);
  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined
    && isNumber(x) && isNumber(y) && isPositive(width) && isPositive(height)) return [x, y, width, height];
}

const parameters: ReadonlyMap<string, string> = new Map([
  ["M", "nn"], ["L", "nn"], ["H", "n"], ["V", "n"],
  ["C", "nnnnnn"], ["S", "nnnn"], ["Q", "nnnn"], ["T", "nn"],
  ["A", "rrnffnn"], ["Z", ""],
]);

/** Parse complete SVG path data, including compact signs and single-character arc flags. */
export function isPath(value: JsonValue): value is string {
  if (typeof value !== "string" || value.length > V1_LIMITS.sourceBytes) return false;
  const token = new RegExp(number, "y");
  let index = 0;
  let command: string | undefined;
  const whitespace = () => {
    while (/[ \t\r\n]/.test(value[index] ?? "")) index++;
  };
  whitespace();
  if (value[index] !== "M" && value[index] !== "m") return false;

  while (index < value.length) {
    const char = value[index]!;
    const explicit = /[a-zA-Z]/.test(char);
    if (explicit) {
      command = char.toUpperCase();
      index++;
    }
    const fields = command === undefined ? undefined : parameters.get(command);
    if (fields === undefined || (!explicit && fields.length === 0)) return false;
    for (let field = 0; field < fields.length; field++) {
      whitespace();
      if ((!explicit || field > 0) && value[index] === ",") {
        index++;
        whitespace();
      }
      const kind = fields[field];
      if (kind === "f") {
        if (value[index] !== "0" && value[index] !== "1") return false;
        index++;
      } else {
        token.lastIndex = index;
        const match = token.exec(value);
        if (!match || !isNumber(Number(match[0])) || (kind === "r" && match[0].startsWith("-"))) return false;
        index = token.lastIndex;
      }
    }
    if (command === "M") command = "L";
    whitespace();
  }
  return true;
}
