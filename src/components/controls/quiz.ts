import { append, listen, root, watchText } from "./dom.ts";
import type { Mount } from "./dom.ts";
import type { QuizOption } from "./types.ts";

export function quiz(mount: Mount): HTMLElement {
  const { props } = mount.node;
  const options = props.options as unknown as readonly QuizOption[];
  const wrapper = root(mount, "fieldset");
  const question = append(wrapper, "legend", "kui-quiz-question");
  watchText(mount, props.question!, ["question"], text => { question.textContent = text; });
  const answers = append(wrapper, "div", "kui-quiz-options");
  const feedback = append(wrapper, "div", "kui-quiz-feedback");
  feedback.setAttribute("role", "status");
  const outcome = append(feedback, "strong");
  const detail = append(feedback, "div");
  const explanation = append(feedback, "div");
  explanation.hidden = true;
  const details: string[] = [];
  if (props.explanation !== undefined) {
    watchText(mount, props.explanation, ["explanation"], text => { explanation.textContent = text; });
  }
  let selected: number | undefined;
  for (const [index, option] of options.entries()) {
    const label = append(answers, "label", "kui-quiz-option");
    const input = append(label, "input");
    input.type = "radio";
    input.name = mount.context.instanceId + "-quiz";
    const text = append(label, "span");
    watchText(mount, option.label, ["options", index, "label"], value => { text.textContent = value; });
    if (option.explanation !== undefined) {
      watchText(mount, option.explanation, ["options", index, "explanation"], value => {
        details[index] = value;
        if (selected === index) detail.textContent = value;
      });
    }
    listen(mount, input, "change", () => {
      if (!input.checked) return;
      selected = index;
      feedback.dataset.correct = String(option.correct);
      outcome.textContent = option.correct ? "Correct" : "Incorrect";
      detail.textContent = details[index] ?? "";
      explanation.hidden = props.explanation === undefined;
    });
  }
  return wrapper;
}
