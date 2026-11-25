import assert from "node:assert/strict";
import { test } from "node:test";
import { protocol } from "./fixtures/runtime.mjs";

const invalid = (yaml, code, path) => {
  const result = protocol.read({ yaml, sourceId: "checks.md" });
  assert.equal(result.ok, false);
  const issue = result.diagnostics.find(item => item.code === code);
  assert.deepEqual(issue?.path, path, JSON.stringify(result.diagnostics));
  assert.equal(issue.sourceId, "checks.md");
  assert.ok(issue.range.start.line > 0);
};

const block = (state, layout) => ["version: 1", "type: interactive", "state:", "  " + state,
  "layout:", ...layout.map(line => "  " + line)].join("\n");
const number = "count: { type: number, default: 0, min: 0, max: 2, step: 1 }";

test("the injected reader validates writable names, ranges, defaults and literal actions", () => {
  invalid(block(number, ["type: toggle", "bind: count"]), "semantic.control-bind", ["layout", "bind"]);
  invalid(block(number, ["type: slider", "bind: other"]), "semantic.control-bind", ["layout", "bind"]);
  invalid(block("count: { type: number, default: 0 }", ["type: slider", "bind: count"]),
    "semantic.slider-range", ["layout", "bind"]);
  invalid(block(number, ["type: stepper", "bind: count", "labels: [One, Two]"]),
    "semantic.stepper-range", ["layout", "bind"]);
  invalid(block(number, ["type: button", "label: Reset", "action: { type: set, bind: count, value: '1' }"]),
    "semantic.action", ["layout", "action", "value"]);
  invalid(block(number, ["type: button", "label: Increment", "action: { type: increment, bind: count, by: 0.5 }"]),
    "semantic.action", ["layout", "action", "by"]);
  invalid(block(number.replace("default: 0", "default: 0.5"), ["type: number-input", "bind: count"]),
    "semantic.state-definition", ["state", "count", "default"]);
  invalid(block(number, ["type: select", "bind: count", "options: [{label: No, value: '0'}]"]),
    "semantic.option-value", ["layout", "options", 0, "value"]);
  invalid(block(number, ["type: select", "bind: count", "options: [{label: No, value: 1}]"]),
    "semantic.select-default", ["layout", "options"]);
  invalid(block(number, ["type: select", "bind: count", "options: [{label: One, value: 0}, {label: Two, value: 0}]"]),
    "semantic.option-value", ["layout", "options", 1, "value"]);
  invalid(block(number, ["type: quiz", "question: Yes?", "options: [{label: Yes, correct: true}, {label: No, correct: true}]"]),
    "semantic.quiz-correct-count", ["layout", "options"]);
});

test("protocol and runtime agree on literal, escaped, quoted and lexical bindings", () => {
  const accepts = block(number, [
    "type: number-input", "bind: count", "label: '\\{{literal}} {{count}} {{\"quoted }}\"}}'",
  ]);
  assert.equal(protocol.read({ yaml: accepts }).ok, true);
  invalid(block(number, ["type: number-input", "bind: count", "label: '{{other}}'"]),
    "semantic.unknown-identifier", ["layout", "label"]);
  invalid(block(number, ["type: number-input", "bind: count", "label: '{{count'"]),
    "expression.unclosed-binding", ["layout", "label"]);
  invalid(block(number, ["type: interactive", "title: '{{count}}'", "when: count == 0", "layout: {type: divider}"]),
    "semantic.unknown-identifier", ["layout", "title"]);
  invalid(block(number, ["type: stack", "repeat: {items: count, as: item}", "children: [{type: divider}]"]),
    "semantic.unknown-identifier", ["layout", "repeat", "items"]);
});
