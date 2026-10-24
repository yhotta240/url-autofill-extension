export type FillResult =
  | "filled"
  | "waiting"
  | "unsupported"
  | "disabled"
  | "readonly"
  | "invalid-value";

const TEXT_INPUT_TYPES = new Set(["text", "email", "number", "search", "date"]);

/** 入力値を読まずに，自動入力の対象にできるか判定する． */
export function getFillBlockReason(
  element: Element,
): "unsupported" | "disabled" | "readonly" | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return "unsupported";

  const isInput = element instanceof view.HTMLInputElement;
  const isTextarea = element instanceof view.HTMLTextAreaElement;
  const isSelect = element instanceof view.HTMLSelectElement;
  if (!isInput && !isTextarea && !isSelect) return "unsupported";

  const autocomplete = (element.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  if (
    autocomplete.some(
      (token) => token.includes("password") || token === "one-time-code" || token.startsWith("cc-"),
    )
  ) {
    return "unsupported";
  }
  if (element.matches(":disabled")) return "disabled";
  if ((isInput || isTextarea) && element.readOnly) return "readonly";
  if (
    isInput &&
    !TEXT_INPUT_TYPES.has(element.type) &&
    !["checkbox", "radio"].includes(element.type)
  ) {
    return "unsupported";
  }
  return null;
}

/** ネイティブsetterを使い，ページ側の独自setterやクリック処理を実行しない． */
export function fillElement(element: Element, value: string): FillResult {
  const blocked = getFillBlockReason(element);
  if (blocked) return blocked;
  const view = element.ownerDocument.defaultView;
  if (!view) return "unsupported";
  const isInput = element instanceof view.HTMLInputElement;
  const isTextarea = element instanceof view.HTMLTextAreaElement;

  let property = "value";
  let nextValue: string | boolean = value;
  let prototype: object;

  if (isInput) {
    prototype = view.HTMLInputElement.prototype;
    if (element.type === "checkbox") {
      if (!["true", "false", "1", "0", ""].includes(value)) return "invalid-value";
      property = "checked";
      nextValue = value === "true" || value === "1";
    } else if (element.type === "radio") {
      if (value !== "" && value !== element.value) return "invalid-value";
      property = "checked";
      nextValue = value !== "";
    } else if (element.type === "number" || element.type === "date") {
      const probe = element.cloneNode(false) as HTMLInputElement;
      probe.value = value;
      if (probe.value !== value) return "invalid-value";
    }
  } else if (isTextarea) {
    prototype = view.HTMLTextAreaElement.prototype;
  } else if (element instanceof view.HTMLSelectElement) {
    prototype = view.HTMLSelectElement.prototype;
    const option = Array.from(element.options).find((item) => item.value === value);
    if (value !== "" && !option) return "waiting";
    if (option && (option.disabled || option.closest("optgroup[disabled]"))) return "disabled";
  } else {
    return "unsupported";
  }

  const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;
  if (!setter) return "unsupported";
  setter.call(element, nextValue);
  element.dispatchEvent(new view.Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new view.Event("change", { bubbles: true }));
  return "filled";
}
