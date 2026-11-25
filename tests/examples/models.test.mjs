import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createActiveProtocol } from "../../src/composition/protocol.ts";
import { expressionEngine } from "../../src/core/expression/index.ts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { stateFactory } from "../../src/core/state/index.ts";

const readNote = file => readFile(new URL("../../examples/notes/" + file + ".md", import.meta.url), "utf8");
const protocol = createActiveProtocol();

async function interactiveBlock(file, index = 0) {
  const scanned = markdownBlockScanner.scan(await readNote(file));
  assert.equal(scanned.ok, true);
  const result = protocol.read(scanned.value[index]);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.value.root.model);
  return result.value.root;
}

function createState(node) {
  const state = stateFactory.create(node.model, expressionEngine, node.source);
  assert.equal(state.ok, true, JSON.stringify(state.diagnostics));
  return state.value;
}

function evaluate(expression, scope) {
  assert.ok(expression);
  const result = expressionEngine.evaluate(expression, scope);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.value;
}

function update(state, values) {
  for (const [name, value] of Object.entries(values)) {
    const result = state.set(name, value);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  }
}

async function vectors(file, rowPattern) {
  const source = await readNote(file);
  return Array.from(source.matchAll(rowPattern), match => match.slice(1));
}

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `expected ${actual} ≈ ${expected} within ${tolerance}`);
}

function drainCurrent(vgs, vds, threshold, beta = 1, lambda = 0.05) {
  const overdrive = Math.max(0, vgs - threshold);
  const channelDrop = Math.min(vds, overdrive);
  return beta * (overdrive * channelDrop - channelDrop ** 2 / 2) * (1 + lambda * vds);
}

test("MOSFET vectors use V, mA and continuous operating region boundaries", async () => {
  const rows = await vectors("mosfet", /^- (\d+\.\d+) \/ (\d+\.\d+) \/ (\d+\.\d+) · (截止|线性区|饱和区) · ([\d.]+) mA$/gm);
  assert.equal(rows.length, 6);
  const node = await interactiveBlock("mosfet");
  const state = createState(node);
  const chart = node.slots["/layout"][0].slots["/children"].find(child => child.type === "chart");
  const curve = chart.expressions["/series/0/expr"];
  for (const [gate, drain, threshold, region, current] of rows) {
    const vgs = Number(gate);
    const vds = Number(drain);
    const vth = Number(threshold);
    const modelRegion = vgs <= vth ? "截止" : vds < vgs - vth ? "线性区" : "饱和区";
    assert.equal(region, modelRegion);
    close(drainCurrent(vgs, vds, vth), Number(current));
    update(state, { gate: vgs, drain: vds, threshold: vth });
    assert.equal(state.get("regime"), region);
    close(state.get("current"), Number(current));
    close(evaluate(curve, { ...state.snapshot(), x: vds }), Number(current));
  }

  update(state, { gate: 4, drain: 10, threshold: 0.5 });
  close(state.get("current"), drainCurrent(4, 10, 0.5));
  assert.ok(state.get("current") < 10);
  state.dispose();

  const epsilon = 1e-5;
  const boundary = drainCurrent(3, 2, 1);
  const slopeBelow = (boundary - drainCurrent(3, 2 - epsilon, 1)) / epsilon;
  const slopeAbove = (drainCurrent(3, 2 + epsilon, 1) - boundary) / epsilon;
  close(slopeBelow, slopeAbove, 1e-5);
  close(drainCurrent(1 + epsilon, 4, 1), drainCurrent(1, 4, 1), 1e-9);
  close(drainCurrent(3, 2, 1, 1, 0), drainCurrent(3, 4, 1, 1, 0));
});

test("MOSFET load-line example and incremental gain agree with the device model", () => {
  const epsilon = 1e-5;
  const current = drainCurrent(3, 4, 1);
  const gm = (drainCurrent(3 + epsilon, 4, 1) - drainCurrent(3 - epsilon, 4, 1)) / (2 * epsilon);
  const gds = (drainCurrent(3, 4 + epsilon, 1) - drainCurrent(3, 4 - epsilon, 1)) / (2 * epsilon);
  close(10 - 2.5 * current, 4);
  close(gm, 2.4);
  close(1 / gds, 10);
  close(-gm / (1 / 2.5 + gds), -4.8);
});

test("TCP handshake vectors account for the sequence number consumed by each SYN", async () => {
  const rows = await vectors("tcp-handshake-congestion",
    /^\d+\. \*\*[^*]+\*\* · \x60(SYN|SYN \+ ACK|ACK)\x60 · \x60seq (\d+)\x60(?: · \x60ack (\d+)\x60)?。/gm);
  const clientISN = 1000;
  const serverISN = 7000;
  assert.deepEqual(rows, [
    ["SYN", String(clientISN), undefined],
    ["SYN + ACK", String(serverISN), String(clientISN + 1)],
    ["ACK", String(clientISN + 1), String(serverISN + 1)],
  ]);
});

function lossThreshold(flightSize) {
  return Math.max(flightSize / 2, 2);
}

function renoTrace(detection) {
  let cwnd = 1;
  let ssthresh = 8;
  const points = [`${cwnd} / ${ssthresh}`];
  for (let index = 1; index <= 10; index++) {
    if (index === 6 && detection !== "none") {
      ssthresh = lossThreshold(10);
      cwnd = detection === "three-dup-acks" ? ssthresh + 3 : 1;
    } else if (index === 7 && detection === "three-dup-acks") {
      cwnd = ssthresh;
    } else if (cwnd < ssthresh) {
      cwnd = Math.min(ssthresh, 2 * cwnd);
    } else {
      cwnd++;
    }
    points.push(`${cwnd} / ${ssthresh}`);
  }
  return points;
}

test("Reno window and threshold vectors distinguish fast recovery, first RTO and no loss", async () => {
  const rows = await vectors("tcp-handshake-congestion",
    /^- 观测点 (\d+) · (\d+ \/ \d+) · (\d+ \/ \d+) · (\d+ \/ \d+)$/gm);
  const paths = ["none", "three-dup-acks", "rto"].map(renoTrace);
  assert.deepEqual(rows, paths[0].map((_, index) => [String(index), ...paths.map(path => path[index])]));
  const node = await interactiveBlock("tcp-handshake-congestion", 1);
  const state = createState(node);
  for (const [index, ...expected] of rows) {
    for (const [branch, scenario] of ["clear", "duplicate", "timeout"].entries()) {
      update(state, { point: Number(index), scenario });
      assert.equal(state.get("windowNow") + " / " + state.get("thresholdNow"), expected[branch]);
    }
  }
  state.dispose();
  assert.equal(lossThreshold(6), 3);
  assert.equal(lossThreshold(2), 2);
});

function reverse(head, onPause = () => {}) {
  let prev = null;
  let curr = head;
  onPause(prev, curr);
  while (curr !== null) {
    const next = curr.next;
    onPause(prev, curr, next);
    curr.next = prev;
    onPause(prev, curr, next);
    prev = curr;
    curr = next;
    onPause(prev, curr);
  }
  return prev;
}

test("list reversal trace preserves node identities and exposes the saved successor", async () => {
  const c = { id: "C", next: null };
  const b = { id: "B", next: c };
  const a = { id: "A", next: b };
  const rows = await vectors("linked-list-reversal",
    /^- [^·]+ · ([ABC∅]) \/ ([ABC∅]) \/ ([ABC∅—]) · ([ABC∅]) \/ ([ABC∅]) \/ ([ABC∅])$/gm);
  const trace = [];
  const id = node => node?.id ?? "∅";
  const head = reverse(a, (prev, curr, next) => {
    trace.push([id(prev), id(curr), next === undefined ? "—" : id(next), id(a.next), id(b.next), id(c.next)]);
  });
  assert.deepEqual(rows, trace);
  const node = await interactiveBlock("linked-list-reversal");
  const display = value => value === "nil" ? "∅" : value === "hidden" ? "—" : value;
  const declaredFrames = node.model.data.frames.map(frame =>
    [frame.prev, frame.curr, frame.next, frame.a, frame.b, frame.c].map(display));
  assert.deepEqual(declaredFrames, trace);
  assert.equal(head, c);
  assert.equal(c.next, b);
  assert.equal(b.next, a);
  assert.equal(a.next, null);
  assert.equal(reverse(a), a);
  assert.equal(reverse(null), null);
});

function traverse(node, orders) {
  if (node === undefined) return;
  orders.pre.push(node.id);
  traverse(node.left, orders);
  orders.in.push(node.id);
  traverse(node.right, orders);
  orders.post.push(node.id);
}

test("tree example distinguishes recursive pre-order, in-order and post-order visits", async () => {
  const tree = { id: "A", left: { id: "B", right: { id: "D" } }, right: { id: "C" } };
  const orders = { pre: [], in: [], post: [] };
  traverse(tree, orders);
  const rows = await vectors("linked-list-reversal", /^- \*\*(?:前序|中序|后序)\*\*。[^·]+ · ([A-D, ]+)$/gm);
  assert.deepEqual(rows.flat(), Object.values(orders).map(order => order.join(", ")));
});

function stepResponse(zeta, omega, seconds) {
  const tau = omega * seconds;
  if (zeta < 1) {
    const q = Math.sqrt(1 - zeta ** 2);
    return 1 - Math.exp(-zeta * tau) * (Math.cos(q * tau) + zeta / q * Math.sin(q * tau));
  }
  if (zeta === 1) return 1 - (1 + tau) * Math.exp(-tau);
  const q = Math.sqrt(zeta ** 2 - 1);
  const fast = zeta + q;
  const slow = 1 / fast;
  return 1 + (slow * Math.exp(-fast * tau) - fast * Math.exp(-slow * tau)) / (2 * q);
}

function magnitude(zeta, omega, frequency) {
  const ratio = frequency / omega;
  return 1 / Math.hypot(1 - ratio ** 2, 2 * zeta * ratio);
}

test("second-order response vectors span all damping regimes and the critical limit", async () => {
  const omega = 2;
  const rows = await vectors("second-order-system",
    /^- ζ = ([\d.]+) · ([\d.]+) · ([\d.]+)% · ([\d.]+|—) · (-?[\d.]+) dB$/gm);
  assert.equal(rows.length, 3);
  const displayTolerance = 0.00005;
  const node = await interactiveBlock("second-order-system", 1);
  const state = createState(node);
  const [time, frequency] = node.slots["/layout"][0].slots["/children"].filter(child => child.type === "chart");
  for (const [damping, atOneSecond, overshoot, peak, dbAtOmega] of rows) {
    const zeta = Number(damping);
    close(stepResponse(zeta, omega, 0), 0);
    close(stepResponse(zeta, omega, 1), Number(atOneSecond), displayTolerance);
    update(state, { zeta, omega });
    const scope = state.snapshot();
    close(evaluate(time.expressions["/series/0/expr"], { ...scope, x: 1 }), Number(atOneSecond), displayTolerance);
    close(evaluate(frequency.expressions["/series/0/expr"], { ...scope, x: omega }), Number(dbAtOmega), displayTolerance);
    close(state.get("overshoot"), Number(overshoot), displayTolerance);
    close(stepResponse(zeta, omega, 40), 1, 1e-8);
    close(20 * Math.log10(magnitude(zeta, omega, omega)), Number(dbAtOmega), displayTolerance);
    if (peak === "—") {
      assert.ok(zeta >= 1);
      assert.equal(overshoot, "0");
    } else {
      const peakTime = Math.PI / (omega * Math.sqrt(1 - zeta ** 2));
      close(peakTime, Number(peak), displayTolerance);
      close((stepResponse(zeta, omega, peakTime) - 1) * 100, Number(overshoot), displayTolerance);
    }
  }
  for (const [zeta, wn] of [[0.2, 0.5], [2, 5], [0.95, 2], [1.05, 2]]) {
    update(state, { zeta, omega: wn });
    const scope = state.snapshot();
    for (const seconds of [0, 0.1, 12]) {
      close(evaluate(time.expressions["/series/0/expr"], { ...scope, x: seconds }), stepResponse(zeta, wn, seconds));
    }
    for (const radPerSecond of [0.05, 50]) {
      close(evaluate(frequency.expressions["/series/0/expr"], { ...scope, x: radPerSecond }), 20 * Math.log10(magnitude(zeta, wn, radPerSecond)));
    }
  }
  state.dispose();
  for (const delta of [-1e-6, 1e-6]) {
    close(stepResponse(1 + delta, omega, 1), stepResponse(1, omega, 1), 1e-6);
  }
});

test("frequency resonance requires stricter damping than step overshoot", () => {
  const omega = 2;
  const zeta = 0.5;
  const resonantFrequency = omega * Math.sqrt(1 - 2 * zeta ** 2);
  const peak = magnitude(zeta, omega, resonantFrequency);
  close(peak, 2 / Math.sqrt(3));
  close(20 * Math.log10(peak), 1.2493873661);
  close(magnitude(zeta, omega * 2, resonantFrequency * 2), peak);
  close(stepResponse(zeta, omega * 2, 0.5), stepResponse(zeta, omega, 1));

  const damping = 0.8;
  const peakTime = Math.PI / (omega * Math.sqrt(1 - damping ** 2));
  assert.ok(stepResponse(damping, omega, peakTime) > 1);
  assert.equal(magnitude(damping, omega, 0), 1);
  assert.ok(magnitude(damping, omega, 1) < 1);
  assert.ok(magnitude(damping, omega, 2) < magnitude(damping, omega, 1));
});
