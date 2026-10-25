import { getFillBlockReason } from "./autofill.ts";
import { isRadio, resolveTarget } from "./resolver.ts";

export function selectorFor(element: Element, root: Document | Element): string {
  const identifies = (selector: string): boolean => {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  };
  const id = element.getAttribute("id");
  if (id) {
    const selector = `#${CSS.escape(id)}`;
    if (identifies(selector)) return selector;
  }
  const name = element.getAttribute("name");
  if (name) {
    const selector = `${element.localName}[name=${CSS.escape(name)}]`;
    if (identifies(selector)) return selector;
  }

  const path: string[] = [];
  for (
    let current: Element | null = element;
    current && current !== root;
    current = current.parentElement
  ) {
    const currentId = current.getAttribute("id");
    if (currentId) {
      const selector = [`#${CSS.escape(currentId)}`, ...path].join(" > ");
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

export function radioGroupSelector(radio: HTMLInputElement, root: Document, preferForm = false) {
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

  const selectors: string[] = [];
  if (!preferForm) selectors.push(base);
  const form = radio.form;
  if (form) {
    const scope = selectorFor(form, root);
    if (scope) {
      selectors.push(`${scope} ${base}`);
      const formId = form.getAttribute("id");
      const external = formId ? `, ${base}[form=${CSS.escape(formId)}]` : "";
      selectors.push(`${scope} ${base}:not([form])${external}`);
    }
  } else {
    selectors.push(`${base}:not(form input):not([form])`);
  }
  if (preferForm) selectors.push(base);
  for (const selector of selectors) {
    const result = resolveTarget(selector, root);
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

/** 候補はCSSセレクタで返し，ラジオは有効なグループにまとめる． */
export function getTargetCandidates(root: Document): string[] {
  const candidates = new Set<string>();
  const grouped = new Set<Element>();
  for (const element of root.querySelectorAll("input, textarea, select")) {
    if (getFillBlockReason(element) || grouped.has(element)) continue;
    const group = isRadio(element) ? radioGroupSelector(element, root) : undefined;
    if (group) {
      candidates.add(group.selector);
      for (const radio of group.elements) grouped.add(radio);
      continue;
    }
    const selector = selectorFor(element, root);
    if (selector) candidates.add(selector);
  }
  return [...candidates];
}
