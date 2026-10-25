import type { RadioInfo, ValueInputInfo, ValueInputOption } from "../../shared/target-check.ts";

/** 入力値の文字列を保持し，確認できた入力先に合わせて操作を切り替える． */
export function createValueInput(
  value: HTMLTextAreaElement,
  select: HTMLSelectElement,
  output: HTMLOutputElement,
  label: HTMLLabelElement,
  onChange: () => void,
  onFocus: () => void,
) {
  let radio: RadioInfo | undefined;
  let field: ValueInputInfo | undefined;
  let choices: ValueInputOption[] = [];
  let useDirectValue = false;
  let optionsKey = "";
  let updating = false;
  const placeholder = new Option("", "");
  placeholder.disabled = true;

  function validate(): string {
    const grouped = radio?.mode === "group";
    if (!grouped && field?.kind !== "select") return "";
    const option = choices.find((option) => option.value === value.value);
    if (!option) {
      return grouped ? "ラジオの選択肢を選んでください．" : "選択リストの選択肢を選んでください．";
    }
    if (option.disabled) {
      return grouped ? "無効なラジオは選択できません．" : "無効な選択肢は選択できません．";
    }
    return "";
  }

  function render(): void {
    const direct = radio?.mode === "direct" && radio.value === value.value;
    const grouped = radio?.mode === "group";
    const choosing = grouped || field !== undefined;
    const control = choosing ? select : direct ? output : value;
    const active = value.ownerDocument.activeElement;
    const focused = active === value || active === select || active === output;
    updating = true;
    value.hidden = control !== value;
    select.hidden = control !== select;
    output.hidden = control !== output;
    label.htmlFor = control.id;
    if (direct) output.value = value.value;
    if (choosing) {
      const key = JSON.stringify([grouped, choices]);
      if (key !== optionsKey) {
        optionsKey = key;
        const options = choices.map((option, index) => {
          const item = new Option(option.label || option.value || "（空の値）", String(index));
          item.disabled = option.disabled;
          return item;
        });
        select.replaceChildren(
          ...(grouped ? [placeholder, ...options] : [...options, placeholder]),
        );
      }
      placeholder.hidden = !grouped;
      placeholder.textContent =
        grouped || field?.kind === "select" ? "選択してください" : `現在の値：${value.value}`;
      let selectedValue = value.value;
      if (field?.kind === "checkbox") {
        if (selectedValue === "1") selectedValue = "true";
        else if (selectedValue === "0" || selectedValue === "") selectedValue = "false";
      }
      const index = choices.findIndex((option) => option.value === selectedValue);
      select.value = index < 0 ? "" : String(index);
    }
    if (focused && value.ownerDocument.activeElement !== control) control.focus();
    updating = false;
  }

  function choose(): void {
    if (select.value === "") return;
    const option = choices[Number(select.value)];
    if (!option || option.disabled) return;
    const changed = value.value !== option.value;
    value.value = option.value;
    render();
    if (changed) onChange();
  }

  function input(): void {
    useDirectValue = false;
    render();
    onChange();
  }

  function focus(): void {
    if (!updating) onFocus();
  }

  select.addEventListener("change", choose);
  value.addEventListener("input", input);
  for (const control of [value, select, output]) control.addEventListener("focus", focus);

  return {
    setInfo(next: RadioInfo | ValueInputInfo | undefined): void {
      radio = next && "mode" in next ? next : undefined;
      field = next && "kind" in next ? next : undefined;
      if (radio?.mode === "direct" && useDirectValue) value.value = radio.value;
      if (next) useDirectValue = false;
      if (radio?.mode === "group") choices = radio.options;
      else if (field?.kind === "select") {
        choices = [...field.options];
        if (!choices.some((option) => option.value === "")) {
          choices.push({ label: "選択解除", value: "", disabled: false });
        }
      } else if (field?.kind === "checkbox") {
        choices = [
          { label: "チェックする", value: "true", disabled: false },
          { label: "外す", value: "false", disabled: false },
        ];
      } else choices = [];
      render();
    },
    targetChanged(): void {
      useDirectValue = true;
    },
    validate,
    selectedGroup(): string | undefined {
      if (radio?.mode === "group") return validate() ? undefined : radio.group;
      return radio?.mode === "direct" && value.value !== "" && value.value === radio.value
        ? radio.group
        : undefined;
    },
    dispose(): void {
      select.removeEventListener("change", choose);
      value.removeEventListener("input", input);
      for (const control of [value, select, output]) control.removeEventListener("focus", focus);
    },
  };
}
