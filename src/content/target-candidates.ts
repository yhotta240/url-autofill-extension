import { getFillBlockReason } from "./autofill.ts";
import type { FillTarget } from "./parser.ts";
import { resolveTarget } from "./resolver.ts";

function selectorFor(element: Element, root: Document): string {
  const identifies = (selector: string): boolean => {
    const result = resolveTarget({ kind: "selector", value: selector }, root);
    return result.status === "found" && result.element === element;
  };
  if (element.id) {
    const selector = `#${CSS.escape(element.id)}`;
    if (identifies(selector)) return selector;
  }
  const name = element.getAttribute("name");
  if (name) {
    const selector = `${element.localName}[name=${CSS.escape(name)}]`;
    if (identifies(selector)) return selector;
  }

  const path: string[] = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.id) {
      const selector = [`#${CSS.escape(current.id)}`, ...path].join(" > ");
      if (identifies(selector)) return selector;
    }
    let position = 1;
    for (
      let sibling = current.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.localName === current.localName) position += 1;
    }
    path.unshift(`${current.localName}:nth-of-type(${position})`);
    const selector = path.join(" > ");
    if (identifies(selector)) return selector;
  }
  return "";
}

/** 候補が既存の解決処理で元の入力要素を指すことも確認する． */
export function getTargetCandidates(root: Document, kind: FillTarget["kind"]): string[] {
  const candidates = new Set<string>();
  for (const element of root.querySelectorAll("input, textarea, select")) {
    if (getFillBlockReason(element)) continue;
    if (kind === "selector") {
      const selector = selectorFor(element, root);
      if (selector) candidates.add(selector);
      continue;
    }
    for (const value of [element.getAttribute("name"), element.id]) {
      if (!value?.trim() || candidates.has(value)) continue;
      const result = resolveTarget({ kind: "field", value }, root);
      if (result.status === "found" && result.element === element) candidates.add(value);
    }
  }
  return [...candidates];
}
