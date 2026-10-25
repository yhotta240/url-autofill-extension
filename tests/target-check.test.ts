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

test("有効状態を参照せずname・id・CSSを確認し，URLや入力値を変更しない", () => {
  const url = window.location.href;
  const changed = vi.fn();
  document.addEventListener("input", changed, { once: true });
  for (const target of [
    { kind: "field", value: "email" },
    { kind: "field", value: "only-id" },
    { kind: "selector", value: 'input[name="email"]' },
  ]) {
    const reply = vi.fn();
    listener({ type: TARGET_CHECK_TYPE, target }, {}, reply);
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
    [{ kind: "field", value: "missing" }, "missing"],
    [{ kind: "field", value: "email" }, "ambiguous"],
    [{ kind: "selector", value: "[" }, "invalid-selector"],
  ]) {
    const reply = vi.fn();
    listener({ type: TARGET_CHECK_TYPE, target }, {}, reply);
    expect(reply).toHaveBeenCalledExactlyOnceWith({ url: window.location.href, status });
  }
});

test("別のメッセージや不正な指定には応答せず，破棄時に受信を解除する", () => {
  const reply = vi.fn();
  for (const message of [
    null,
    { type: "other" },
    { type: TARGET_CHECK_TYPE, target: { kind: "other", value: "email" } },
    { type: TARGET_CHECK_TYPE, target: { kind: "field", value: 1 } },
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
    listener({ type: TARGET_CHECK_TYPE, target: { kind: "selector", value } }, {}, response);
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
