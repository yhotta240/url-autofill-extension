import type { RadioInfo } from "../../shared/target-check.ts";

/** 値の保存先は既存のtextareaのまま，確認できたラジオだけ表示を切り替える． */
export function createRadioValue(
  value: HTMLTextAreaElement,
  select: HTMLSelectElement,
  output: HTMLOutputElement,
  label: HTMLLabelElement,
  onChange: () => void,
  onFocus: () => void,
) {
  let info: RadioInfo | undefined;
  let useDirectValue = false;
  let optionsKey = "";
  let updating = false;

  function validate(): string {
    if (info?.mode !== "group") return "";
    const option = info.options.find((option) => option.value === value.value);
    if (!option) return "ラジオの選択肢を選んでください．";
    return option.disabled ? "無効なラジオは選択できません．" : "";
  }

  function render(): void {
    const direct = info?.mode === "direct" && info.value === value.value;
    const grouped = info?.mode === "group";
    const control = grouped ? select : direct ? output : value;
    const active = value.ownerDocument.activeElement;
    const focused = active === value || active === select || active === output;
    updating = true;
    value.hidden = control !== value;
    select.hidden = control !== select;
    output.hidden = control !== output;
    label.htmlFor = control.id;
    if (direct) output.value = value.value;
    if (info?.mode === "group") {
      const key = JSON.stringify(info.options);
      if (key !== optionsKey) {
        optionsKey = key;
        const placeholder = new Option("選択してください", "");
        placeholder.disabled = true;
        select.replaceChildren(
          placeholder,
          ...info.options.map((option, index) => {
            const item = new Option(option.label || "（空の値）", String(index));
            item.disabled = option.disabled;
            return item;
          }),
        );
      }
      const index = info.options.findIndex((option) => option.value === value.value);
      select.value = index < 0 ? "" : String(index);
    }
    if (focused && value.ownerDocument.activeElement !== control) control.focus();
    updating = false;
  }

  select.addEventListener("change", () => {
    if (info?.mode !== "group" || select.value === "") return;
    const option = info.options[Number(select.value)];
    if (!option || option.disabled) return;
    value.value = option.value;
    onChange();
  });
  value.addEventListener("input", () => {
    useDirectValue = false;
    render();
  });
  for (const control of [value, select, output]) {
    control.addEventListener("focus", () => {
      if (!updating) onFocus();
    });
  }

  return {
    setInfo(next: RadioInfo | undefined): void {
      info = next;
      if (info?.mode === "direct" && useDirectValue) value.value = info.value;
      if (info) useDirectValue = false;
      render();
    },
    targetChanged(): void {
      useDirectValue = true;
    },
    validate,
    selectedGroup(): string | undefined {
      if (info?.mode === "group") {
        return validate() ? undefined : info.group;
      }
      return info?.mode === "direct" && value.value !== "" && value.value === info.value
        ? info.group
        : undefined;
    },
  };
}
