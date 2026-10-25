import type { RadioInfo } from "../shared/target-check.ts";
import { getFillBlockReason } from "./autofill.ts";
import { isRadio, type Resolution } from "./resolver.ts";

const formIds = new WeakMap<HTMLFormElement, number>();
let nextFormId = 1;

function groupId(radio: HTMLInputElement): string | undefined {
  if (!radio.name) return undefined;
  const form = radio.form;
  if (form && !formIds.has(form)) formIds.set(form, nextFormId++);
  return JSON.stringify([form ? formIds.get(form) : 0, radio.name]);
}

/** 定義された値・ラベルだけを返し，現在の選択状態は読み取らない． */
export function getRadioInfo(result: Resolution): RadioInfo | undefined {
  if (result.status !== "found") return;
  if (result.kind === "element") {
    if (!isRadio(result.element) || getFillBlockReason(result.element)) return;
    return { mode: "direct", group: groupId(result.element), value: result.element.value };
  }
  if (
    result.elements.some((radio) => {
      const reason = getFillBlockReason(radio);
      return reason !== null && reason !== "disabled";
    })
  )
    return;
  const group = groupId(result.elements[0]);
  if (!group) return;
  return {
    mode: "group",
    group,
    options: result.elements.map((radio) => ({
      label:
        Array.from(radio.labels ?? [])
          .map((label) => label.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ") || radio.value,
      value: radio.value,
      disabled: radio.matches(":disabled"),
    })),
  };
}
