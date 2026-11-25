import type { JsonObject } from "#contracts";
import { watchMarkdown } from "./markdown.ts";
import { append, own, rootElement, textField, watchText } from "./mount.ts";
import type { BasicMount } from "./mount.ts";

function displayMath(latex: string): string | undefined {
  // A raw dollar sign can end the math block and turn the rest into Markdown.
  return latex.trim() && !latex.includes("$") ? "$$\n" + latex + "\n$$" : undefined;
}

export function formula(mount: BasicMount): HTMLElement {
  const root = rootElement(mount, "figure");
  const { props } = mount.node;
  const equation = append(root, "div", "kui-formula-equation");
  watchMarkdown(mount, equation, own(props, "latex"), ["latex"], displayMath);

  const variables = own(props, "variables") as readonly JsonObject[] | undefined;
  if (variables?.length) {
    const definitions = append(root, "dl", "kui-formula-variables");
    for (const [index, variable] of variables.entries()) {
      const entry = append(definitions, "div", "kui-formula-variable");
      const symbol = append(append(entry, "dt"), "code", "kui-formula-symbol");
      const meaning = append(entry, "dd", "kui-formula-meaning");
      const description = append(meaning, "span");
      const path = ["variables", index];
      watchText(mount, own(variable, "symbol"), [...path, "symbol"], value => { symbol.textContent = value; });
      watchText(mount, own(variable, "meaning"), [...path, "meaning"], value => { description.textContent = value; });
      const rawUnit = own(variable, "unit");
      if (rawUnit !== undefined) {
        const unit = append(meaning, "span", "kui-formula-unit");
        watchText(mount, rawUnit, [...path, "unit"], value => { unit.textContent = value ? " (" + value + ")" : ""; });
      }
    }
  }
  textField(mount, root, "p", "kui-formula-conditions", "conditions");

  const steps = own(props, "steps") as readonly JsonObject[] | undefined;
  if (steps?.length) {
    const derivation = append(root, "ol", "kui-formula-steps");
    for (const [index, step] of steps.entries()) {
      const entry = append(derivation, "li");
      const equation = append(entry, "div", "kui-formula-equation");
      watchMarkdown(mount, equation, own(step, "latex"), ["steps", index, "latex"], displayMath);
      const explanation = own(step, "explanation");
      if (explanation !== undefined) {
        const prose = append(entry, "p", "kui-formula-explanation");
        watchText(mount, explanation, ["steps", index, "explanation"], value => { prose.textContent = value; });
      }
    }
  }
  return root;
}
