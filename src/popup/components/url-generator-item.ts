import type { FillEntry, FillTarget } from "../../content/parser.ts";
import { type CurrentPage, createTargetCheck } from "./target-check.ts";

/** 項目単位で指定方法と入力内容を保持する． */
export function createGeneratorItem(
  template: HTMLTemplateElement,
  id: number,
  onChange: () => void,
  onRemove: () => void,
  example = false,
) {
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const element = fragment.querySelector<HTMLFieldSetElement>("fieldset");
  const legend = fragment.querySelector("legend");
  const method = fragment.querySelector<HTMLSelectElement>("[data-method]");
  const target = fragment.querySelector<HTMLInputElement>("[data-target]");
  const targetText = fragment.querySelector<HTMLElement>("[data-target-text]");
  const targetStatus = fragment.querySelector<HTMLElement>("[data-target-status]");
  const value = fragment.querySelector<HTMLTextAreaElement>("[data-value]");
  const remove = fragment.querySelector<HTMLButtonElement>("[data-remove]");
  if (
    !element ||
    !legend ||
    !method ||
    !target ||
    !targetText ||
    !targetStatus ||
    !value ||
    !remove
  ) {
    throw new Error("URL生成項目のテンプレートが不正です．");
  }

  for (const [name, control] of [
    ["method", method],
    ["target", target],
    ["value", value],
  ] as const) {
    control.id = `generator-${name}-${id}`;
    const label = fragment.querySelector<HTMLLabelElement>(`[data-${name}-label]`);
    if (label) label.htmlFor = control.id;
  }
  targetStatus.id = `generator-target-status-${id}`;
  target.setAttribute("aria-describedby", `${targetStatus.id} generator-error`);
  const targetCheck = createTargetCheck(targetStatus);
  let mode: FillTarget["kind"] = "field";
  const targets = { field: example ? "email" : "", selector: example ? "#email" : "" };
  target.value = targets.field;
  value.value = example ? "test@example.com" : "";

  target.addEventListener("input", () => {
    targets[mode] = target.value;
    onChange();
  });
  value.addEventListener("input", onChange);
  method.addEventListener("change", () => {
    mode = method.value === "selector" ? "selector" : "field";
    target.value = targets[mode];
    targetText.textContent = mode === "selector" ? "CSSセレクタ" : "フィールド名";
    target.placeholder = mode === "selector" ? "#email" : "email";
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
      return { target: { kind: mode, value: target.value }, value: value.value };
    },
    checkTarget(pageUrl: string, page: CurrentPage | null | undefined): void {
      targetCheck.update(
        target.validity.valid ? { kind: mode, value: target.value } : null,
        pageUrl,
        page,
      );
    },
    dispose: targetCheck.dispose,
    validate(showErrors: boolean): string {
      let message = "";
      if (!target.value.trim()) {
        message = "フィールド名またはCSSセレクタを入力してください．";
      } else if (mode === "selector") {
        try {
          element.ownerDocument.createDocumentFragment().querySelector(target.value);
        } catch {
          message = "CSSセレクタの構文を確認してください．";
        }
      }
      target.setCustomValidity(message);
      if (showErrors && message) target.setAttribute("aria-invalid", "true");
      else target.removeAttribute("aria-invalid");
      return message;
    },
  };
}
