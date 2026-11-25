import {
  boolean, choice, component, dictionary, expression, identifier, label, list, number, object, positive,
  ref, scalar, slot, string, tagged, text, union,
} from "./fields.ts";

const stateDefinition = union(
  tagged("type", "number", { default: number, label, min: number, max: number, step: positive, unit: label }, ["default"]),
  tagged("type", "string", { default: string, label }, ["default"]),
  tagged("type", "boolean", { default: boolean, label }, ["default"]),
);
const action = union(
  tagged("type", "set", { bind: identifier, value: scalar }, ["bind", "value"]),
  tagged("type", "reset", { bind: identifier }, ["bind"]),
  tagged("type", "toggle", { bind: identifier }, ["bind"]),
  tagged("type", "increment", { bind: identifier, by: number }, ["bind", "by"]),
);
const control = { bind: identifier, label: text } as const;
const option = object({ label: text, value: union(string, number) }, ["label", "value"]);
const quizOption = object({ label: text, correct: boolean, explanation: text }, ["label", "correct"]);

export const interactionComponents = [
  component("interactive", "Instance-scoped state, data and computations", {
    title: text, state: dictionary(stateDefinition), data: dictionary(ref("Data")),
    computed: dictionary(expression), layout: slot,
  }, ["layout"]),
  component("slider", "Bound numeric range control", control, ["bind"]),
  component("number-input", "Bound numeric entry", control, ["bind"]),
  component("select", "Bound single-choice control", { ...control, options: list(option, 1, 100) }, ["bind", "options"]),
  component("toggle", "Bound boolean control", control, ["bind"]),
  component("button", "Dispatch a bounded state action", { label: text, action, tone: choice("neutral", "info") }, ["label", "action"]),
  component("stepper", "Discrete steps with optional playback", {
    ...control, labels: list(label, 1, 200), autoplay: boolean,
    intervalMs: { type: "integer", minimum: 200, maximum: 60_000 },
  }, ["bind", "labels"]),
  component("quiz", "Single-choice or true/false question", {
    question: text, options: list(quizOption, 2, 12), explanation: text,
  }, ["question", "options"]),
] as const;
