import type { FormOption } from "../shared/form-capture.ts";
import { getFillBlockReason } from "./autofill.ts";
import { getInputElements, isEditableElement } from "./editable.ts";
import { type FillEntry, MAX_FIELDS } from "./parser.ts";
import { readTargetValue } from "./read-target-value.ts";
import { isRadio, resolveTarget } from "./resolver.ts";
import { radioGroupSelector, selectorFor } from "./target-candidates.ts";

function ownerForm(element: HTMLElement): HTMLFormElement | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  if (
    element instanceof view.HTMLInputElement ||
    element instanceof view.HTMLTextAreaElement ||
    element instanceof view.HTMLSelectElement ||
    element instanceof view.HTMLButtonElement
  )
    return element.form;
  return element.closest("form");
}

/** フォームの定義だけを取得し，入力値や選択状態は読み取らない． */
export function getCaptureForms(root: Document): FormOption[] {
  return Array.from(root.forms, (form, index) => {
    const id = form.getAttribute("id");
    const formName = form.getAttribute("name");
    const name = id ? `（#${id}）` : formName ? `（name=${formName}）` : "";
    return { selector: selectorFor(form, root), label: `フォーム${index + 1}${name}` };
  });
}

function sameTarget(first: Element, second: Element): boolean {
  return (
    first === second ||
    (isEditableElement(first) && first.contains(second)) ||
    (isEditableElement(second) && second.contains(first)) ||
    (isRadio(first) &&
      isRadio(second) &&
      first.name !== "" &&
      first.name === second.name &&
      first.form === second.form)
  );
}

function controlSelector(element: HTMLElement, root: Document): string {
  const form = ownerForm(element);
  if (form && element.closest("form") === form) {
    const scope = selectorFor(form, root);
    const relative = selectorFor(element, form);
    const selector = `${scope} ${relative}`;
    const result = resolveTarget(selector, root);
    if (result.status === "found" && result.kind === "element" && result.element === element)
      return selector;
  }
  return selectorFor(element, root);
}

/** 明示的な取り込み操作のときだけ現在値を読み取り，ページは変更しない． */
export function captureForm(root: Document, scope: string | null, existing: string[]) {
  const view = root.defaultView;
  if (!view) throw new Error("このページでは入力内容を取得できません．");
  let form: HTMLFormElement | null = null;
  if (scope !== null) {
    let matches: NodeListOf<Element> | undefined;
    try {
      matches = root.querySelectorAll(scope);
    } catch {
      /* 無効な指定も同じエラーで扱う． */
    }
    if (matches?.length !== 1 || !(matches[0] instanceof view.HTMLFormElement)) {
      throw new Error("選択したフォームが見つかりません．範囲を選び直してください．");
    }
    form = matches[0];
  }
  const occupied: Element[] = [];
  for (const target of existing) {
    if (!target.trim()) continue;
    const result = resolveTarget(target, root);
    if (result.status === "found")
      occupied.push(...(result.kind === "element" ? [result.element] : result.elements));
  }
  const entries: FillEntry[] = [];
  const grouped = new Set<Element>();
  let duplicates = 0;
  let skipped = 0;
  for (const control of getInputElements(root)) {
    if ((form && ownerForm(control) !== form) || grouped.has(control)) continue;
    if (getFillBlockReason(control)) {
      skipped += 1;
      continue;
    }
    let element = control;
    let selector = "";
    let radioGroup = false;
    if (isRadio(control)) {
      const group = radioGroupSelector(control, root, true);
      if (group) {
        for (const radio of group.elements) grouped.add(radio);
        const selected = group.elements.find((radio) => radio.checked);
        if (!selected) continue;
        if (getFillBlockReason(selected)) {
          skipped += 1;
          continue;
        }
        element = selected;
        selector = group.selector;
        radioGroup = true;
      } else if (!control.checked) continue;
    }
    if (occupied.some((item) => sameTarget(item, element))) {
      duplicates += 1;
      continue;
    }
    let value: string | undefined;
    if (radioGroup && isRadio(element)) {
      value = element.value;
    } else {
      value = readTargetValue({ status: "found", kind: "element", element });
    }
    if (value === undefined) {
      skipped += 1;
      continue;
    }
    selector ||= controlSelector(element, root);
    if (!selector) {
      skipped += 1;
      continue;
    }
    entries.push({ selector, value });
    if (entries.length > MAX_FIELDS) throw new Error(`取り込む項目は${MAX_FIELDS}件までです．`);
    occupied.push(element);
  }
  return { entries, duplicates, skipped };
}
