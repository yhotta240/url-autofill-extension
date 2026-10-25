import type { TargetInfo } from "../shared/target-check.ts";
import type { Resolution } from "./resolver.ts";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 入力欄や選択肢の内容を含めず，ラベルの文字列だけを読む． */
function labelText(element: Element | null, includeHidden = false): string {
  if (!element) return "";
  const view = element.ownerDocument.defaultView;
  if (!view) return "";
  const walker = element.ownerDocument.createTreeWalker(element, view.NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent?.closest("input, textarea, select, script, style")) continue;
    if (!includeHidden && parent?.closest('[hidden], [aria-hidden="true"]')) continue;
    text += node.textContent ?? "";
  }
  return normalize(text);
}

function getLabel(element: Element): string {
  const referenced = (element.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => labelText(element.ownerDocument.getElementById(id), true))
    .filter(Boolean)
    .join(" ");
  if (referenced) return referenced;
  const ariaLabel = normalize(element.getAttribute("aria-label") ?? "");
  if (ariaLabel) return ariaLabel;
  const labels = "labels" in element ? (element as HTMLInputElement).labels : null;
  const labelled = Array.from(labels ?? [], (label) => labelText(label))
    .filter(Boolean)
    .join(" ");
  return labelled || (element.localName === "button" ? labelText(element) : "");
}

/** 入力値・選択状態を参照せず，解決された入力先のラベルとDOM上の型を返す． */
export function getTargetInfo(result: Resolution): TargetInfo | undefined {
  if (result.status !== "found") return;
  if (result.kind === "radio-group") {
    const groups = 'fieldset, [role="radiogroup"]';
    let container = result.elements[0].closest(groups);
    while (container && !result.elements.every((radio) => container?.contains(radio))) {
      container = container.parentElement?.closest(groups) ?? null;
    }
    const label = container
      ? getLabel(container) || labelText(container.querySelector(":scope > legend"))
      : "";
    return { label, type: "radio-group" };
  }
  const element = result.element;
  const view = element.ownerDocument.defaultView;
  if (!view) return;
  const type =
    element instanceof view.HTMLInputElement ||
    element instanceof view.HTMLSelectElement ||
    element instanceof view.HTMLButtonElement
      ? element.type
      : element.localName;
  return { label: getLabel(element), type };
}
