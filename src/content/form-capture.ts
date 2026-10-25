import type { FormOption } from "../shared/form-capture.ts";
import { getFillBlockReason } from "./autofill.ts";
import { type FillEntry, type FillTarget, MAX_FIELDS } from "./parser.ts";
import { isRadio, resolveTarget } from "./resolver.ts";
import { radioGroupSelector, selectorFor } from "./target-candidates.ts";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

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
    (isRadio(first) &&
      isRadio(second) &&
      first.name !== "" &&
      first.name === second.name &&
      first.form === second.form)
  );
}

function controlSelector(element: Control, root: Document): string {
  const form = element.form;
  if (form && element.closest("form") === form) {
    const scope = selectorFor(form, root);
    const relative = selectorFor(element, form);
    const selector = `${scope} ${relative}`;
    const result = resolveTarget({ kind: "selector", value: selector }, root);
    if (result.status === "found" && result.kind === "element" && result.element === element)
      return selector;
  }
  return selectorFor(element, root);
}

/** 明示的な取り込み操作のときだけ現在値を読み取り，ページは変更しない． */
export function captureForm(root: Document, scope: string | null, existing: FillTarget[]) {
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
    if (!target.value.trim()) continue;
    const result = resolveTarget(target, root);
    if (result.status === "found")
      occupied.push(...(result.kind === "element" ? [result.element] : result.elements));
  }
  const entries: FillEntry[] = [];
  const grouped = new Set<Element>();
  let duplicates = 0;
  let skipped = 0;
  for (const control of root.querySelectorAll<Control>("input, textarea, select")) {
    if ((form && control.form !== form) || grouped.has(control)) continue;
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
    const value =
      element instanceof view.HTMLInputElement && element.type === "checkbox"
        ? String(element.checked)
        : element.value;
    if (isRadio(element) && !radioGroup && value === "") {
      skipped += 1;
      continue;
    } else if (element instanceof view.HTMLSelectElement) {
      const option = Array.from(element.options).find((item) => item.value === value);
      if (
        (element.multiple && element.selectedOptions.length > 1) ||
        (option && (option.disabled || option.closest("optgroup[disabled]")))
      ) {
        skipped += 1;
        continue;
      }
    }
    selector ||= controlSelector(element, root);
    if (!selector) {
      skipped += 1;
      continue;
    }
    entries.push({ target: { kind: "selector", value: selector }, value });
    if (entries.length > MAX_FIELDS) throw new Error(`取り込む項目は${MAX_FIELDS}件までです．`);
    occupied.push(element);
  }
  return { entries, duplicates, skipped };
}
