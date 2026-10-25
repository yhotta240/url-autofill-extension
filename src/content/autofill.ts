import { getEditingHost, isEditableElement, setEditableText } from "./editable.ts";

export type FillResult =
  | "filled"
  | "waiting"
  | "unsupported"
  | "disabled"
  | "readonly"
  | "invalid-value";

const TEXT_INPUT_TYPES = new Set(["text", "email", "number", "search", "date"]);

function hasSensitiveAutocomplete(element: Element): boolean {
  const tokens = (element.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  return tokens.some(
    (token) => token.includes("password") || token === "one-time-code" || token.startsWith("cc-"),
  );
}

/** 入力値を読まずに，自動入力の対象にできるか判定する． */
export function getFillBlockReason(
  element: Element,
): "unsupported" | "disabled" | "readonly" | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return "unsupported";

  const isInput = element instanceof view.HTMLInputElement;
  const isTextarea = element instanceof view.HTMLTextAreaElement;
  const isSelect = element instanceof view.HTMLSelectElement;
  const isEditable = isEditableElement(element);
  if (!isInput && !isTextarea && !isSelect && !isEditable) return "unsupported";

  let host: Element = element;
  if (isEditable) host = getEditingHost(element);
  for (let field: Element | null = element; field; field = field.parentElement) {
    if (hasSensitiveAutocomplete(field)) return "unsupported";
    if (field === host) break;
  }
  if (element.matches(":disabled")) return "disabled";
  if (isEditable && element.closest('[aria-disabled="true"], [inert]')) return "disabled";
  if (isEditable && element.closest('[aria-readonly="true"]')) return "readonly";
  if (isEditable) {
    const protectedReason = protectedDescendantReason(element);
    if (protectedReason) return protectedReason;
  }
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

/** 親の内容取得や置換で，保護された子を巻き込まない． */
function protectedDescendantReason(element: HTMLElement): ReturnType<typeof getFillBlockReason> {
  const descendants = element.querySelectorAll(
    "input, textarea, select, [autocomplete], [contenteditable], [aria-readonly], [aria-disabled], [inert]",
  );
  for (const descendant of descendants) {
    if (hasSensitiveAutocomplete(descendant)) return "unsupported";
    if (descendant.matches("input, textarea, select")) {
      const reason = getFillBlockReason(descendant);
      if (reason) return reason;
    }
    if (
      descendant.getAttribute("aria-disabled")?.toLowerCase() === "true" ||
      descendant.hasAttribute("inert")
    ) {
      return "disabled";
    }
    if (
      descendant.getAttribute("contenteditable")?.toLowerCase() === "false" ||
      descendant.getAttribute("aria-readonly")?.toLowerCase() === "true"
    ) {
      return "readonly";
    }
  }
  return null;
}

/** ネイティブsetterを使い，ページ側の独自setterやクリック処理を実行しない． */
export function fillElement(element: Element, value: string): FillResult {
  const blocked = getFillBlockReason(element);
  if (blocked) return blocked;
  const view = element.ownerDocument.defaultView;
  if (!view) return "unsupported";
  if (isEditableElement(element)) {
    setEditableText(element, value);
    const host = getEditingHost(element);
    host.dispatchEvent(
      new view.InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: value,
      }),
    );
    host.dispatchEvent(new view.Event("change", { bubbles: true }));
    return "filled";
  }
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

  return setNativeValue(element, prototype, property, nextValue);
}

/** グループ内の空valueも「選択」として扱い，単体の空値による解除と区別する． */
export function fillRadioGroup(elements: HTMLInputElement[], value: string): FillResult {
  const radio = elements.find((element) => element.value === value);
  if (!radio) return "waiting";
  const blocked = getFillBlockReason(radio);
  if (blocked) return blocked;
  const view = radio.ownerDocument.defaultView;
  if (!view) return "unsupported";
  return setNativeValue(radio, view.HTMLInputElement.prototype, "checked", true);
}

function setNativeValue(
  element: Element,
  prototype: object,
  property: string,
  value: string | boolean,
): FillResult {
  const view = element.ownerDocument.defaultView;
  if (!view) return "unsupported";
  const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;
  if (!setter) return "unsupported";
  setter.call(element, value);
  element.dispatchEvent(new view.Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new view.Event("change", { bubbles: true }));
  return "filled";
}
