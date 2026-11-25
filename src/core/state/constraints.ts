import type { StateDefinition, StateValue } from "#contracts";

interface DefinitionIssue {
  readonly field: string;
  readonly message: string;
}

export function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function ownData<T>(object: Readonly<Record<string, T>>, name: string): T | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  return descriptor && "value" in descriptor ? descriptor.value as T : undefined;
}

function aligned(offset: number): boolean {
  if (!Number.isFinite(offset)) return false;
  const tolerance = Math.min(1e-7, 8 * Number.EPSILON * Math.max(1, Math.abs(offset)));
  const multiple = Math.round(offset);
  return multiple !== 0 && Math.abs(offset - multiple) <= tolerance;
}

function stepAligned(value: number, base: number, step: number): boolean {
  if (value === base) return true;
  const offset = (value - base) / step;
  return aligned(Number.isFinite(offset) ? offset : value / step - base / step);
}

export function valueIssue(definition: StateDefinition, value: unknown): string | undefined {
  if (typeof value !== definition.type) return "Expected a value of type " + definition.type + ".";
  if (definition.type !== "number") return;
  if (!finiteNumber(value)) return "Expected a finite number.";
  if (definition.min !== undefined && value < definition.min) return "Value is below the minimum.";
  if (definition.max !== undefined && value > definition.max) return "Value is above the maximum.";
  if (definition.step !== undefined && !stepAligned(value, definition.min ?? definition.default, definition.step)) {
    return "Value does not align with the declared step.";
  }
  return;
}

export function definitionIssue(definition: StateDefinition): DefinitionIssue | undefined {
  if (definition.type === "number") {
    const { min, max, step } = definition;
    if (min !== undefined && !finiteNumber(min)) return { field: "min", message: "Minimum must be finite." };
    if (max !== undefined && (!finiteNumber(max) || (min !== undefined && max < min))) {
      return { field: "max", message: "Maximum must be finite and at least the minimum." };
    }
    if (step !== undefined && (!finiteNumber(step) || step <= 0)) {
      return { field: "step", message: "Step must be finite and positive." };
    }
  }
  const message = valueIssue(definition, definition.default);
  return message === undefined ? undefined : { field: "default", message };
}

type ActionShape =
  | { readonly type: "set"; readonly bind: string; readonly value: unknown }
  | { readonly type: "reset" | "toggle"; readonly bind: string }
  | { readonly type: "increment"; readonly bind: string; readonly by: unknown };

export function readAction(input: unknown): ActionShape | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return;
  const fields = input as Readonly<Record<string, unknown>>;
  const type = ownData(fields, "type");
  const bind = ownData(fields, "bind");
  if (typeof bind !== "string") return;
  switch (type) {
    case "set":
      if (Object.keys(fields).length === 3) return { type, bind, value: ownData(fields, "value") };
      break;
    case "increment":
      if (Object.keys(fields).length === 3) return { type, bind, by: ownData(fields, "by") };
      break;
    case "toggle": case "reset":
      if (Object.keys(fields).length === 2) return { type, bind };
      break;
  }
  return;
}

export function actionIssue(definition: StateDefinition, action: ActionShape): DefinitionIssue | undefined {
  switch (action.type) {
    case "toggle":
      return definition.type === "boolean" ? undefined : { field: "bind", message: "Toggle requires boolean state." };
    case "set": {
      const message = valueIssue(definition, action.value);
      return message === undefined ? undefined : { field: "value", message };
    }
    case "increment":
      if (definition.type !== "number") return { field: "bind", message: "Increment requires numeric state." };
      if (!finiteNumber(action.by) || (definition.step !== undefined && !stepAligned(action.by, 0, definition.step))) {
        return { field: "by", message: "Increment must be finite and align with the declared step." };
      }
      return;
    case "reset": return;
  }
}

/** Recover decimal-grid values such as 0.1 + 0.2 after floating-point arithmetic. */
function incrementValue(definition: StateDefinition, current: number, delta: number): number {
  const sum = current + delta;
  if (definition.type !== "number" || definition.step === undefined || !Number.isFinite(sum)) return sum;
  const { step } = definition;
  const base = definition.min ?? definition.default;
  const decimal = Math.max(0, decimalPlaces(base), decimalPlaces(step));
  if (decimal > 100) return sum;

  const rounded = Number(sum.toFixed(decimal));
  const margin = Math.min(step * 1e-7, 2 * Number.EPSILON * Math.max(Math.abs(current), Math.abs(delta)));
  return Math.abs(sum - rounded) <= margin && valueIssue(definition, rounded) === undefined ? rounded : sum;
}

function decimalPlaces(value: number): number {
  const [mantissa, exponent] = String(value).split("e");
  return (mantissa?.split(".")[1]?.length ?? 0) - Number(exponent ?? 0);
}

export function actionValue(definition: StateDefinition, current: StateValue, action: ActionShape): StateValue {
  switch (action.type) {
    case "set": return action.value as StateValue;
    case "reset": return definition.default;
    case "toggle": return !current;
    case "increment": return incrementValue(definition, current as number, action.by as number);
  }
}
