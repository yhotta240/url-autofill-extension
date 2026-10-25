import type { FillTarget } from "./parser.ts";

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
  if (element.matches("input, textarea, select, button")) {
    return { status: "found", kind: "element", element };
  }
  return radioGroup(
    Array.from(element.querySelectorAll("input, textarea, select, button")).filter(
      (item) => !item.matches("input[type=hidden]"),
    ),
  );
}

export function resolveTarget(target: FillTarget, root: Document): Resolution {
  if (target.kind === "selector") {
    try {
      return resolveCandidates(root.querySelectorAll(target.value));
    } catch {
      return { status: "invalid-selector" };
    }
  }

  const named = resolveCandidates(
    Array.from(root.getElementsByName(target.value)).filter((element) =>
      element.matches("input, textarea, select"),
    ),
  );
  // name が曖昧な場合は id へフォールバックしない．
  if (named.status !== "missing") return named;

  // 値をセレクタへ埋め込まず，特殊文字や重複idも正しく扱う．
  return resolveCandidates(
    Array.from(root.querySelectorAll("[id]")).filter((item) => item.id === target.value),
  );
}
