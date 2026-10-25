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
    expect(reply).toHaveBeenCalledExactlyOnceWith({ url, status: "found" });
  }
  expect(document.querySelector("input")?.value).toBe("元の値");
  expect(window.location.href).toBe(url);
  expect(changed).not.toHaveBeenCalled();
  document.removeEventListener("input", changed);
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
    });
  }
});
