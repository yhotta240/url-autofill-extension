// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAX_URL_LENGTH } from "../src/content/parser.ts";
import { setupUrlGenerator } from "../src/popup/components/url-generator.ts";

const html = readFileSync("public/popup.html", "utf8");
const query = vi.fn();
const writeText = vi.fn();
const save = vi.fn();

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}
function output(): HTMLTextAreaElement {
  return document.getElementById("generator-result") as HTMLTextAreaElement;
}
function button(): HTMLButtonElement {
  return document.getElementById("generator-copy") as HTMLButtonElement;
}
function error(): HTMLElement {
  return document.getElementById("generator-error") as HTMLElement;
}
function change(id: string, value: string): void {
  input(id).value = value;
  input(id).dispatchEvent(
    new Event(id === "generator-method" ? "change" : "input", { bubbles: true }),
  );
}
async function setup(): Promise<void> {
  setupUrlGenerator();
  await Promise.resolve();
}

beforeEach(() => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.getElementById("settings")?.outerHTML ?? "";
  query.mockReset().mockResolvedValue([{ url: "https://example.com/form?q=1#/settings" }]);
  writeText.mockReset().mockResolvedValue(undefined);
  save.mockReset();
  vi.stubGlobal("chrome", { tabs: { query }, storage: { local: { set: save } } });
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("現在URLとサンプル値で生成し，自動入力の有効状態を参照せず保存もしない", async () => {
  await setup();
  expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  expect(input("generator-page-url").value).toBe("https://example.com/form?q=1#/settings");
  expect(output().value).toBe(
    "https://example.com/form?q=1#/settings#url-autofill:email=test%40example.com",
  );
  expect(output().readOnly).toBe(true);
  expect(button().disabled).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector("#url-generator a")).toBeNull();
  expect(document.body.textContent).toContain("実際の拡張機能による入力は行われません");
});

test.each([
  undefined,
  "chrome://settings/",
  "chrome-extension://example/popup.html",
])("現在URLを使えなければ空欄と手入力の案内を表示する: %s", async (url) => {
  query.mockResolvedValue([{ url }]);
  await setup();
  expect(input("generator-page-url").value).toBe("");
  expect(output().value).toBe("");
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
  expect(output().value).toBe("https://manual.example/form#url-autofill:email=test%40example.com");
  expect(document.getElementById("generator-source-status")?.textContent).toBe("");
  expect(button().disabled).toBe(false);
});

test("遅れて取得した現在URLで利用者の編集を上書きしない", async () => {
  let resolveQuery: (tabs: Array<{ url: string }>) => void = () => {};
  const pending = new Promise<Array<{ url: string }>>((resolve) => {
    resolveQuery = resolve;
  });
  query.mockReturnValue(pending);
  setupUrlGenerator();
  change("generator-page-url", "https://manual.example/form");
  resolveQuery([{ url: "https://late.example/" }]);
  await pending;
  expect(input("generator-page-url").value).toBe("https://manual.example/form");
  expect(output().value).toContain("https://manual.example/form#url-autofill:");
});

test("URLの取得が遅れても編集済みの指定欄のエラーを隠さない", async () => {
  let resolveQuery: (tabs: Array<{ url: string }>) => void = () => {};
  const pending = new Promise<Array<{ url: string }>>((resolve) => {
    resolveQuery = resolve;
  });
  query.mockReturnValue(pending);
  setupUrlGenerator();
  change("generator-method", "selector");
  change("generator-target", "[");
  resolveQuery([{ url: "https://example.com/" }]);
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
  expect(document.getElementById("generator-target-label")?.textContent).toContain("CSSセレクタ");
  expect(output().value).toContain("fill(%23email)=test%40example.com");
  change("generator-target", ".contact-email");
  change("generator-method", "field");
  expect(input("generator-target").value).toBe("username");
  expect(output().value).toContain("username=test%40example.com");
  change("generator-method", "selector");
  expect(input("generator-target").value).toBe(".contact-email");
});

test("改行・空値をそのまま生成し，必須項目が無効ならコピーを止める", async () => {
  await setup();
  change("generator-value", "田中\n+ &");
  expect(output().value).toContain("%E7%94%B0%E4%B8%AD%0A%2B%20%26");
  change("generator-value", "");
  expect(output().value.endsWith("email=")).toBe(true);
  change("generator-target", "");
  expect(output().value).toBe("");
  expect(button().disabled).toBe(true);
  expect(error().hidden).toBe(false);
  expect(input("generator-target").getAttribute("aria-invalid")).toBe("true");
  change("generator-target", "email");
  expect(button().disabled).toBe(false);
  expect(input("generator-target").hasAttribute("aria-invalid")).toBe(false);
  change("generator-page-url", "javascript:alert(1)");
  expect(output().value).toBe("");
  expect(button().disabled).toBe(true);
});

test("CSSは構文だけを検査し，対象がPopupに存在する必要はない", async () => {
  await setup();
  change("generator-method", "selector");
  change("generator-target", "[");
  expect(output().value).toBe("");
  expect(error().textContent).toContain("CSSセレクタの構文");
  expect(button().disabled).toBe(true);
  change("generator-target", "#not-in-this-popup");
  expect(button().disabled).toBe(false);
  expect(error().hidden).toBe(true);
});

test("生成URLの上限超過を画面へ表示する", async () => {
  await setup();
  change("generator-value", "a".repeat(MAX_URL_LENGTH));
  expect(output().value).toBe("");
  expect(error().textContent).toContain("上限");
  expect(button().disabled).toBe(true);
});

test("コピー操作と結果を表示し，入力が変わると結果表示をリセットする", async () => {
  await setup();
  const generated = output().value;
  button().click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(generated);
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
