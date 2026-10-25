// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { listenForTargetChecks } from "../src/content/target-check.ts";
import { TARGET_CHECK_TYPE } from "../src/shared/target-check.ts";

type MessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let listener: MessageListener;
let dispose: () => void;

beforeEach(() => {
  document.body.innerHTML = '<input name="email" value="元の値"><input id="only-id">';
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: vi.fn((callback: MessageListener) => {
          listener = callback;
        }),
        removeListener: vi.fn(),
      },
    },
  });
  dispose = listenForTargetChecks(document);
});

afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test("有効状態を参照せずCSSセレクタを確認し，URLや入力値を変更しない", () => {
  const url = window.location.href;
  const changed = vi.fn();
  document.addEventListener("input", changed, { once: true });
  for (const target of ['input[name="email"]', "#only-id"]) {
    const reply = vi.fn();
    listener({ type: TARGET_CHECK_TYPE, selector: target }, {}, reply);
    expect(reply).toHaveBeenCalledExactlyOnceWith({
      url,
      status: "found",
      targetInfo: { label: "", type: "text" },
    });
  }
  expect(document.querySelector("input")?.value).toBe("元の値");
  expect(window.location.href).toBe(url);
  expect(changed).not.toHaveBeenCalled();
  document.removeEventListener("input", changed);
});

test.each([
  ['<input id="field" value="田中">', "#field", "田中"],
  ['<input id="field" value="">', "#field", ""],
  ['<textarea id="field">1行目\n2行目</textarea>', "#field", "1行目\n2行目"],
  ['<input id="field" type="checkbox" checked>', "#field", "true"],
  ['<input id="field" type="checkbox">', "#field", "false"],
  [
    '<select id="field"><option value="a">A</option><option value="b" selected>B</option></select>',
    "#field",
    "b",
  ],
  ['<input id="field" type="radio" name="plan" value="b" checked>', "#field", "b"],
  ['<input id="field" type="radio" name="plan" value="b">', "#field", ""],
  [
    '<input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b" checked>',
    'input[name="plan"]',
    "b",
  ],
])("要求されたときだけ入力先の現在値を返し，ページを変更しない: %j", (html, selector, expected) => {
  document.body.innerHTML = html;
  const before = document.body.innerHTML;
  const reply = vi.fn();
  listener({ type: TARGET_CHECK_TYPE, selector, includeCurrentValue: true }, {}, reply);
  expect(reply.mock.calls[0][0].currentValue).toBe(expected);
  expect(document.body.innerHTML).toBe(before);
});

test.each([
  '<input id="field" type="password" value="secret">',
  '<input id="field" autocomplete="one-time-code" value="secret">',
  '<input id="field" disabled value="secret">',
  '<textarea id="field" readonly>secret</textarea>',
])("対象外の入力欄は要求があっても現在値を読まない: %s", (html) => {
  document.body.innerHTML = html;
  Object.defineProperty(document.getElementById("field"), "value", {
    get() {
      throw new Error("対象外の値は取得しない");
    },
  });
  const reply = vi.fn();
  listener({ type: TARGET_CHECK_TYPE, selector: "#field", includeCurrentValue: true }, {}, reply);
  expect(reply.mock.calls[0][0]).not.toHaveProperty("currentValue");
});

test("現在値の要求がなければ値を読まず，複数選択は取り込まない", () => {
  Object.defineProperty(document.querySelector("input"), "value", {
    get() {
      throw new Error("要求されていない値は読まない");
    },
  });
  const reply = vi.fn();
  listener(
    { type: TARGET_CHECK_TYPE, selector: 'input[name="email"]', includeCurrentValue: false },
    {},
    reply,
  );
  expect(reply.mock.calls[0][0]).not.toHaveProperty("currentValue");
  document.body.innerHTML =
    '<select id="multi" multiple><option value="a" selected>A</option><option value="b" selected>B</option></select>';
  reply.mockClear();
  listener({ type: TARGET_CHECK_TYPE, selector: "#multi", includeCurrentValue: true }, {}, reply);
  expect(reply.mock.calls[0][0]).not.toHaveProperty("currentValue");
});

test("未検出・複数一致・不正なCSSを区別する", () => {
  document.body.insertAdjacentHTML("beforeend", '<input name="email">');
  for (const [target, status] of [
    ['input[name="missing"]', "missing"],
    ['input[name="email"]', "ambiguous"],
    ["[", "invalid-selector"],
  ]) {
    const reply = vi.fn();
    listener({ type: TARGET_CHECK_TYPE, selector: target }, {}, reply);
    expect(reply).toHaveBeenCalledExactlyOnceWith({ url: window.location.href, status });
  }
});

test("別のメッセージや不正な指定には応答せず，破棄時に受信を解除する", () => {
  const reply = vi.fn();
  for (const message of [
    null,
    { type: "other" },
    { type: TARGET_CHECK_TYPE, target: { kind: "other", value: "email" } },
    { type: TARGET_CHECK_TYPE, selector: 1 },
    { type: TARGET_CHECK_TYPE, selector: "#field", includeCurrentValue: "true" },
  ]) {
    listener(message, {}, reply);
  }
  expect(reply).not.toHaveBeenCalled();
  dispose();
  expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
});

test("ラジオ情報はラベル・無効状態・フォーム所有者を返し，選択状態は参照しない", () => {
  document.body.innerHTML =
    '<form id="owner"><label for="a">プランA</label><input type="radio" name="plan" id="a" value="a"><label><input type="radio" name="plan" id="b" value="">空</label><fieldset disabled><input type="radio" name="plan" value="c"></fieldset></form><input type="radio" name="plan" form="owner" id="external" value="d"><form><input type="radio" name="plan" id="other" value="a"></form>';
  for (const radio of document.querySelectorAll("input")) {
    Object.defineProperty(radio, "checked", {
      get() {
        throw new Error("現在の選択は読まない");
      },
    });
  }
  const reply = (value: string) => {
    const response = vi.fn();
    listener({ type: TARGET_CHECK_TYPE, selector: value }, {}, response);
    return response.mock.calls[0][0];
  };
  const direct = reply("#a").radio;
  expect(direct).toMatchObject({ mode: "direct", value: "a", group: expect.any(String) });
  const grouped = reply("#owner").radio;
  expect(grouped).toEqual({
    mode: "group",
    group: direct.group,
    options: [
      { label: "プランA", value: "a", disabled: false },
      { label: "空", value: "", disabled: false },
      { label: "c", value: "c", disabled: true },
    ],
  });
  expect(reply("#external").radio.group).toBe(direct.group);
  expect(reply("#other").radio.group).not.toBe(direct.group);
  document.body.prepend(document.createElement("form"));
  expect(reply("#a").radio.group).toBe(direct.group);
});

test("チェックボックスの情報を返し，チェック状態は読み取らない", () => {
  document.body.innerHTML = '<input id="choice" type="checkbox" checked>';
  Object.defineProperty(document.querySelector("input"), "checked", {
    get() {
      throw new Error("チェック状態を取得しない");
    },
    set() {
      throw new Error("チェック状態を変更しない");
    },
  });
  const reply = vi.fn();
  listener({ type: TARGET_CHECK_TYPE, selector: "#choice" }, {}, reply);
  expect(reply).toHaveBeenCalledExactlyOnceWith({
    url: window.location.href,
    status: "found",
    targetInfo: { label: "", type: "checkbox" },
    valueInput: { kind: "checkbox" },
  });
});

test("選択肢の表示名・値・無効状態を返し，同じ値は最初の選択肢にまとめる", () => {
  document.body.innerHTML = `<select name="plan" multiple>
    <option value="">選んでください</option>
    <option value="a" label="プランA" selected>A</option>
    <option value="duplicate" disabled>最初</option>
    <option value="duplicate">重複</option>
    <optgroup disabled><option value="b">プランB</option></optgroup>
  </select>`;
  const select = document.querySelector("select");
  expect(select).not.toBeNull();
  for (const property of ["value", "selectedIndex", "selectedOptions"]) {
    Object.defineProperty(select, property, {
      get() {
        throw new Error("現在の選択状態を取得しない");
      },
    });
  }
  const reply = vi.fn();
  listener({ type: TARGET_CHECK_TYPE, selector: 'select[name="plan"]' }, {}, reply);
  expect(reply).toHaveBeenCalledExactlyOnceWith({
    url: window.location.href,
    status: "found",
    targetInfo: { label: "", type: "select-multiple" },
    valueInput: {
      kind: "select",
      options: [
        { label: "選んでください", value: "", disabled: false },
        { label: "プランA", value: "a", disabled: false },
        { label: "最初", value: "duplicate", disabled: true },
        { label: "プランB", value: "b", disabled: true },
      ],
    },
  });
  expect(select?.options[1].selected).toBe(true);
});

test("未対応・無効な入力欄と複数一致には入力UI情報を返さない", () => {
  document.body.innerHTML = `<input id="text"><select id="disabled" disabled></select>
    <input id="sensitive" type="checkbox" autocomplete="one-time-code">
    <input type="radio" name="group"><input type="radio" name="group">`;
  const text = document.querySelector("input");
  Object.defineProperty(text, "value", {
    get() {
      throw new Error("入力内容を取得しない");
    },
  });
  for (const name of ["text", "disabled", "sensitive", "group"]) {
    const reply = vi.fn();
    listener(
      { type: TARGET_CHECK_TYPE, selector: name === "group" ? 'input[name="group"]' : `#${name}` },
      {},
      reply,
    );
    expect(reply.mock.calls[0][0]).toEqual({
      url: window.location.href,
      status: name === "group" ? "invalid-radio-group" : "found",
      ...(name === "group"
        ? {}
        : {
            targetInfo: {
              label: "",
              type: name === "disabled" ? "select-one" : name === "sensitive" ? "checkbox" : "text",
            },
          }),
    });
  }
});

test("提示された兄弟label構造のラベルと型の取得結果を確認する", () => {
  document.body.innerHTML =
    '<div><label class="block text-xs font-medium text-secondary-foreground/70 mb-1">タイトル<span class="text-red-500 ml-0.5">*</span></label><input class="w-full rounded-md border border-secondary-foreground/40 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" maxlength="80" required="" value=""><p class="mt-1 text-xs text-secondary-foreground/70">80文字以内で概要を記述してください．</p></div>';
  const field = document.querySelector("input");
  expect(field?.labels).toHaveLength(0);
  const reply = vi.fn();
  listener({ type: TARGET_CHECK_TYPE, selector: 'input[maxlength="80"]' }, {}, reply);
  expect(reply).toHaveBeenCalledExactlyOnceWith({
    url: window.location.href,
    status: "found",
    targetInfo: { label: "", type: "text" },
  });
});

test.each([
  {
    html: '<label for="field"> メール\n アドレス <span aria-hidden="true">*</span></label><input id="field" type="email">',
    label: "メール アドレス",
    type: "email",
  },
  {
    html: '<label>説明<textarea id="field">元の入力内容</textarea></label>',
    label: "説明",
    type: "textarea",
  },
  {
    html: '<label>プラン<select id="field"><option>プランA</option></select></label>',
    label: "プラン",
    type: "select-one",
  },
  {
    html: '<label for="field">外側</label><input id="field" aria-label="検索キーワード" type="search">',
    label: "検索キーワード",
    type: "search",
  },
  {
    html: '<span id="first"> 希望 </span><span id="second" hidden>日付</span><input id="field" type="date" aria-labelledby="first missing second" aria-label="別名">',
    label: "希望 日付",
    type: "date",
  },
  {
    html: '<label for="field">氏名</label><label for="field">必須</label><input id="field" aria-labelledby="missing">',
    label: "氏名 必須",
    type: "text",
  },
  {
    html: '<input id="field" type="unknown" placeholder="ラベルの代わりにはしない">',
    label: "",
    type: "text",
  },
  { html: '<button id="field">送信</button>', label: "送信", type: "submit" },
  {
    html: '<label><input id="field" type="radio" name="plan" value="a">プランA</label>',
    label: "プランA",
    type: "radio",
  },
])("ラベルとDOMで認識した型を返す: $type / $label", ({ html, label, type }) => {
  document.body.innerHTML = html;
  const field = document.getElementById("field");
  if (type !== "radio") {
    Object.defineProperty(field, "value", {
      get() {
        throw new Error("ラベル確認では入力値を読まない");
      },
    });
  }
  const before = document.body.innerHTML;
  const reply = vi.fn();
  listener({ type: TARGET_CHECK_TYPE, selector: "#field" }, {}, reply);
  expect(reply.mock.calls[0][0].targetInfo).toEqual({ label, type });
  expect(document.body.innerHTML).toBe(before);
});

test.each([
  '<fieldset id="group"><legend>契約プラン</legend><label><input type="radio" name="plan" value="a">A</label><label><input type="radio" name="plan" value="b">B</label></fieldset>',
  '<div id="group" role="radiogroup" aria-label="契約プラン"><label><input type="radio" name="plan" value="a">A</label><label><input type="radio" name="plan" value="b">B</label></div>',
])("ラジオグループの名前と型を返し，個別の選択肢のラベルとは区別する", (html) => {
  document.body.innerHTML = html;
  const reply = vi.fn();
  listener({ type: TARGET_CHECK_TYPE, selector: "#group" }, {}, reply);
  expect(reply.mock.calls[0][0].targetInfo).toEqual({ label: "契約プラン", type: "radio-group" });
});
