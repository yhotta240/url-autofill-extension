import { getFillBlockReason } from "./autofill.ts";
import { isEditableElement } from "./editable.ts";
import { isRadio, type Resolution } from "./resolver.ts";

/** 空欄から取得要求があるときだけ呼び，自動入力で再現できる現在値を返す． */
export function readTargetValue(result: Resolution): string | undefined {
  if (result.status !== "found") return;
  const element =
    result.kind === "radio-group" ? result.elements.find((radio) => radio.checked) : result.element;
  if (!element || getFillBlockReason(element)) return;
  const view = element.ownerDocument.defaultView;
  if (!view) return;
  if (isEditableElement(element)) return element.innerText;
  if (isRadio(element)) {
    if (result.kind === "radio-group") return element.value;
    if (!element.checked) return "";
    return element.value || undefined;
  }
  if (element instanceof view.HTMLInputElement) {
    return element.type === "checkbox" ? String(element.checked) : element.value;
  }
  if (element instanceof view.HTMLTextAreaElement) return element.value;
  if (element instanceof view.HTMLSelectElement) {
    const value = element.value;
    const option = Array.from(element.options).find((item) => item.value === value);
    const selectedCount = element.selectedOptions.length;
    if (
      (element.multiple && selectedCount > 1) ||
      (selectedCount === 0 && option !== undefined) ||
      (option && (option.disabled || option.closest("optgroup[disabled]")))
    )
      return;
    return value;
  }
}
