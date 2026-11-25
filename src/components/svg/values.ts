import type { FieldPath, JsonObject, JsonValue, ValueGuard } from "#contracts";
import { isArray, isObject } from "../../core/protocol/support.ts";
import { isId, isNonnegative, isNumber, isPaint, isPositive, isText } from "./diagram.ts";
import { isPath } from "./geometry.ts";

type FieldVisitor = <T extends JsonValue>(
  path: FieldPath, raw: JsonValue, accepts: ValueGuard<T>, expected: string,
) => void;

const isOpacity = (value: JsonValue): value is number => isNumber(value) && value >= 0 && value <= 1;
const line = ["x1", "y1", "x2", "y2"];
const coords = ["x", "y"];
const center = ["cx", "cy"];

export function elementFields(value: JsonObject, visit: FieldVisitor): void {
  const field = <T extends JsonValue>(key: string, guard: ValueGuard<T>, expected: string) => {
    const raw = value[key];
    if (raw !== undefined) visit([key], raw, guard, expected);
  };
  const finite = (keys: readonly string[]) => {
    for (const key of keys) field(key, isNumber, "a finite SVG coordinate");
  };
  const positive = (keys: readonly string[]) => {
    for (const key of keys) field(key, isPositive, "a positive SVG dimension");
  };

  for (const key of ["fill", "stroke"]) field(key, isPaint, "a semantic SVG paint");
  field("clip", isId, "a local clip ID");
  field("strokeWidth", isNonnegative, "a nonnegative stroke width");
  field("opacity", isOpacity, "an opacity from zero to one");
  if (isArray(value.transform)) {
    for (const [index, transform] of value.transform.entries()) {
      if (!isObject(transform)) continue;
      const keys = transform.kind === "rotate" ? ["degrees"] : coords;
      for (const key of keys) {
        const raw = transform[key];
        if (raw !== undefined) visit(["transform", index, key], raw, isNumber, "a finite transform parameter");
      }
    }
  }

  switch (value.kind) {
    case "line":
    case "arrow":
      finite(line);
      break;
    case "rect":
    case "use-symbol":
      finite(coords);
      positive(["width", "height"]);
      if (value.kind === "rect") field("rx", isNonnegative, "a nonnegative corner radius");
      break;
    case "circle":
      finite(center);
      positive(["r"]);
      break;
    case "ellipse":
      finite(center);
      positive(["rx", "ry"]);
      break;
    case "path":
      field("d", isPath, "complete, finite SVG path data");
      break;
    case "text":
      finite(coords);
      field("text", isText, "text");
      break;
    case "polyline":
    case "polygon": {
      const minimum = value.kind === "polygon" ? 3 : 2;
      if (isArray(value.points)) {
        for (const [index, point] of value.points.entries()) {
          if (!isObject(point)) continue;
          for (const key of coords) {
            const raw = point[key];
            if (raw !== undefined) visit(["points", index, key], raw, isNumber, "a finite SVG coordinate");
          }
        }
      } else {
        field("points", (raw): raw is readonly JsonObject[] => isArray(raw) && raw.length >= minimum
          && raw.length <= 512 && raw.every(point => isObject(point) && Object.keys(point).length === 2
            && Object.hasOwn(point, "x") && Object.hasOwn(point, "y")
            && isNumber(point.x ?? null) && isNumber(point.y ?? null)), "an array of SVG points");
      }
      break;
    }
  }
}
