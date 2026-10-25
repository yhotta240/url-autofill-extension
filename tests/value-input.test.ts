// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createValueInput } from "../src/popup/components/value-input.ts";
import type { ValueInputInfo } from "../src/shared/target-check.ts";

let value: HTMLTextAreaElement;
let select: HTMLSelectElement;
let radio: HTMLOutputElement;
let label: HTMLLabelElement;
let editor: ReturnType<typeof createValueInput>;
const changed = vi.fn();
const focused = vi.fn();
const options: ValueInputInfo = {
  kind: "select",
  options: [
    { label: "プランA", value: "a&b", disabled: false },
    { label: "無効", value: "blocked", disabled: true },
  ],
};

beforeEach(() => {
  document.body.innerHTML = `<label for="value">入力値</label><select id="value-select" hidden></select><output id="value-radio" tabindex="0" hidden></output>
    <textarea id="value"></textarea>`;
  value = document.querySelector("textarea") as HTMLTextAreaElement;
  select = document.querySelector("select") as HTMLSelectElement;
  radio = document.querySelector("output") as HTMLOutputElement;
  label = document.querySelector("label") as HTMLLabelElement;
  changed.mockClear();
  focused.mockClear();
  editor = createValueInput(value, select, radio, label, changed, focused);
});

afterEach(() => {
  editor.dispose();
  document.body.replaceChildren();
});

function choose(text: string): void {
  const option = [...select.options].find((option) => option.textContent === text);
  expect(option).toBeDefined();
  select.value = option?.value ?? "";
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

test("表示名で選択し，URL用の値に変換する。無効な選択肢を選べず，空値へ戻せる", () => {
  editor.setInfo(options);
  expect(
    [...select.options].filter((option) => !option.hidden).map((option) => option.textContent),
  ).toEqual(["プランA", "無効", "選択解除"]);
  expect(value.hidden).toBe(true);
  expect(value.value).toBe("");
  expect(changed).not.toHaveBeenCalled();
  choose("プランA");
  expect(value.value).toBe("a&b");
  expect(select.options[1].disabled).toBe(true);
  choose("無効");
  expect(value.value).toBe("a&b");
  choose("選択解除");
  expect(value.value).toBe("");
  expect(changed).toHaveBeenCalledTimes(2);
});

test("ページに空値の選択肢がある場合はその表示名を使う", () => {
  editor.setInfo({
    kind: "select",
    options: [{ label: "未選択", value: "", disabled: false }],
  });
  expect(
    [...select.options].filter((option) => !option.hidden).map((option) => option.textContent),
  ).toEqual(["未選択"]);
});

test.each([
  ["1", "チェックする", "外す", "false"],
  ["true", "チェックする", "外す", "false"],
  ["0", "外す", "チェックする", "true"],
  ["false", "外す", "チェックする", "true"],
  ["", "外す", "チェックする", "true"],
])("チェックボックスの元の文字列（%s）は，選択を変えるまで保持する", (raw, shown, next, expected) => {
  value.value = raw;
  editor.setInfo({ kind: "checkbox" });
  expect(select.selectedOptions[0].textContent).toBe(shown);
  expect(editor.validate()).toBe("");
  expect(value.value).toBe(raw);
  expect(changed).not.toHaveBeenCalled();
  choose(next);
  expect(value.value).toBe(expected);
  expect(changed).toHaveBeenCalledOnce();
});

test("候補にない保存値や改行は選択操作まで保持し，入力方法の切替は表示しない", () => {
  value.value = "未登録\nの値";
  editor.setInfo(options);
  expect(select.selectedOptions[0].textContent).toBe("選択してください");
  expect(select.selectedOptions[0].disabled).toBe(true);
  expect(value.hidden).toBe(true);
  expect(value.value).toBe("未登録\nの値");
  expect(editor.validate()).toBe("選択リストの選択肢を選んでください．");
  editor.setInfo(options);
  expect(value.value).toBe("未登録\nの値");
  expect(changed).not.toHaveBeenCalled();
  editor.setInfo({
    kind: "select",
    options: [
      ...options.options,
      { label: "追加された値", value: "未登録\nの値", disabled: false },
    ],
  });
  expect(select.selectedOptions[0].textContent).toBe("追加された値");
  expect(editor.validate()).toBe("");
  expect(value.value).toBe("未登録\nの値");
  expect(changed).not.toHaveBeenCalled();
  choose("プランA");
  expect(value.hidden).toBe(true);
  expect(value.value).toBe("a&b");
  expect(changed).toHaveBeenCalledOnce();
  expect([...select.options].some((option) => option.textContent === "手入力")).toBe(false);
});

test("再取得でフォーカスやラベルを失わず，プログラムによる移動で再問い合わせしない", () => {
  value.value = "a&b";
  value.focus();
  expect(focused).toHaveBeenCalledOnce();
  editor.setInfo(options);
  expect(document.activeElement).toBe(select);
  expect(label.control).toBe(select);
  expect(focused).toHaveBeenCalledOnce();
  const option = select.options[0];
  editor.setInfo(options);
  expect(select.options[0]).toBe(option);
  editor.setInfo({
    kind: "select",
    options: [...options.options, { label: "追加", value: "new", disabled: false }],
  });
  expect(document.activeElement).toBe(select);
  expect(value.value).toBe("a&b");
  editor.setInfo(undefined);
  expect(document.activeElement).toBe(value);
  expect(label.control).toBe(value);
  expect(value.value).toBe("a&b");
  expect(focused).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
});
