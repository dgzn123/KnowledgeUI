import type { ComponentSemanticValidator, ComponentValidationInput, Diagnostic, FieldPath } from "#contracts";
import { actionIssue, definitionIssue, ownData, readAction, valueIssue } from "../../core/state/constraints.ts";
import type { Choice, QuizOption } from "./types.ts";

function issue(input: ComponentValidationInput, field: FieldPath, code: string, message: string): Diagnostic {
  const range = input.node.locate(field) ?? input.node.source.range;
  return {
    path: [...input.node.source.path, ...field], ...(range && { range }),
    ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
    code: "semantic." + code, message, severity: "error", phase: "semantic",
  };
}

export const validateControl: ComponentSemanticValidator = input => {
  const { node, state } = input;
  const { type, props } = node;
  if (type === "interactive") {
    return Object.entries(state).flatMap(([name, definition]) => {
      const invalid = definitionIssue(definition);
      return invalid ? [issue(input, ["state", name, invalid.field], "state-definition", invalid.message)] : [];
    });
  }
  if (type === "quiz") {
    const options = props.options as unknown as readonly QuizOption[];
    return options.filter(option => option.correct).length === 1 ? []
      : [issue(input, ["options"], "quiz-correct-count", "A quiz requires exactly one correct answer.")];
  }

  const action = type === "button" ? readAction(props.action) : undefined;
  if (type === "button" && !action) return [issue(input, ["action"], "action", "Expected a declared action.")];
  const bind = action?.bind ?? props.bind as string;
  const definition = ownData(state, bind);
  if (!definition) {
    return [issue(input, action ? ["action", "bind"] : ["bind"], "control-bind", "Expected a writable state in this interactive scope.")];
  }
  if (action) {
    const invalid = actionIssue(definition, action);
    return invalid ? [issue(input, ["action", invalid.field], "action", invalid.message)] : [];
  }

  if (type === "select") {
    if (definition.type === "boolean") {
      return [issue(input, ["bind"], "control-bind", "Select requires numeric or string state.")];
    }
    const options = props.options as unknown as readonly Choice[];
    const values = new Set<string | number>();
    const diagnostics: Diagnostic[] = [];
    for (const [index, option] of options.entries()) {
      const invalid = valueIssue(definition, option.value);
      if (invalid || values.has(option.value)) {
        diagnostics.push(issue(input, ["options", index, "value"], "option-value",
          invalid ?? "Select option values must be unique."));
      }
      values.add(option.value);
    }
    if (!values.has(definition.default)) {
      diagnostics.push(issue(input, ["options"], "select-default", "Select options must include the bound default."));
    }
    return diagnostics;
  }

  if (definition.type !== (type === "toggle" ? "boolean" : "number")) {
    return [issue(input, ["bind"], "control-bind", "The control and bound state types must match.")];
  }
  if (definition.type === "number") {
    if (type === "slider" && (definition.min === undefined || definition.max === undefined || definition.step === undefined)) {
      return [issue(input, ["bind"], "slider-range", "Slider state requires a minimum, maximum and step.")];
    }
    if (type === "stepper") {
      const labels = props.labels as readonly string[];
      if (definition.min !== 0 || definition.max !== labels.length - 1 || definition.step !== 1) {
        return [issue(input, ["bind"], "stepper-range", "Stepper state must run from zero through the last label with a step of one.")];
      }
    }
  }
  return [];
};
