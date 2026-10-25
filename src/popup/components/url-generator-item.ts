import type { FillEntry } from "../../content/parser.ts";
import type { CurrentPage } from "../current-page.ts";
import { createTargetCandidates } from "./target-candidates.ts";
import { createTargetCheck } from "./target-check.ts";
import { createValueInput } from "./value-input.ts";

/** 項目単位でCSSセレクタと入力内容を保持する． */
export function createGeneratorItem(
  template: HTMLTemplateElement,
  id: number,
  onChange: () => void,
  onRemove: () => void,
  initial?: FillEntry,
  onCheckChange: () => void = onChange,
) {
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const element = fragment.querySelector<HTMLFieldSetElement>("fieldset");
  const legend = fragment.querySelector("legend");
  const target = fragment.querySelector<HTMLInputElement>("[data-target]");
  const targetStatus = fragment.querySelector<HTMLElement>("[data-target-status]");
  const candidates = fragment.querySelector<HTMLElement>("[data-target-candidates]");
  const value = fragment.querySelector<HTMLTextAreaElement>("[data-value]");
  const valueSelect = fragment.querySelector<HTMLSelectElement>("[data-value-select]");
  const radioOutput = fragment.querySelector<HTMLOutputElement>("[data-radio-output]");
  const valueLabel = fragment.querySelector<HTMLLabelElement>("[data-value-label]");
  const remove = fragment.querySelector<HTMLButtonElement>("[data-remove]");
  if (
    !element ||
    !legend ||
    !target ||
    !targetStatus ||
    !candidates ||
    !value ||
    !valueSelect ||
    !radioOutput ||
    !valueLabel ||
    !remove
  ) {
    throw new Error("URL生成項目のテンプレートが不正です．");
  }

  for (const [name, control] of [
    ["target", target],
    ["value", value],
  ] as const) {
    control.id = `generator-${name}-${id}`;
    const label = fragment.querySelector<HTMLLabelElement>(`[data-${name}-label]`);
    if (label) label.htmlFor = control.id;
  }
  targetStatus.id = `generator-target-status-${id}`;
  target.setAttribute("aria-describedby", `${targetStatus.id} generator-error`);
  valueSelect.id = `generator-value-select-${id}`;
  radioOutput.id = `generator-radio-output-${id}`;
  valueSelect.setAttribute("aria-describedby", "generator-error");
  let radioError = "";
  const valueInput = createValueInput(value, valueSelect, radioOutput, valueLabel, onChange, () =>
    targetCheck.refresh(),
  );
  const validationState = () =>
    JSON.stringify([value.value, radioError, valueInput.validate(), valueInput.selectedGroup()]);
  const targetCheck = createTargetCheck(targetStatus, (response) => {
    const before = validationState();
    radioError =
      response?.status === "invalid-radio-group"
        ? "同じグループのラジオだけを指定し，valueの重複を避けてください．"
        : "";
    valueInput.setInfo(response?.radio ?? response?.valueInput);
    if (before !== validationState()) onCheckChange();
  });
  const targetCandidates = createTargetCandidates(target, candidates);
  target.value = initial?.selector ?? "";
  value.value = initial?.value ?? "";
  target.addEventListener("input", () => {
    valueInput.targetChanged();
    onChange();
  });
  remove.addEventListener("click", onRemove);

  return {
    element,
    target,
    remove,
    setNumber(number: number): void {
      legend.textContent = `項目${number}`;
      remove.setAttribute("aria-label", `項目${number}を削除`);
    },
    readEntry(): FillEntry {
      return { selector: target.value, value: value.value };
    },
    selectedRadioGroup: valueInput.selectedGroup,
    checkTarget(pageUrl: string, page: CurrentPage | null | undefined): void {
      targetCandidates.update(pageUrl, page);
      targetCheck.update(target.value.trim() ? target.value : null, pageUrl, page);
    },
    dispose(): void {
      valueInput.dispose();
      targetCheck.dispose();
      targetCandidates.dispose();
    },
    validate(showErrors: boolean): string {
      let message = "";
      if (!target.value.trim()) {
        message = "CSSセレクタを入力してください．";
      } else {
        try {
          element.ownerDocument.createDocumentFragment().querySelector(target.value);
        } catch {
          message = "CSSセレクタの構文を確認してください．";
        }
      }
      target.setCustomValidity(message);
      if (showErrors && message) target.setAttribute("aria-invalid", "true");
      else target.removeAttribute("aria-invalid");
      return message || radioError || valueInput.validate();
    },
  };
}
