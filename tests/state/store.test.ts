import assert from "node:assert/strict";
import { test } from "node:test";
import type { InteractiveModel, JsonObject, Result, StateAction, StateChange } from "#contracts";
import { bindingFactory, expressionEngine } from "../../src/core/expression/index.ts";
import { stateFactory } from "../../src/core/state/index.ts";

const source = { path: ["layout"] };
const model: InteractiveModel = {
  state: {
    amount: { type: "number", min: 0, max: 4, step: 0.5, default: 1 },
    enabled: { type: "boolean", default: false },
    mode: { type: "string", default: "A" },
  },
  data: { rows: [{ label: "Ready" }] },
  computed: {
    summary: "pair + adjustment",
    pair: "amount * 2",
    adjustment: "enabled ? initial : 0",
    stable: "amount > 0",
    row: "rows[0]",
  },
};

function value<T>(result: Result<T>): T {
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.value;
}
const create = (input = model, locals: JsonObject = { initial: 5 }) => stateFactory.create(input, expressionEngine, source, locals);

test("forward dependencies, read-only data and template locals initialize per instance", () => {
  const first = value(create());
  const second = value(create());
  const original = first.snapshot();
  const derived = first.get("row");
  assert.equal(first.get("summary"), 2);
  assert.equal(first.get("initial"), 5);
  assert.equal(Object.isFrozen(first.get("rows")), true);
  assert.equal(Object.isFrozen(derived), true);
  assert.equal(Object.isFrozen(first.definitions.amount), true);
  assert.equal(first.set("initial", 3).ok, false);
  assert.equal(first.set("pair", 3).ok, false);
  value(first.dispatch({ type: "toggle", bind: "enabled" }));
  assert.equal(first.get("summary"), 7);
  assert.equal(second.get("summary"), 2);
  assert.equal(original.summary, 2);
  assert.equal(first.get("row"), derived);
  assert.equal(Object.isFrozen(first.snapshot()), true);
});

test("cycle, missing dependency, name collision, invalid defaults and read-only data errors carry paths", () => {
  const cases: [InteractiveModel, string, readonly string[]][] = [
    [{ ...model, computed: { a: "b", b: "a" } }, "state.computed-cycle", ["computed", "a"]],
    [{ ...model, computed: { a: "false ? missing : 0" } }, "state.unknown-identifier", ["computed", "a"]],
    [{ ...model, data: { initial: 1 } }, "state.name-conflict", ["data", "initial"]],
    [{ ...model, state: { amount: { type: "number", default: 1.25, min: 0, step: 0.5 } } }, "state.definition", ["state", "amount", "default"]],
    [{ ...model, state: { amount: { type: "number", default: 0, min: 2, max: 1 } } }, "state.definition", ["state", "amount", "max"]],
    [{ ...model, computed: {}, data: Object.defineProperty({}, "a", { enumerable: true, get() { throw Error("getter"); } }) }, "state.invalid-data", ["data", "a"]],
  ];
  for (const [input, code, path] of cases) {
    const result = create(input);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0]?.code, code);
    assert.deepEqual(result.diagnostics[0]?.path, ["layout", ...path]);
  }
});

test("invalid actions and failed computed writes publish no change", () => {
  const store = value(create({ ...model, computed: { quotient: "1 / amount" } }));
  const original = store.snapshot();
  const changes: StateChange[] = [];
  store.subscribe(new Set(["amount", "quotient"]), change => changes.push(change));
  for (const candidate of [0, Number.EPSILON, -0.5, 1.01, Infinity, 5, "2"]) assert.equal(store.set("amount", candidate).ok, false);
  const actions: unknown[] = [
    { type: "toggle", bind: "amount" },
    { type: "increment", bind: "enabled", by: 1 },
    { type: "increment", bind: "amount", by: 0.25 },
    { type: "increment", bind: "amount", by: 4 },
    { type: "reset", bind: "rows" },
    { type: "run", bind: "amount" },
    { type: "set", bind: "amount", by: 2 },
    { type: "reset", bind: "amount", extraneous: true },
  ];
  for (const action of actions) assert.equal(store.dispatch(action as StateAction).ok, false);
  assert.equal(store.snapshot(), original);
  assert.deepEqual(changes, []);
});

test("subscriptions see only changed names, with one stable snapshot per transaction", () => {
  const store = value(create());
  const values: StateChange[] = [];
  let unrelated = 0;
  const subscription = store.subscribe(new Set(["pair", "amount", "summary"]), change => values.push(change));
  store.subscribe(new Set(["stable", "mode"]), () => ++unrelated);
  value(store.set("amount", 1));
  value(store.dispatch({ type: "increment", bind: "amount", by: 0.5 }));
  assert.equal(values.length, 1);
  assert.equal(unrelated, 0);
  assert.deepEqual([...values[0]!.changed], ["amount", "pair", "summary"]);
  assert.equal(values[0]!.values.summary, 3);
  subscription.dispose();
  subscription.dispose();
  value(store.dispatch({ type: "reset", bind: "amount" }));
  assert.equal(values[0]!.values.summary, 3);
  assert.equal(values.length, 1);
  store.dispose();
  store.dispose();
  assert.equal(store.set("amount", 2).diagnostics[0]?.code, "state.disposed");
});

test("reentrant updates preserve snapshot publication order for later subscribers", () => {
  const store = value(create());
  const seen: unknown[] = [];
  store.subscribe(new Set(["amount"]), change => {
    if (change.values.amount === 1.5) value(store.set("amount", 2));
    (change.changed as Set<string>).clear();
  });
  store.subscribe(new Set(["amount"]), change => seen.push([change.values.amount, change.changed.has("amount")]));
  value(store.set("amount", 1.5));
  assert.deepEqual(seen, [[1.5, true], [2, true]]);
});

test("decimal steps increment to reachable bounds without drift", () => {
  const store = value(create({ state: { x: { type: "number", min: 0, max: 0.3, step: 0.1, default: 0.1 } },
    computed: {}, data: {} }));
  value(store.dispatch({ type: "increment", bind: "x", by: 0.2 }));
  assert.equal(store.get("x"), 0.3);
  assert.equal(store.dispatch({ type: "increment", bind: "x", by: 0.1 }).ok, false);
  value(store.dispatch({ type: "increment", bind: "x", by: -0.2 }));
  assert.equal(store.get("x"), 0.1);
  value(store.dispatch({ type: "increment", bind: "x", by: -0.1 }));
  assert.equal(store.get("x"), 0);
  assert.equal(store.set("x", 0.1001).ok, false);
});

test("binding observers deliver initial typed values and only their dependencies", () => {
  const store = value(create());
  const bindings = bindingFactory.create(store).withLocals({ index: 4 });
  const seen: number[] = [];
  const observer = bindings.observe({
    value: "{{summary + index}}", source, expected: "a number",
    accepts: (entry): entry is number => typeof entry === "number",
  }, result => seen.push(value(result)));
  value(store.set("mode", "B"));
  value(store.set("amount", 2));
  observer.dispose();
  value(store.set("amount", 3));
  assert.deepEqual(seen, [6, 8]);
});
