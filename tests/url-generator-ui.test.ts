// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAX_FIELDS, MAX_URL_LENGTH, parseAutofillUrl } from "../src/content/parser.ts";
import { setupUrlGenerator } from "../src/popup/components/url-generator.ts";
import { TARGET_CHECK_TYPE } from "../src/shared/target-check.ts";

const html = readFileSync("public/popup.html", "utf8");
const query = vi.fn();
const writeText = vi.fn();
const save = vi.fn();
const sendMessage = vi.fn();

function items(): HTMLFieldSetElement[] {
  return [...document.querySelectorAll<HTMLFieldSetElement>("[data-generator-item]")];
}
function input(id: string, index = 0): HTMLInputElement {
  if (["generator-method", "generator-target", "generator-value"].includes(id)) {
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
  input(id, index).dispatchEvent(
    new Event(id === "generator-method" ? "change" : "input", { bubbles: true }),
  );
}
async function setup(): Promise<void> {
  setupUrlGenerator();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.getElementById("settings")?.outerHTML ?? "";
  query.mockReset().mockResolvedValue([{ id: 7, url: "https://example.com/form?q=1#/settings" }]);
  writeText.mockReset().mockResolvedValue(undefined);
  save.mockReset();
  sendMessage.mockReset().mockResolvedValue({
    url: "https://example.com/form?q=1#/settings",
    status: "found",
  });
  vi.stubGlobal("chrome", { tabs: { query, sendMessage }, storage: { local: { set: save } } });
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

test("現在URLとサンプル値で生成し，自動入力の有効状態を参照せず保存もしない", async () => {
  await setup();
  expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  expect(input("generator-page-url").value).toBe("https://example.com/form?q=1#/settings");
  expect(generated()).toBe(
    "https://example.com/form?q=1#/settings#url-autofill:email=test%40example.com",
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
  expect(generated()).toBe("https://manual.example/form#url-autofill:email=test%40example.com");
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
  change("generator-method", "selector");
  change("generator-target", "[");
  resolveQuery([{ id: 7, url: "https://example.com/" }]);
  await pending;
  expect(error().hidden).toBe(false);
  expect(error().textContent).toContain("CSSセレクタの構文");
  expect(button().disabled).toBe(true);
});

test("指定方法を切り替えても各モードの入力を保持する", async () => {
  await setup();
  change("generator-target", "username");
  change("generator-method", "selector");
  expect(input("generator-target").value).toBe("#email");
  expect(items()[0].querySelector("[data-target-label]")?.textContent).toContain("CSSセレクタ");
  expect(generated()).toContain("fill(%23email)=test%40example.com");
  change("generator-target", ".contact-email");
  change("generator-method", "field");
  expect(input("generator-target").value).toBe("username");
  expect(generated()).toContain("username=test%40example.com");
  change("generator-method", "selector");
  expect(input("generator-target").value).toBe(".contact-email");
});

test("改行・空値をそのまま生成し，必須項目が無効ならコピーを止める", async () => {
  await setup();
  change("generator-value", "田中\n+ &");
  expect(generated()).toContain("%E7%94%B0%E4%B8%AD%0A%2B%20%26");
  change("generator-value", "");
  expect(generated().endsWith("email=")).toBe(true);
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
  change("generator-method", "selector");
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
});

test("項目の追加・編集で複数の指定方法と入力値をまとめて生成する", async () => {
  await setup();
  add();
  expect(items()).toHaveLength(2);
  expect(document.activeElement).toBe(input("generator-target", 1));
  expect(input("generator-target", 1).value).toBe("");
  expect(input("generator-value", 1).value).toBe("");
  expect(button().disabled).toBe(true);
  expect(error().textContent).toContain("項目2");
  change("generator-method", "selector", 1);
  change("generator-target", "#username", 1);
  change("generator-value", "田中\n+ &", 1);
  const entries = parseAutofillUrl(generated())?.entries;
  expect(entries).toEqual([
    { target: { kind: "field", value: "email" }, value: "test@example.com" },
    { target: { kind: "selector", value: "#username" }, value: "田中\n+ &" },
  ]);
  expect(button().disabled).toBe(false);
  button().click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(generated());
  expect(save).not.toHaveBeenCalled();
});

test("項目ごとに指定方法の入力を保持し，別項目を変更しない", async () => {
  await setup();
  add();
  change("generator-target", "username", 1);
  change("generator-value", "name", 1);
  change("generator-method", "selector", 1);
  change("generator-target", ".username", 1);
  change("generator-method", "field", 1);
  expect(input("generator-target", 1).value).toBe("username");
  change("generator-method", "selector", 1);
  expect(input("generator-target", 1).value).toBe(".username");
  expect(input("generator-value", 1).value).toBe("name");
  expect(input("generator-method").value).toBe("field");
  expect(input("generator-target").value).toBe("email");
  expect(input("generator-value").value).toBe("test@example.com");
});

test("無効なCSSや重複した指定先があれば全体のコピーを止め，修正すれば再開する", async () => {
  await setup();
  add();
  change("generator-target", "email", 1);
  expect(error().textContent).toContain("項目2：同じ指定先が重複");
  expect(generated()).toBe("");
  expect(button().disabled).toBe(true);
  change("generator-method", "selector", 1);
  change("generator-target", "[", 1);
  expect(error().textContent).toContain("項目2：CSSセレクタの構文");
  expect(input("generator-target", 1).getAttribute("aria-invalid")).toBe("true");
  change("generator-target", "#username", 1);
  expect(button().disabled).toBe(false);
  expect(error().hidden).toBe(true);
  expect(input("generator-target", 1).hasAttribute("aria-invalid")).toBe(false);
});

test("項目の削除でURLと番号を更新し，残った項目へのフォーカスとラベルを保つ", async () => {
  await setup();
  remove(0);
  expect(items()).toHaveLength(1);
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
    { target: { kind: "field", value: "username" }, value: "Tanaka" },
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
  change("generator-method", "selector");
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
