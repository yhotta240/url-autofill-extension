import { isEditableElement } from "./editable.ts";

export type Resolution =
  | { status: "found"; kind: "element"; element: Element }
  | { status: "found"; kind: "radio-group"; elements: HTMLInputElement[] }
  | { status: "missing" | "ambiguous" | "invalid-selector" | "invalid-radio-group" };

export function isRadio(element: Element): element is HTMLInputElement {
  const view = element.ownerDocument.defaultView;
  return !!view && element instanceof view.HTMLInputElement && element.type === "radio";
}

function radioGroup(elements: Element[]): Resolution {
  const first = elements[0];
  if (!first) return { status: "missing" };
  if (
    !isRadio(first) ||
    !first.name ||
    !elements.every(
      (element) => isRadio(element) && element.name === first.name && element.form === first.form,
    )
  )
    return { status: "invalid-radio-group" };
  const radios = elements as HTMLInputElement[];
  if (new Set(radios.map((radio) => radio.value)).size !== radios.length) {
    return { status: "invalid-radio-group" };
  }
  return { status: "found", kind: "radio-group", elements: radios };
}

function resolveCandidates(elements: ArrayLike<Element>): Resolution {
  const candidates = Array.from(elements).filter(
    (element) => !element.matches("input[type=hidden]"),
  );
  if (candidates.length === 0) return { status: "missing" };
  if (candidates.length !== 1) {
    if (
      candidates.some((element) => isRadio(element) || element.querySelector('input[type="radio"]'))
    )
      return radioGroup(candidates);
    return { status: "ambiguous" };
  }
  const element = candidates[0];
  if (element.matches("input, textarea, select, button") || isEditableElement(element)) {
    return { status: "found", kind: "element", element };
  }
  return radioGroup(
    Array.from(element.querySelectorAll("input, textarea, select, button")).filter(
      (item) => !item.matches("input[type=hidden]"),
    ),
  );
}

export function resolveTarget(selector: string, root: Document): Resolution {
  try {
    return resolveCandidates(root.querySelectorAll(selector));
  } catch {
    return { status: "invalid-selector" };
  }
}
