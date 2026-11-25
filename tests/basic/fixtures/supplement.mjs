import gallery from "../../../examples/gallery/basic-supplement.md";
import { createBrowserHost } from "../../../src/adapters/browser/index.ts";
import { createActiveRenderer } from "../../../src/composition/runtime.ts";
import { markdownBlockScanner } from "../../../src/core/protocol/index.ts";

const renderer = createActiveRenderer(createBrowserHost());
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => { await frame(); await frame(); await frame(); };

function equal(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function mount(value) {
  const root = document.body.appendChild(document.createElement("div"));
  const yaml = typeof value === "string" ? value : JSON.stringify({ version: 1, ...value });
  const handle = renderer.mountBlock({ container: root, source: { yaml } });
  equal(handle.diagnostics(), []);
  return { root, handle };
}

async function run() {
  const [data, formula, disclosure] = markdownBlockScanner.scan(gallery).value;
  const first = mount(data.yaml);
  const { root } = first;
  root.style.inlineSize = "328px";
  const table = root.querySelector("table");
  const cell = table.tBodies[0].rows[0].cells[1];
  const progress = root.querySelector("progress");
  equal([table.caption.textContent, cell.textContent, cell.dataset.align, progress.value, progress.max],
    ["首批记录", "2", "end", 2, 4]);
  root.querySelector(".kui-stepper button:nth-child(2)").click();
  await settle();
  equal([table.caption.textContent, cell.textContent, progress.value, progress.max], ["次批记录", "6", 6, 8]);
  equal(table.tBodies[0].rows[0].cells[1] === cell && root.querySelector("progress") === progress, true);
  const surface = table.parentElement;
  equal(surface.scrollWidth > surface.clientWidth && surface.clientWidth <= root.clientWidth, true);
  equal(first.handle.diagnostics(), []);

  const retry = mount({
    type: "interactive",
    state: { step: { type: "number", default: 0, min: 0, max: 2, step: 1 } },
    data: { batches: [
      { rows: [[1]], value: 1, max: 2 },
      { rows: [[3, 4]], value: 3, max: 2 },
      { rows: [[2], [3]], value: 2, max: 2 },
    ] },
    layout: { type: "stack", children: [
      { type: "stepper", bind: "step", labels: ["Start", "Invalid", "Recover"] },
      { type: "table", columns: [{ label: "N" }], rows: "{{batches[step].rows}}" },
      { type: "progress", value: "{{batches[step].value}}", max: "{{batches[step].max}}" },
    ] },
  });
  const retryNext = retry.root.querySelector(".kui-stepper button:nth-child(2)");
  const retryCell = retry.root.querySelector("td");
  retryNext.click();
  await settle();
  equal([retryCell.textContent, retry.root.querySelector("progress").value], ["1", 1]);
  equal(retry.handle.diagnostics().map(item => item.code).sort(), ["expression.binding-type", "render.progress-range"]);
  retryNext.click();
  await settle();
  equal([retryCell.textContent, retry.root.querySelectorAll("td").length, retry.root.querySelector("progress").value], ["2", 2, 2]);

  const second = mount(formula.yaml);
  await settle();
  equal(second.root.querySelectorAll(".kui-markdown-latex").length, 3);
  equal(second.root.querySelector(".kui-formula-equation code").textContent, "p = \\frac{n}{N}");
  equal(second.root.querySelectorAll("dl dt").length, 3);
  const invalidFormula = mount({ type: "formula", latex: "x\n$$\n[unexpected](https://example.invalid)" });
  equal(invalidFormula.root.querySelectorAll("a").length, 0);
  equal(invalidFormula.root.querySelector(".kui-markdown-fallback").textContent,
    "x\n$$\n[unexpected](https://example.invalid)");

  const third = mount(disclosure.yaml);
  const [overview, checklist] = third.root.querySelectorAll("[role=tab]");
  equal([overview.getAttribute("aria-selected"), checklist.getAttribute("aria-selected")], ["true", "false"]);
  equal(third.root.querySelector("details"), null);
  overview.focus();
  overview.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  equal(document.activeElement === checklist, true);
  equal(overview.getAttribute("aria-selected"), "true");
  checklist.click();
  const details = third.root.querySelector("details");
  equal(details.closest("[role=tabpanel]").id, checklist.getAttribute("aria-controls"));
  equal(details.querySelector(".kui-markdown"), null);
  details.querySelector("summary").click();
  await settle();
  equal(details.querySelectorAll(".kui-markdown ol li").length, 2);
  overview.click();
  equal(details.closest("[role=tabpanel]").hidden, true);
  checklist.click();
  equal(third.root.querySelector("details") === details && details.open, true);

  for (const current of [first, second, third, invalidFormula, retry]) {
    current.handle.dispose();
    equal(current.root.childElementCount, 0);
  }
}

void run().then(
  () => { globalThis.supplementResult = { passed: true }; },
  error => { globalThis.supplementResult = { error: error.stack }; },
);
