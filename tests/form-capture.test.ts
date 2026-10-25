// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fillElement, fillRadioGroup } from "../src/content/autofill.ts";
import { captureForm, getCaptureForms } from "../src/content/form-capture.ts";
import { MAX_FIELDS, parseAutofillUrl } from "../src/content/parser.ts";
import { resolveTarget } from "../src/content/resolver.ts";
import { listenForTargetChecks } from "../src/content/target-check.ts";
import { FORM_CAPTURE_TYPE } from "../src/shared/form-capture.ts";
import { generateAutofillUrl } from "../src/utils/url-generator.ts";

beforeEach(() => {
  vi.stubGlobal("CSS", {
    escape: (value: string) =>
      value.replace(/[^a-zA-Z_-]/gu, (char) => `\\${char.codePointAt(0)?.toString(16)} `),
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test("フォーム一覧はid・name・番号を使い，現在値を読み取らない", () => {
  document.body.innerHTML =
    '<form id="login"><input name="id"><input name="name" type="checkbox"></form><form name="search"><input></form><form><select></select></form>';
  for (const element of document.querySelectorAll("input, select")) {
    for (const key of ["value", "checked", "selectedIndex"]) {
      Object.defineProperty(element, key, {
        get() {
          throw new Error("値を読み取らない");
        },
      });
    }
  }
  const forms = getCaptureForms(document);
  expect(forms.map((form) => form.label)).toEqual([
    "フォーム1（#login）",
    "フォーム2（name=search）",
    "フォーム3",
  ]);
  forms.forEach((form, index) => {
    expect(document.querySelector(form.selector)).toBe(document.forms[index]);
  });
});

test("フォームがなくても空文字・改行・チェック状態・selectをCSS指定で取り込む", () => {
  document.body.innerHTML =
    '<input id="empty"><textarea id="memo"></textarea><input id="on" type="checkbox" checked><input id="off" type="checkbox"><select id="choice"><option value="">未選択</option><option value="a&b" selected>選択肢</option></select>';
  const memo = document.querySelector<HTMLTextAreaElement>("#memo");
  if (memo) memo.value = "1行目\n2行目";
  const changed = vi.fn();
  for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
    Object.defineProperty(checkbox, "value", {
      get() {
        throw new Error("チェック状態だけを読み取る");
      },
    });
  }
  for (const type of ["input", "change", "click", "submit"])
    document.body.addEventListener(type, changed);
  expect(getCaptureForms(document)).toEqual([]);
  const result = captureForm(document, null, []);
  expect(result.entries.map((entry) => [entry.selector, entry.value])).toEqual([
    ["#empty", ""],
    ["#memo", "1行目\n2行目"],
    ["#on", "true"],
    ["#off", "false"],
    ["#choice", "a&b"],
  ]);
  expect(parseAutofillUrl(generateAutofillUrl(location.href, result.entries))?.entries).toEqual(
    result.entries,
  );
  expect(changed).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLInputElement>("#on")?.checked).toBe(true);
  expect(document.querySelector<HTMLSelectElement>("#choice")?.selectedIndex).toBe(1);
});

test("フォーム所有者で絞り，外部の関連要素を含め，他フォームの要素は除く", () => {
  document.body.innerHTML =
    '<form id="one"><div><input id="inside" value="one"></div><input id="belongs-two" form="two" value="other"></form><input id="outside" form="one" value="external"><form id="two"><input value="two"></form>';
  const result = captureForm(document, "#one", []);
  expect(result.entries.map((entry) => entry.value)).toEqual(["one", "external"]);
  expect(result.entries[0].selector).toBe("#one #inside");
  expect(document.querySelector(result.entries[1].selector)?.id).toBe("outside");
  document.querySelector("#one")?.remove();
  expect(() => captureForm(document, "#one", [])).toThrow("フォームが見つかりません");
  expect(() => captureForm(document, "[", [])).toThrow("フォームが見つかりません");
});

test("ラジオは選択済みグループを1項目とし，空valueもグループなら再現する", () => {
  document.body.innerHTML =
    '<form id="form"><input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b" checked><input type="radio" name="none" value="a"><input type="radio" name="none" value="b"><input type="radio" name="empty" value="" checked><input type="radio" name="empty" value="b"><input type="radio" name="single" value="" checked><input type="radio" id="dup-a" name="dup" value="same"><input type="radio" id="dup-b" name="dup" value="same" checked></form>';
  const result = captureForm(document, null, []);
  expect(result.entries.map((entry) => entry.value)).toEqual(["b", "", "same"]);
  expect(result.skipped).toBe(1);
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    radio.checked = false;
  for (const entry of result.entries) {
    const target = resolveTarget(entry.selector, document);
    expect(target.status).toBe("found");
    if (target.status !== "found") throw new Error("入力先が見つかりません");
    expect(
      target.kind === "radio-group"
        ? fillRadioGroup(target.elements, entry.value)
        : fillElement(target.element, entry.value),
    ).toBe("filled");
  }
  expect(
    [...document.querySelectorAll<HTMLInputElement>(":checked")].map((radio) => radio.value),
  ).toEqual(["b", "", "same"]);
});

test("入力対象外や再現できない選択状態は値を取り込まない", () => {
  document.body.innerHTML =
    '<input id="safe" value="safe"><input type="password"><input type="hidden"><input type="file"><input autocomplete="one-time-code"><input readonly><input disabled><select multiple><option selected value="a">A</option><option selected value="b">B</option></select><select><option disabled selected value="">未選択</option></select>';
  for (const element of document.querySelectorAll<HTMLInputElement>("input:not(#safe)")) {
    Object.defineProperty(element, "value", {
      get() {
        throw new Error("対象外の値を読み取らない");
      },
    });
  }
  const result = captureForm(document, null, []);
  expect(result.entries).toEqual([{ selector: "#safe", value: "safe" }]);
  expect(result.skipped).toBe(8);
});

test.each([
  false,
  true,
])("空文字の設定で選択状態が変わる未選択selectだけを除外する: multiple=%s", (multiple) => {
  const attribute = multiple ? "multiple" : "";
  document.body.innerHTML = `<select id="unselected-empty" ${attribute}><option value="">空</option><option value="a">A</option></select><select id="unselected-no-empty" ${attribute}><option value="a">A</option></select><select id="selected-empty" ${attribute}><option value="" selected>空</option></select>`;
  const selects = [...document.querySelectorAll("select")];
  selects[0].selectedIndex = -1;
  selects[1].selectedIndex = -1;
  const result = captureForm(document, null, []);
  expect(result.skipped).toBe(1);
  expect(result.entries).toEqual([
    { selector: "#unselected-no-empty", value: "" },
    { selector: "#selected-empty", value: "" },
  ]);
  expect(selects.map((select) => select.selectedOptions.length)).toEqual([0, 0, 1]);
  for (const entry of result.entries) {
    const select = document.querySelector(entry.selector);
    if (!select) throw new Error("入力先が見つかりません");
    expect(fillElement(select, entry.value)).toBe("filled");
  }
  expect(selects.map((select) => select.selectedOptions.length)).toEqual([0, 0, 1]);
});

test("CSSセレクタの違いやラジオの指定範囲にかかわらず，既存の入力先は追加しない", () => {
  document.body.innerHTML =
    '<input name="email" id="email" value="page"><input type="radio" id="a" name="plan" value="a"><input type="radio" id="b" name="plan" value="b" checked><input type="checkbox" id="new"><input name="" id="blank-name" value="blank">';
  const result = captureForm(document, null, ['input[name="email"]', "#a", ""]);
  expect(result.duplicates).toBe(2);
  expect(result.entries).toEqual([
    { selector: "#new", value: "false" },
    { selector: "#blank-name", value: "blank" },
  ]);
});

test("100項目を超える場合は途中までの結果を返さない", () => {
  document.body.innerHTML = '<input value="a">'.repeat(MAX_FIELDS + 1);
  expect(() => captureForm(document, null, [])).toThrow("100件まで");
});

test("有効状態を参照せず，フォーム一覧と現在値の問い合わせに応答する", () => {
  let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = () => {};
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        },
        removeListener: vi.fn(),
      },
    },
  });
  document.body.innerHTML = '<form id="f"><input name="email" value="current"></form>';
  const stop = listenForTargetChecks(document);
  const reply = vi.fn();
  listener({ type: FORM_CAPTURE_TYPE, action: "forms" }, {}, reply);
  expect(reply.mock.calls[0][0]).toEqual({
    url: location.href,
    forms: [{ selector: "#f", label: "フォーム1（#f）" }],
  });
  listener({ type: FORM_CAPTURE_TYPE, action: "capture", scope: "#f", existing: [] }, {}, reply);
  expect(reply.mock.calls[1][0]).toMatchObject({
    url: location.href,
    entries: [{ value: "current" }],
  });
  listener(
    { type: FORM_CAPTURE_TYPE, action: "capture", scope: "#missing", existing: [] },
    {},
    reply,
  );
  expect(reply.mock.calls[2][0].error).toContain("フォームが見つかりません");
  stop();
});
