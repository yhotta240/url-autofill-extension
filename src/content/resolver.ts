import type { FillTarget } from "./parser.ts";

export type Resolution =
  | { status: "found"; element: Element }
  | { status: "missing" | "ambiguous" | "invalid-selector" };

function unique(elements: ArrayLike<Element>): Resolution {
  if (elements.length === 0) return { status: "missing" };
  if (elements.length !== 1) return { status: "ambiguous" };
  return { status: "found", element: elements[0] };
}

export function resolveTarget(target: FillTarget, root: Document): Resolution {
  if (target.kind === "selector") {
    try {
      return unique(root.querySelectorAll(target.value));
    } catch {
      return { status: "invalid-selector" };
    }
  }

  const named = Array.from(root.getElementsByName(target.value)).filter((element) =>
    element.matches("input, textarea, select"),
  );
  // name が曖昧な場合は id へフォールバックしない．
  if (named.length > 0) return unique(named);

  // 値をセレクタへ埋め込まず，特殊文字や重複idも正しく扱う．
  return unique(
    Array.from(root.querySelectorAll("[id]")).filter((item) => item.id === target.value),
  );
}
