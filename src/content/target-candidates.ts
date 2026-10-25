import { getFillBlockReason } from "./autofill.ts";
import type { FillTarget } from "./parser.ts";
import { isRadio, resolveTarget } from "./resolver.ts";

function selectorFor(element: Element, root: Document): string {
  const identifies = (selector: string): boolean => {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
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

function radioGroupSelector(radio: HTMLInputElement, root: Document) {
  if (!radio.name) return;
  const base = `input[type=radio][name=${CSS.escape(radio.name)}]`;
  const radios = Array.from(root.querySelectorAll<HTMLInputElement>(base)).filter(
    (element) => element.form === radio.form,
  );
  if (
    radios.length < 2 ||
    radios.some((element) => {
      const reason = getFillBlockReason(element);
      return reason !== null && reason !== "disabled";
    })
  )
    return;

  const selectors = [base];
  const form = radio.form;
  if (form) {
    const scope = selectorFor(form, root);
    if (scope) {
      selectors.push(`${scope} ${base}`);
      const external = form.id ? `, ${base}[form=${CSS.escape(form.id)}]` : "";
      selectors.push(`${scope} ${base}:not([form])${external}`);
    }
  } else {
    selectors.push(`${base}:not(form input):not([form])`);
  }
  for (const selector of selectors) {
    const result = resolveTarget({ kind: "selector", value: selector }, root);
    if (
      result.status === "found" &&
      result.kind === "radio-group" &&
      result.elements.length === radios.length &&
      result.elements.every((element) => radios.includes(element))
    ) {
      return { selector, elements: radios };
    }
  }
}

/** 候補が既存の解決処理で元の入力要素を指すことも確認する． */
export function getTargetCandidates(root: Document, kind: FillTarget["kind"]): string[] {
  const candidates = new Set<string>();
  const grouped = new Set<Element>();
  for (const element of root.querySelectorAll("input, textarea, select")) {
    if (getFillBlockReason(element)) continue;
    if (kind === "selector") {
      if (grouped.has(element)) continue;
      const group = isRadio(element) ? radioGroupSelector(element, root) : undefined;
      if (group) {
        candidates.add(group.selector);
        for (const radio of group.elements) grouped.add(radio);
        continue;
      }
      const selector = selectorFor(element, root);
      if (selector) candidates.add(selector);
      continue;
    }
    for (const value of [element.getAttribute("name"), element.id]) {
      if (
        !value?.trim() ||
        /[\r\n]/.test(value) ||
        value.startsWith("fill(") ||
        candidates.has(value)
      )
        continue;
      const result = resolveTarget({ kind: "field", value }, root);
      if (
        result.status === "found" &&
        (result.kind === "element"
          ? result.element === element
          : result.elements.some((radio) => radio === element))
      )
        candidates.add(value);
    }
  }
  return [...candidates];
}
