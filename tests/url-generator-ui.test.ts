// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAX_FIELDS, MAX_URL_LENGTH, parseAutofillUrl } from "../src/content/parser.ts";
import { setupUrlGenerator } from "../src/popup/components/url-generator.ts";
import { FORM_CAPTURE_TYPE } from "../src/shared/form-capture.ts";
import type { RadioInfo } from "../src/shared/target-check.ts";
import { TARGET_CHECK_TYPE } from "../src/shared/target-check.ts";

const html = readFileSync("public/popup.html", "utf8");
const query = vi.fn();
const writeText = vi.fn();
const createTab = vi.fn();
const save = vi.fn();
const sendMessage = vi.fn();

function items(): HTMLFieldSetElement[] {
  return [...document.querySelectorAll<HTMLFieldSetElement>("[data-generator-item]")];
}
function input(id: string, index = 0): HTMLInputElement {
  if (["generator-target", "generator-value"].includes(id)) {
    return items()[index].querySelector(
      `[data-${id.slice("generator-".length)}]`,
    ) as HTMLInputElement;
  }
  return document.getElementById(id) as HTMLInputElement;
}
function add(): void {
  (document.getElementById("generator-add") as HTMLButtonElement).click();
}
function remove(index: number): void {
  items()[index].querySelector<HTMLButtonElement>("[data-remove]")?.click();
}
function output(): HTMLElement {
  return document.getElementById("generator-result") as HTMLElement;
}
function generated(): string {
  return output().textContent ?? "";
}
function button(): HTMLButtonElement {
  return document.getElementById("generator-copy") as HTMLButtonElement;
}
function error(): HTMLElement {
  return document.getElementById("generator-error") as HTMLElement;
}
function change(id: string, value: string, index = 0): void {
  input(id, index).value = value;
  input(id, index).dispatchEvent(new Event("input", { bubbles: true }));
}
function chooseValue(text: string, index = 0): void {
  const select = items()[index].querySelector<HTMLSelectElement>("[data-value-select]");
  const option = [...(select?.options ?? [])].find((option) => option.textContent === text);
  expect(option).toBeDefined();
  if (!select || !option) return;
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
async function setup(): Promise<void> {
  setupUrlGenerator();
  await Promise.resolve();
}

function radioResponse(radio: RadioInfo) {
  return { url: "https://example.com/form?q=1#/settings", status: "found", radio };
}
function currentValueResponse(currentValue: string) {
  return { url: "https://example.com/form?q=1#/settings", status: "found", currentValue };
}
const radioOptions = [
  { label: "プランA", value: "a", disabled: false },
  { label: "プランB", value: "b", disabled: false },
  { label: "無効", value: "c", disabled: true },
];
function radioSelect(index = 0): HTMLSelectElement {
  return items()[index].querySelector<HTMLSelectElement>(
    "[data-value-select]",
  ) as HTMLSelectElement;
}
function chooseRadio(value: string, index = 0): void {
  radioSelect(index).value = value;
  radioSelect(index).dispatchEvent(new Event("change", { bubbles: true }));
}

test("新しく単体ラジオを指定したときだけvalueを設定し，値だけを表示する", async () => {
  await setup();
  sendMessage.mockResolvedValue(radioResponse({ mode: "direct", group: "plan", value: "a" }));
  change("generator-target", "radio-a");
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").value).toBe("a");
  expect(input("generator-value").hidden).toBe(true);
  const output = items()[0].querySelector<HTMLOutputElement>("[data-radio-output]");
  expect(output?.hidden).toBe(false);
  expect(output?.textContent).toBe("a");
  expect(radioSelect().hidden).toBe(true);
  expect(parseAutofillUrl(generated())?.entries[0].value).toBe("a");

  sendMessage.mockResolvedValue({ url: "https://example.com/form?q=1#/settings", status: "found" });
  change("generator-target", "plain");
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").hidden).toBe(false);
  expect(input("generator-value").value).toBe("a");
});

test("グループの不一致値は未選択にし，選択後に生成を許可する", async () => {
  await setup();
  sendMessage.mockResolvedValue(
    radioResponse({ mode: "group", group: "plan", options: radioOptions }),
  );
  change("generator-target", "plan");
  await vi.advanceTimersByTimeAsync(300);
  expect(radioSelect().hidden).toBe(false);
  expect(radioSelect().value).toBe("");
  expect([...radioSelect().options].map((option) => option.textContent)).toEqual([
    "選択してください",
    "プランA",
    "プランB",
    "無効",
  ]);
  expect(radioSelect().options[3].disabled).toBe(true);
  expect(input("generator-value").value).toBe("test@example.com");
  expect(button().disabled).toBe(true);
  expect((document.getElementById("generator-save") as HTMLButtonElement).disabled).toBe(true);
  chooseRadio("1");
  expect(input("generator-value").value).toBe("b");
  expect(parseAutofillUrl(generated())?.entries[0].value).toBe("b");
  expect(button().disabled).toBe(false);
});

test.each([
  "",
  "legacy",
])("保存済みの単体ラジオ値は読み込み・再取得で書き換えない: %j", async (value) => {
  const generator = setupUrlGenerator();
  await Promise.resolve();
  sendMessage.mockResolvedValue(radioResponse({ mode: "direct", group: "plan", value: "a" }));
  generator?.edit({
    id: "saved",
    name: "保存",
    createdAt: 1,
    url: `https://example.com/form?q=1#/settings#url-autofill:fill(%23radio-a)=${value}`,
  });
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").value).toBe(value);
  expect(input("generator-value").hidden).toBe(false);
  input("generator-value").focus();
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").value).toBe(value);
  expect(parseAutofillUrl(generated())?.entries[0].value).toBe(value);
});

test.each(["", "b", "c"])("グループの保存値を復元し，空値と未選択を区別する: %j", async (value) => {
  const generator = setupUrlGenerator();
  await Promise.resolve();
  const options = [...radioOptions, { label: "空", value: "", disabled: false }];
  sendMessage.mockResolvedValue(radioResponse({ mode: "group", group: "plan", options }));
  generator?.edit({
    id: "saved",
    name: "保存",
    createdAt: 1,
    url: `https://example.com/form?q=1#/settings#url-autofill:fill(%23plan)=${value}`,
  });
  await vi.advanceTimersByTimeAsync(300);
  expect(radioSelect().value).toBe(String(options.findIndex((option) => option.value === value)));
  expect(input("generator-value").value).toBe(value);
  expect(button().disabled).toBe(value === "c");
});

test.each([
  ["direct-a", "direct-b"],
  ["group-a", "group-b"],
  ["direct-a", "group-b"],
])("同じラジオグループの重複選択を止める: %s / %s", async (first, second) => {
  await setup();
  sendMessage.mockImplementation(async (_tab, message) => {
    if (message.type !== TARGET_CHECK_TYPE)
      return { url: "https://example.com/form?q=1#/settings", candidates: [] };
    return radioResponse(
      message.selector.startsWith("direct")
        ? { mode: "direct", group: "plan", value: message.selector.endsWith("a") ? "a" : "b" }
        : { mode: "group", group: "plan", options: radioOptions },
    );
  });
  change("generator-target", first);
  await vi.advanceTimersByTimeAsync(300);
  if (first.startsWith("group")) chooseRadio("0");
  add();
  change("generator-target", second, 1);
  await vi.advanceTimersByTimeAsync(300);
  if (second.startsWith("group")) chooseRadio("1", 1);
  expect(error().textContent).toContain("同じラジオグループ");
  expect(button().disabled).toBe(true);
  remove(1);
  expect(button().disabled).toBe(false);
});

test("別フォームのラジオと単体の解除は同じグループとの選択競合にしない", async () => {
  const generator = setupUrlGenerator();
  await Promise.resolve();
  sendMessage.mockImplementation(async (_tab, message) =>
    radioResponse({
      mode: "direct",
      group: message.selector === "#other" ? "other-form" : "plan",
      value: "a",
    }),
  );
  generator?.edit({
    id: "saved",
    name: "保存",
    createdAt: 1,
    url: "https://example.com/form?q=1#/settings#url-autofill:fill(%23clear)=&fill(%23select)=a&fill(%23other)=a",
  });
  await vi.advanceTimersByTimeAsync(300);
  expect(button().disabled).toBe(false);
  expect(parseAutofillUrl(generated())?.entries.map((entry) => entry.value)).toEqual([
    "",
    "a",
    "a",
  ]);
});

test("再取得は値・フォーカス・コントロールを維持し，選択肢だけ更新する", async () => {
  await setup();
  sendMessage.mockResolvedValue(
    radioResponse({ mode: "group", group: "plan", options: radioOptions }),
  );
  change("generator-target", "plan");
  await vi.advanceTimersByTimeAsync(300);
  chooseRadio("1");
  const select = radioSelect();
  const selectedOption = select.options[2];
  select.focus();
  await vi.advanceTimersByTimeAsync(300);
  expect(select.options[2]).toBe(selectedOption);
  expect(document.activeElement).toBe(select);
  expect(input("generator-value").value).toBe("b");
  select.blur();
  sendMessage.mockResolvedValue(
    radioResponse({ mode: "group", group: "plan", options: radioOptions.slice(0, 1) }),
  );
  select.focus();
  await vi.advanceTimersByTimeAsync(300);
  expect(radioSelect()).toBe(select);
  expect(document.activeElement).toBe(select);
  expect(input("generator-value").value).toBe("b");
  expect(select.value).toBe("");
  expect(button().disabled).toBe(true);
});

test("不正なグループを拒否し，取得失敗時は値を保持して自由入力へ戻す", async () => {
  await setup();
  sendMessage.mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "invalid-radio-group",
  });
  change("generator-target", "mixed");
  await vi.advanceTimersByTimeAsync(300);
  expect(button().disabled).toBe(true);
  expect(error().textContent).toContain("同じグループ");
  sendMessage.mockRejectedValue(new Error("unavailable"));
  input("generator-value").focus();
  await vi.advanceTimersByTimeAsync(300);
  expect(button().disabled).toBe(false);
  expect(input("generator-value").hidden).toBe(false);
  expect(input("generator-value").value).toBe("test@example.com");
});

beforeEach(() => {
  vi.useFakeTimers();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.getElementById("settings")?.outerHTML ?? "";
  query.mockReset().mockResolvedValue([{ id: 7, url: "https://example.com/form?q=1#/settings" }]);
  writeText.mockReset().mockResolvedValue(undefined);
  createTab.mockReset().mockResolvedValue({});
  save.mockReset();
  sendMessage.mockReset().mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "found",
  });
  vi.stubGlobal("chrome", {
    tabs: {
      query,
      create: createTab,
      sendMessage: (tab: number, message: { type: string }, options: unknown) =>
        message.type === FORM_CAPTURE_TYPE
          ? Promise.resolve({ url: "https://example.com/form?q=1#/settings", forms: [] })
          : sendMessage(tab, message, options),
    },
    storage: { local: { set: save } },
  });
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

test("共通オプションの方式をURLへ反映し，テストボタンだけ対象に応じて隠す", async () => {
  await setup();
  sendMessage.mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "found",
    targetInfo: { label: "本文", type: "contenteditable" },
  });
  change("generator-target", "#editor");
  await vi.advanceTimersByTimeAsync(300);
  const container = items()[0].querySelector<HTMLElement>("[data-editable-input]");
  const select = document.querySelector<HTMLSelectElement>("#generator-input-method");
  const testButton = items()[0].querySelector<HTMLButtonElement>("[data-input-test]");
  const hint = document.getElementById("generator-clipboard-hint");
  expect(container?.hidden).toBe(false);
  if (!select) throw new Error("method missing");
  expect(select.value).toBe("clipboard-paste");
  expect(testButton?.hidden).toBe(false);
  expect(hint?.hidden).toBe(false);
  select.value = "insert-text";
  select.dispatchEvent(new Event("change"));
  expect(parseAutofillUrl(generated())?.method).toBe("insert-text");
  expect(hint?.hidden).toBe(true);
  sendMessage.mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "found",
    targetInfo: { label: "名前", type: "text" },
  });
  change("generator-target", "#name");
  expect(testButton?.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(300);
  expect(testButton?.hidden).toBe(true);
  expect(select.value).toBe("insert-text");
  expect(parseAutofillUrl(generated())?.method).toBe("insert-text");
});

test("保存URLを編集すると入力方式も復元する", async () => {
  const generator = setupUrlGenerator();
  await Promise.resolve();
  sendMessage.mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "found",
    targetInfo: { label: "本文", type: "contenteditable" },
  });
  expect(
    generator?.edit({
      id: "method-test",
      name: "テスト",
      createdAt: 1,
      url: "https://example.com/form?q=1#/settings#url-autofill:method=paste-event&fill(%23editor)=test",
    }),
  ).toBe(true);
  await vi.advanceTimersByTimeAsync(300);
  expect(document.querySelector<HTMLSelectElement>("#generator-input-method")?.value).toBe(
    "paste-event",
  );
  expect(parseAutofillUrl(generated())?.method).toBe("paste-event");
});

test("新しい項目の空欄に現在値を取り込み，生成URLにも反映する", async () => {
  await setup();
  sendMessage.mockResolvedValue(currentValueResponse("田中\n太郎"));
  add();
  change("generator-target", "#name", 1);
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).toHaveBeenCalledWith(
    7,
    {
      type: TARGET_CHECK_TYPE,
      selector: "#name",
      includeCurrentValue: true,
    },
    { frameId: 0 },
  );
  expect(input("generator-value", 1).value).toBe("田中\n太郎");
  expect(parseAutofillUrl(generated())?.entries[1].value).toBe("田中\n太郎");
  expect(input("generator-value").value).toBe("test@example.com");
});

test("入力済みの値は現在値で上書きせず，取得も要求しない", async () => {
  await setup();
  sendMessage.mockResolvedValue(currentValueResponse("ページの値"));
  change("generator-value", "手入力");
  change("generator-target", "#name");
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").value).toBe("手入力");
  const request = sendMessage.mock.calls.find(([, message]) => message.selector === "#name")?.[1];
  expect(request).not.toHaveProperty("includeCurrentValue");
});

test.each([
  "手入力",
  "",
])("問い合わせ中に編集した値は，空欄でも上書きしない: %j", async (edited) => {
  await setup();
  let reply: (response: unknown) => void = () => {};
  sendMessage.mockImplementation((_tab, message) =>
    message.selector === "#name"
      ? new Promise((resolve) => {
          reply = resolve;
        })
      : Promise.resolve(currentValueResponse("")),
  );
  add();
  change("generator-target", "#name", 1);
  await vi.advanceTimersByTimeAsync(300);
  change("generator-value", edited, 1);
  reply(currentValueResponse("ページの値"));
  await Promise.resolve();
  expect(input("generator-value", 1).value).toBe(edited);
});

test("保存URLの空値は初回確認でも維持する", async () => {
  const generator = setupUrlGenerator();
  await Promise.resolve();
  sendMessage.mockResolvedValue(currentValueResponse("ページの値"));
  generator?.edit({
    id: "saved",
    name: "空値",
    createdAt: 1,
    url: "https://example.com/form?q=1#/settings#url-autofill:fill(%23name)=",
  });
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").value).toBe("");
  const request = sendMessage.mock.calls.find(([, message]) => message.selector === "#name")?.[1];
  expect(request).not.toHaveProperty("includeCurrentValue");
});

test("取り込み後に消した値は再フォーカスで戻さず，セレクタの再選択では取得できる", async () => {
  await setup();
  sendMessage.mockResolvedValue(currentValueResponse("ページの値"));
  add();
  change("generator-target", "#name", 1);
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value", 1).value).toBe("ページの値");
  change("generator-value", "", 1);
  input("generator-value", 1).focus();
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value", 1).value).toBe("");
  change("generator-target", "#name", 1);
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value", 1).value).toBe("ページの値");
});

test.each([
  { currentValue: "true", valueInput: { kind: "checkbox" }, selected: "チェックする" },
  {
    currentValue: "b",
    valueInput: { kind: "select", options: [{ label: "B", value: "b", disabled: false }] },
    selected: "B",
  },
  {
    currentValue: "b",
    radio: { mode: "group", group: "plan", options: [{ label: "B", value: "b", disabled: false }] },
    selected: "B",
  },
])("現在の選択状態を入力UIにも反映する: %j", async ({ selected, ...info }) => {
  await setup();
  sendMessage.mockResolvedValue({ ...currentValueResponse(info.currentValue), ...info });
  add();
  change("generator-target", "#choice", 1);
  await vi.advanceTimersByTimeAsync(300);
  const select = items()[1].querySelector<HTMLSelectElement>("[data-value-select]");
  expect(select?.selectedOptions[0].textContent).toBe(selected);
  expect(input("generator-value", 1).value).toBe(info.currentValue);
});

test("未選択の単体ラジオは定義値で選択済みにしない", async () => {
  await setup();
  sendMessage.mockResolvedValue({
    ...currentValueResponse(""),
    radio: { mode: "direct", value: "b" },
  });
  add();
  change("generator-target", "#radio", 1);
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value", 1).value).toBe("");
  expect(parseAutofillUrl(generated())?.entries[1].value).toBe("");
});

test("現在URLとサンプル値で生成し，自動入力の有効状態を参照せず保存もしない", async () => {
  await setup();
  expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  expect(input("generator-page-url").value).toBe("https://example.com/form?q=1#/settings");
  expect(generated()).toBe(
    "https://example.com/form?q=1#/settings#url-autofill:fill(%23email)=test%40example.com",
  );
  expect(output().tagName).toBe("CODE");
  expect(output().closest("pre")?.getAttribute("tabindex")).toBe("0");
  expect(button().form).toBe(document.getElementById("url-generator"));
  expect(button().disabled).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector("#url-generator a")).toBeNull();
});

test.each([
  undefined,
  "chrome://settings/",
  "chrome-extension://example/popup.html",
])("現在URLを使えなければ空欄と手入力の案内を表示する: %s", async (url) => {
  query.mockResolvedValue([{ url }]);
  await setup();
  expect(input("generator-page-url").value).toBe("");
  expect(generated()).toBe("");
  expect(button().disabled).toBe(true);
  expect(document.getElementById("generator-source-status")?.textContent).toContain(
    "入力してください",
  );
  expect(error().hidden).toBe(true);
});

test("タブ取得に失敗しても手入力で利用できる", async () => {
  query.mockRejectedValue(new Error("unavailable"));
  await setup();
  change("generator-page-url", "https://manual.example/form");
  expect(generated()).toBe(
    "https://manual.example/form#url-autofill:fill(%23email)=test%40example.com",
  );
  expect(document.getElementById("generator-source-status")?.textContent).toBe("");
  expect(button().disabled).toBe(false);
});

test("遅れて取得した現在URLで利用者の編集を上書きしない", async () => {
  let resolveQuery: (tabs: Array<{ id: number; url: string }>) => void = () => {};
  const pending = new Promise<Array<{ id: number; url: string }>>((resolve) => {
    resolveQuery = resolve;
  });
  query.mockReturnValue(pending);
  setupUrlGenerator();
  change("generator-page-url", "https://manual.example/form");
  resolveQuery([{ id: 7, url: "https://late.example/" }]);
  await pending;
  expect(input("generator-page-url").value).toBe("https://manual.example/form");
  expect(generated()).toContain("https://manual.example/form#url-autofill:");
});

test("URLの取得が遅れても編集済みの指定欄のエラーを隠さない", async () => {
  let resolveQuery: (tabs: Array<{ id: number; url: string }>) => void = () => {};
  const pending = new Promise<Array<{ id: number; url: string }>>((resolve) => {
    resolveQuery = resolve;
  });
  query.mockReturnValue(pending);
  setupUrlGenerator();
  change("generator-target", "[");
  resolveQuery([{ id: 7, url: "https://example.com/" }]);
  await pending;
  expect(error().hidden).toBe(false);
  expect(error().textContent).toContain("CSSセレクタの構文");
  expect(button().disabled).toBe(true);
});

test("改行・空値をそのまま生成し，必須項目が無効ならコピーを止める", async () => {
  await setup();
  change("generator-value", "田中\n+ &");
  expect(generated()).toContain("%E7%94%B0%E4%B8%AD%0A%2B%20%26");
  change("generator-value", "");
  expect(generated().endsWith("fill(%23email)=")).toBe(true);
  change("generator-target", "");
  expect(generated()).toBe("");
  expect(button().disabled).toBe(true);
  expect(error().hidden).toBe(false);
  expect(input("generator-target").getAttribute("aria-invalid")).toBe("true");
  change("generator-target", "email");
  expect(button().disabled).toBe(false);
  expect(input("generator-target").hasAttribute("aria-invalid")).toBe(false);
  change("generator-page-url", "javascript:alert(1)");
  expect(generated()).toBe("");
  expect(button().disabled).toBe(true);
});

test("CSSは構文だけを検査し，対象がPopupに存在する必要はない", async () => {
  await setup();
  change("generator-target", "[");
  expect(generated()).toBe("");
  expect(error().textContent).toContain("CSSセレクタの構文");
  expect(button().disabled).toBe(true);
  change("generator-target", "#not-in-this-popup");
  expect(button().disabled).toBe(false);
  expect(error().hidden).toBe(true);
});

test("生成URLの上限超過を画面へ表示する", async () => {
  await setup();
  change("generator-value", "a".repeat(MAX_URL_LENGTH));
  expect(generated()).toBe("");
  expect(error().textContent).toContain("上限");
  expect(button().disabled).toBe(true);
});

test("コピー操作と結果を表示し，入力が変わると結果表示をリセットする", async () => {
  await setup();
  const copiedUrl = generated();
  button().click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(copiedUrl);
  expect(document.getElementById("generator-copy-status")?.textContent).toBe("コピーしました．");
  change("generator-value", "other");
  expect(document.getElementById("generator-copy-status")?.textContent).toBe("");
});

test("折り返しの切り替えは生成URLとコピー結果を変えない", async () => {
  await setup();
  const before = generated();
  button().click();
  await Promise.resolve();
  const wrap = document.getElementById("generator-wrap") as HTMLButtonElement;
  const code = document.getElementById("generator-code");
  expect(wrap.getAttribute("aria-pressed")).toBe("false");
  expect(wrap.classList.contains("active")).toBe(false);
  expect(wrap.title).toBe("折り返しをオンにする");
  expect(code?.classList.contains("is-nowrap")).toBe(true);
  wrap.click();
  expect(wrap.getAttribute("aria-pressed")).toBe("true");
  expect(wrap.classList.contains("active")).toBe(true);
  expect(wrap.title).toBe("折り返しをオフにする");
  expect(code?.classList.contains("is-nowrap")).toBe(false);
  expect(generated()).toBe(before);
  expect(document.getElementById("generator-copy-status")?.textContent).toBe("コピーしました．");
  change("generator-value", "edited");
  expect(wrap.getAttribute("aria-pressed")).toBe("true");
  wrap.click();
  expect(wrap.getAttribute("aria-pressed")).toBe("false");
  expect(wrap.classList.contains("active")).toBe(false);
  expect(code?.classList.contains("is-nowrap")).toBe(true);
  expect(createTab).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test("生成したURLを新しいタブで開き，無効な入力時には開かない", async () => {
  await setup();
  const open = document.getElementById("generator-open") as HTMLButtonElement;
  const url = generated();
  expect(open.disabled).toBe(false);
  open.click();
  open.click();
  await Promise.resolve();
  expect(createTab).toHaveBeenCalledExactlyOnceWith({ url });
  expect(open.disabled).toBe(false);
  expect(writeText).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  change("generator-page-url", "javascript:alert(1)");
  expect(open.disabled).toBe(true);
  open.click();
  expect(createTab).toHaveBeenCalledTimes(1);
  change("generator-page-url", "https://example.com/form");
  expect(open.disabled).toBe(false);
});

test("タブ作成に失敗した場合は再試行でき，編集でエラー表示を消す", async () => {
  await setup();
  const open = document.getElementById("generator-open") as HTMLButtonElement;
  createTab.mockRejectedValueOnce(new Error("denied"));
  open.click();
  await Promise.resolve();
  expect(document.getElementById("generator-open-status")?.textContent).toBe(
    "ページを開けませんでした．",
  );
  expect(open.disabled).toBe(false);
  change("generator-value", "edited");
  expect(document.getElementById("generator-open-status")?.textContent).toBe("");
  open.click();
  await Promise.resolve();
  expect(createTab).toHaveBeenLastCalledWith({ url: generated() });
});

test("タブ作成待機中の編集後は古い失敗表示を出さず，入力の無効状態を維持する", async () => {
  await setup();
  let rejectOpen: (reason: Error) => void = () => {};
  createTab.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectOpen = reject;
    }),
  );
  const open = document.getElementById("generator-open") as HTMLButtonElement;
  open.click();
  change("generator-value", "edited");
  expect(open.disabled).toBe(true);
  change("generator-page-url", "");
  rejectOpen(new Error("denied"));
  await Promise.resolve();
  expect(document.getElementById("generator-open-status")?.textContent).toBe("");
  expect(open.disabled).toBe(true);
});

test("コピー拒否時には手動コピーを案内し，例外をログへ出さない", async () => {
  const logError = vi.spyOn(console, "error").mockImplementation(() => {});
  writeText.mockRejectedValue(new Error("denied"));
  await setup();
  button().click();
  await Promise.resolve();
  expect(document.getElementById("generator-copy-status")?.textContent).toContain(
    "生成URLを選択してコピー",
  );
  expect(button().disabled).toBe(false);
  expect(logError).not.toHaveBeenCalled();
});

test("コピー待機中に編集した場合は古い成功表示を出さない", async () => {
  let resolveCopy: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    resolveCopy = resolve;
  });
  writeText.mockReturnValue(pending);
  await setup();
  button().click();
  change("generator-value", "new");
  resolveCopy();
  await pending;
  expect(document.getElementById("generator-copy-status")?.textContent).toBe("");
});

test("Enterによるsubmitを止め，コピーやページ遷移を実行しない", async () => {
  await setup();
  const form = document.getElementById("url-generator");
  const event = new Event("submit", { cancelable: true });
  form?.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(writeText).not.toHaveBeenCalled();
  expect(createTab).not.toHaveBeenCalled();
});

test("項目の追加・編集で複数のセレクタと入力値をまとめて生成する", async () => {
  await setup();
  add();
  expect(items()).toHaveLength(2);
  expect(document.activeElement).toBe(input("generator-target", 1));
  expect(input("generator-target", 1).value).toBe("");
  expect(input("generator-value", 1).value).toBe("");
  expect(button().disabled).toBe(true);
  expect(error().textContent).toContain("項目2");
  change("generator-target", "#username", 1);
  change("generator-value", "田中\n+ &", 1);
  const entries = parseAutofillUrl(generated())?.entries;
  expect(entries).toEqual([
    { selector: "#email", value: "test@example.com" },
    { selector: "#username", value: "田中\n+ &" },
  ]);
  expect(button().disabled).toBe(false);
  button().click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(generated());
  expect(save).not.toHaveBeenCalled();
});

test("無効なCSSや重複した指定先があれば全体のコピーを止め，修正すれば再開する", async () => {
  await setup();
  add();
  change("generator-target", "#email", 1);
  expect(error().textContent).toContain("項目2：同じ指定先が重複");
  expect(generated()).toBe("");
  expect(button().disabled).toBe(true);
  change("generator-target", "[", 1);
  expect(error().textContent).toContain("項目2：CSSセレクタの構文");
  expect(input("generator-target", 1).getAttribute("aria-invalid")).toBe("true");
  change("generator-target", "#username", 1);
  expect(button().disabled).toBe(false);
  expect(error().hidden).toBe(true);
  expect(input("generator-target", 1).hasAttribute("aria-invalid")).toBe(false);
});

test("項目を0件まで削除でき，番号・フォーカス・再追加後の生成を保つ", async () => {
  await setup();
  add();
  change("generator-target", "username", 1);
  change("generator-value", "Tanaka", 1);
  const remainingTarget = input("generator-target", 1);
  remove(0);
  expect(items()).toHaveLength(1);
  expect(items()[0].querySelector("legend")?.textContent).toBe("項目1");
  expect(items()[0].querySelector("[data-remove]")?.getAttribute("aria-label")).toBe("項目1を削除");
  expect(document.activeElement).toBe(remainingTarget);
  expect(parseAutofillUrl(generated())?.entries).toEqual([
    { selector: "username", value: "Tanaka" },
  ]);
  add();
  const ids = [...document.querySelectorAll("#generator-items [id]")].map((control) => control.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const label of document.querySelectorAll<HTMLLabelElement>("#generator-items label")) {
    expect(label.control?.closest("fieldset")).toBe(label.closest("fieldset"));
  }
  remove(1);
  expect(button().disabled).toBe(false);
  expect(document.activeElement).toBe(remainingTarget);
  remove(0);
  expect(items()).toHaveLength(0);
  expect(document.getElementById("generator-item-count")?.textContent).toBe(
    `0 / ${MAX_FIELDS}項目`,
  );
  expect(generated()).toBe("");
  expect(error().hidden).toBe(false);
  expect(error().textContent).toContain("入力項目は1件以上");
  for (const id of ["generator-copy", "generator-open", "generator-save"]) {
    expect((document.getElementById(id) as HTMLButtonElement).disabled).toBe(true);
  }
  expect(document.activeElement).toBe(document.getElementById("generator-add"));
  add();
  change("generator-target", "#name");
  expect(error().hidden).toBe(true);
  expect(button().disabled).toBe(false);
});

test("上限件数で追加を止め，削除すると再び追加できる", async () => {
  await setup();
  for (let index = 1; index < MAX_FIELDS; index += 1) add();
  expect(items()).toHaveLength(MAX_FIELDS);
  const addButton = document.getElementById("generator-add") as HTMLButtonElement;
  expect(addButton.disabled).toBe(true);
  expect(document.getElementById("generator-item-count")?.textContent).toBe(
    `${MAX_FIELDS} / ${MAX_FIELDS}項目`,
  );
  add();
  expect(items()).toHaveLength(MAX_FIELDS);
  remove(MAX_FIELDS - 1);
  expect(addButton.disabled).toBe(false);
  add();
  expect(items()).toHaveLength(MAX_FIELDS);
});

test("コピー待機中の項目追加・削除でも古い成功表示を出さない", async () => {
  let resolveCopy: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    resolveCopy = resolve;
  });
  writeText.mockReturnValue(pending);
  await setup();
  button().click();
  add();
  remove(1);
  resolveCopy();
  await pending;
  expect(document.getElementById("generator-copy-status")?.textContent).toBe("");
});

test("現在ページでの確認結果を表示し，値の編集や確認失敗ではURL生成を妨げない", async () => {
  vi.useFakeTimers();
  query.mockResolvedValue([{ id: 7, url: "https://example.com/form?q=1#/settings" }]);
  await setup();
  const status = items()[0].querySelector<HTMLElement>("[data-target-status]");
  expect(input("generator-target").getAttribute("aria-describedby")).toContain(status?.id);
  await vi.advanceTimersByTimeAsync(300);
  expect(status?.textContent).toBe("見つかりました");
  expect(sendMessage).toHaveBeenCalledTimes(1);

  change("generator-value", "edited");
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).toHaveBeenCalledTimes(1);

  sendMessage.mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "missing",
  });
  change("generator-target", "#missing");
  await vi.advanceTimersByTimeAsync(300);
  expect(status?.textContent).toBe("現在のページでは見つかりません");
  expect(button().disabled).toBe(false);
  expect(generated()).toContain("fill(%23missing)=edited");
  expect(save).not.toHaveBeenCalled();

  change("generator-page-url", "https://other.example/form");
  await vi.advanceTimersByTimeAsync(300);
  expect(status?.textContent).toBe("現在のページとURLが異なるため確認できません");
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(button().disabled).toBe(false);
});

test("確認待ちの項目を削除すると問い合わせを止め，他の項目の結果を維持する", async () => {
  vi.useFakeTimers();
  query.mockResolvedValue([{ id: 7, url: "https://example.com/form?q=1#/settings" }]);
  await setup();
  await vi.advanceTimersByTimeAsync(300);
  add();
  change("generator-target", "username", 1);
  remove(1);
  await vi.advanceTimersByTimeAsync(300);
  expect(
    sendMessage.mock.calls.filter(([, message]) => message.type === TARGET_CHECK_TYPE),
  ).toHaveLength(1);
  expect(items()[0].querySelector("[data-target-status]")?.textContent).toBe("見つかりました");
  change("generator-target", "");
  expect(items()[0].querySelector<HTMLElement>("[data-target-status]")?.hidden).toBe(true);
});

test("チェックボックスの表示切替は生成URLやコピー結果を変えず，選択変更だけを反映する", async () => {
  sendMessage.mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "found",
    valueInput: { kind: "checkbox" },
  });
  await setup();
  change("generator-target", "agree");
  change("generator-value", "1");
  const before = generated();
  button().click();
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").value).toBe("1");
  expect(input("generator-value").hidden).toBe(true);
  expect(generated()).toBe(before);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(before);
  expect(document.getElementById("generator-copy-status")?.textContent).toBe("コピーしました．");
  chooseValue("外す");
  expect(parseAutofillUrl(generated())?.entries[0].value).toBe("false");
  expect(document.getElementById("generator-copy-status")?.textContent).toBe("");
});

test("チェックボックスの不正値は未選択にし，選ぶまでコピー・保存を止める", async () => {
  sendMessage.mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "found",
    valueInput: { kind: "checkbox" },
  });
  await setup();
  change("generator-target", "agree");
  await vi.advanceTimersByTimeAsync(300);
  const select = items()[0].querySelector<HTMLSelectElement>("[data-value-select]");
  expect(select?.selectedOptions[0].textContent).toBe("選択してください");
  expect(input("generator-value").value).toBe("test@example.com");
  expect(generated()).toBe("");
  expect(button().disabled).toBe(true);
  const saveButton = document.getElementById("generator-save") as HTMLButtonElement;
  expect(saveButton.disabled).toBe(true);
  chooseValue("チェックする");
  expect(button().disabled).toBe(false);
  expect(saveButton.disabled).toBe(false);
  expect(parseAutofillUrl(generated())?.entries[0].value).toBe("true");
});

test.each([
  "a&b",
  "",
])("保存URLの各入力値を，UI情報の取得後もそのまま復元する（ラジオ=%s）", async (radioValue) => {
  const url = "https://example.com/form?q=1#/settings";
  sendMessage.mockImplementation((_id, message) =>
    Promise.resolve({
      url,
      status: "found",
      ...(message.selector === "#radio"
        ? { radio: { mode: "direct", value: "a&b" } }
        : {
            valueInput:
              message.selector === "#agree"
                ? { kind: "checkbox" }
                : { kind: "select", options: [{ label: "プランA", value: "a", disabled: false }] },
          }),
    }),
  );
  const generator = setupUrlGenerator();
  await Promise.resolve();
  const savedUrl = `${url}#url-autofill:fill(%23agree)=1&fill(%23plan)=future%0Avalue&fill(%23radio)=${encodeURIComponent(radioValue)}`;
  expect(generator?.edit({ id: "saved", name: "保存済み", url: savedUrl, createdAt: 1 })).toBe(
    true,
  );
  await vi.advanceTimersByTimeAsync(300);
  expect(items().map((_, index) => input("generator-value", index).value)).toEqual([
    "1",
    "future\nvalue",
    radioValue,
  ]);
  expect(input("generator-value", 0).hidden).toBe(true);
  expect(input("generator-value", 1).hidden).toBe(true);
  const unknown =
    items()[1].querySelector<HTMLSelectElement>("[data-value-select]")?.selectedOptions[0];
  expect(unknown?.textContent).toBe("選択してください");
  expect(unknown?.disabled).toBe(true);
  expect(input("generator-value", 2).hidden).toBe(radioValue !== "");
  const radio = items()[2].querySelector<HTMLOutputElement>("[data-radio-output]");
  expect(radio?.hidden).toBe(radioValue === "");
  expect(generated()).toBe("");
  expect(button().disabled).toBe(true);
  expect((document.getElementById("generator-save") as HTMLButtonElement).disabled).toBe(true);
  chooseValue("プランA", 1);
  expect(button().disabled).toBe(false);
  expect(generated()).toBe(savedUrl.replace("fill(%23plan)=future%0Avalue", "fill(%23plan)=a"));
  expect(save).not.toHaveBeenCalled();
});

test("フォーカスで選択肢を再取得し，入力先を変えても値を保持する", async () => {
  const response = {
    url: "https://example.com/form?q=1#/settings",
    status: "found",
    valueInput: { kind: "select", options: [{ label: "A", value: "a", disabled: false }] },
  };
  sendMessage.mockResolvedValue(response);
  await setup();
  change("generator-target", "plan");
  change("generator-value", "a");
  await vi.advanceTimersByTimeAsync(300);
  const select = items()[0].querySelector<HTMLSelectElement>("[data-value-select]");
  expect(select).not.toBeNull();
  const before = generated();
  response.valueInput.options.push({ label: "B", value: "b", disabled: false });
  select?.focus();
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect([...(select?.options ?? [])].map((option) => option.textContent)).toContain("B");
  expect(document.activeElement).toBe(select);
  expect(generated()).toBe(before);
  expect([...(select?.options ?? [])].some((option) => option.textContent === "手入力")).toBe(
    false,
  );
  change("generator-target", "#plan");
  expect(input("generator-value").hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").hidden).toBe(true);
  expect(input("generator-value").value).toBe("a");
});

test("古い入力先の情報やページ変更を反映せず，取得失敗でも入力値とURLを保持する", async () => {
  const url = "https://example.com/form?q=1#/settings";
  let oldReply!: (response: unknown) => void;
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      oldReply = resolve;
    }),
  );
  const generator = setupUrlGenerator();
  await Promise.resolve();
  change("generator-target", "agree");
  change("generator-value", "a");
  await vi.advanceTimersByTimeAsync(300);
  sendMessage.mockResolvedValue({
    url,
    status: "found",
    valueInput: { kind: "select", options: [{ label: "A", value: "a", disabled: false }] },
  });
  change("generator-target", "plan");
  await vi.advanceTimersByTimeAsync(300);
  oldReply({ url, status: "found", valueInput: { kind: "checkbox" } });
  await Promise.resolve();
  const select = items()[0].querySelector<HTMLSelectElement>("[data-value-select]");
  expect(select?.selectedOptions[0].textContent).toBe("A");
  const before = generated();
  generator?.updateCurrentPage({ tabId: 8, url });
  expect(input("generator-value").hidden).toBe(false);
  sendMessage.mockRejectedValue(new Error("no receiver"));
  await vi.advanceTimersByTimeAsync(300);
  expect(input("generator-value").value).toBe("a");
  expect(select?.hidden).toBe(true);
  expect(generated()).toBe(before);
  expect(button().disabled).toBe(false);
});
