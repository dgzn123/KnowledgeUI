import { V1_LIMITS } from "#contracts";
import type { Diagnostic, FieldPath, JsonObject, JsonValue, Result, SourceRange } from "#contracts";

export function pointer(path: FieldPath): string {
  return path.map(part => "/" + String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
}

export function record<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function own(object: JsonObject | undefined, key: string): JsonValue | undefined {
  return object && Object.hasOwn(object, key) ? object[key] : undefined;
}

const reservedKeys = new Set(["__proto__", "constructor", "prototype"]);

export function isReservedKey(key: string): boolean {
  return reservedKeys.has(key);
}

export class Diagnostics {
  private readonly items: Diagnostic[] = [];
  private dropped = false;
  errorCount = 0;

  readonly sourceId: string | undefined;
  private readonly locate: (path: FieldPath) => SourceRange | undefined;

  constructor(
    sourceId?: string,
    locate: (path: FieldPath) => SourceRange | undefined = () => undefined,
  ) {
    this.sourceId = sourceId;
    this.locate = locate;
  }

  add(diagnostic: Diagnostic): void {
    if (diagnostic.severity === "error") this.errorCount++;
    if (this.items.length === V1_LIMITS.diagnostics) {
      this.dropped = true;
      return;
    }
    const override = this.sourceId === undefined ? {} : { sourceId: this.sourceId };
    const range = diagnostic.range ?? this.locate(diagnostic.path);
    this.items.push({ ...diagnostic, ...override, ...(range && { range }) });
  }

  report(
    phase: Diagnostic["phase"],
    code: string,
    path: FieldPath,
    message: string,
    range?: SourceRange,
    severity: Diagnostic["severity"] = "error",
  ): void {
    this.add({ phase, code, path, message, severity, ...(range && { range }) });
  }

  list(): readonly Diagnostic[] {
    if (!this.dropped) return this.items;
    const shown = this.items.slice(0, V1_LIMITS.diagnostics - 1);
    shown.push({
      phase: this.items.at(-1)?.phase ?? "schema",
      code: "diagnostics.truncated",
      severity: this.errorCount > 0 && shown.every(item => item.severity !== "error") ? "error" : "warning",
      path: [],
      message: `Only the first ${shown.length} diagnostics are displayed.`,
      ...(this.sourceId !== undefined && { sourceId: this.sourceId }),
    });
    return shown;
  }

  finish<T>(value: T): Result<T> {
    const diagnostics = this.list();
    return this.errorCount ? { ok: false, diagnostics } : { ok: true, value, diagnostics };
  }
}
