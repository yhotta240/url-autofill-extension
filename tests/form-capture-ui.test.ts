// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FillEntry, MAX_FIELDS, parseAutofillUrl } from "../src/content/parser.ts";
import { setupUrlGenerator } from "../src/popup/components/url-generator.ts";
import { FORM_CAPTURE_TYPE } from "../src/shared/form-capture.ts";

const html = readFileSync("public/popup.html", "utf8");
const url = "https://example.com/form?q=1";
const page = { tabId: 7, url };
const sendMessage = vi.fn();
let forms: Array<{ selector: string; label: string }>;
let captured: FillEntry[];

function field<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
const button = () => field<HTMLButtonElement>("generator-capture");
const scope = () => field<HTMLSelectElement>("generator-capture-scope");
const status = () => field("generator-capture-status").textContent;
const items = () => [...document.querySelectorAll<HTMLFieldSetElement>("[data-generator-item]")];
function entries(): FillEntry[] {
  return items().map((item) => ({
    target: {
      kind:
        item.querySelector<HTMLSelectElement>("[data-method]")?.value === "selector"
          ? "selector"
          : "field",
      value: item.querySelector<HTMLInputElement>("[data-target]")?.value ?? "",
    },
    value: item.querySelector<HTMLTextAreaElement>("[data-value]")?.value ?? "",
  }));
}
function editValue(value: string): void {
  const control = items()[0].querySelector<HTMLTextAreaElement>("[data-value]");
  if (control) {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
const flush = () => vi.advanceTimersByTimeAsync(0);
async function setup() {
  const generator = setupUrlGenerator(document, { currentPage: Promise.resolve(page) });
  await flush();
  return generator;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    new DOMParser().parseFromString(html, "text/html").getElementById("settings")?.outerHTML ?? "";
  forms = [{ selector: "#form", label: "フォーム1（#form）" }];
  captured = [{ target: { kind: "selector", value: "#form #email" }, value: "current" }];
  sendMessage.mockReset().mockImplementation(async (_tab, message) => {
    if (message.type !== FORM_CAPTURE_TYPE) return { url, status: "found" };
    return message.action === "forms"
      ? { url, forms }
      : { url, entries: captured, duplicates: 0, skipped: 0 };
  });
  vi.stubGlobal("chrome", { tabs: { sendMessage } });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("一覧取得だけでは値を要求せず，初期サンプルは取り込み成功時に置き換える", async () => {
  await setup();
  expect(scope().value).toBe("");
  expect([...scope().options].map((option) => option.textContent)).toEqual([
    "ページ全体",
    "フォーム1（#form）",
  ]);
  expect(sendMessage.mock.calls.filter(([, message]) => message.action === "capture")).toHaveLength(
    0,
  );
  button().click();
  await flush();
  expect(sendMessage).toHaveBeenCalledWith(
    7,
    { type: FORM_CAPTURE_TYPE, action: "capture", scope: null, existing: [] },
    { frameId: 0 },
  );
  expect(entries()).toEqual(captured);
  expect(parseAutofillUrl(field("generator-result").textContent ?? "")?.entries).toEqual(captured);
  expect(status()).toContain("1件追加");
});

test("編集した項目を保持して追加し，フォーム選択と再取得で候補を更新する", async () => {
  await setup();
  editValue("手動の値");
  scope().value = "#form";
  scope().dispatchEvent(new Event("change"));
  button().click();
  await flush();
  expect(sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({
      action: "capture",
      scope: "#form",
      existing: [{ kind: "field", value: "email" }],
    }),
    { frameId: 0 },
  );
  expect(entries().map((entry) => entry.value)).toEqual(["手動の値", "current"]);
  forms.push({ selector: "#new", label: "フォーム2（#new）" });
  scope().focus();
  await flush();
  expect(scope().options).toHaveLength(3);
  expect(scope().value).toBe("#form");
});

test("重複と対象外の件数を表示し，追加0件なら既存項目を変えない", async () => {
  await setup();
  const before = entries();
  sendMessage.mockResolvedValueOnce({ url, entries: [], duplicates: 1, skipped: 2 });
  button().click();
  await flush();
  expect(entries()).toEqual(before);
  expect(status()).toContain("重複1件・対象外2件");
  button().click();
  await flush();
  expect(entries()).toEqual(captured);
});

test.each([
  "edit",
  "scope",
  "page",
])("取得中の%s変更では古い結果を追加せず，連打も止める", async (change) => {
  const generator = await setup();
  let reply: (response: unknown) => void = () => {};
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      reply = resolve;
    }),
  );
  button().click();
  button().click();
  expect(button().disabled).toBe(true);
  expect(sendMessage.mock.calls.filter(([, message]) => message.action === "capture")).toHaveLength(
    1,
  );
  if (change === "edit") editValue("編集中");
  if (change === "scope") {
    scope().value = "#form";
    scope().dispatchEvent(new Event("change"));
  }
  if (change === "page") {
    sendMessage.mockResolvedValueOnce({ url: "https://example.com/other", forms });
    generator?.updateCurrentPage({ tabId: 8, url: "https://example.com/other" });
  }
  const before = entries();
  reply({ url, entries: captured, duplicates: 0, skipped: 0 });
  await flush();
  expect(entries()).toEqual(before);
  expect(button().disabled).toBe(false);
});

test("上限を超える追加は全件を拒否し，途中まで追加しない", async () => {
  await setup();
  editValue("残す値");
  captured = Array.from({ length: MAX_FIELDS }, (_, index) => ({
    target: { kind: "selector", value: `#field-${index}` },
    value: "a",
  }));
  button().click();
  await flush();
  expect(items()).toHaveLength(1);
  expect(entries()[0].value).toBe("残す値");
  expect(status()).toContain("100件まで");
});

test.each([
  "error",
  "reject",
  "wrong-url",
])("取得の%sでも既存項目を失わず，フォーム消失時に全体へ取り込まない", async (failure) => {
  await setup();
  scope().value = "#form";
  scope().dispatchEvent(new Event("change"));
  const before = entries();
  if (failure === "error")
    sendMessage.mockResolvedValueOnce({ url, error: "選択したフォームが見つかりません．" });
  else if (failure === "reject") sendMessage.mockRejectedValueOnce(new Error("通信できません"));
  else
    sendMessage.mockResolvedValueOnce({
      url: "https://other.example",
      entries: captured,
      duplicates: 0,
      skipped: 0,
    });
  button().click();
  await flush();
  expect(entries()).toEqual(before);
  expect(status()).not.toContain("件追加しました");
  expect(scope().value).toBe("#form");
});

test("別URLや確認できないページでは追加できず，フォームがなくても全体を取り込める", async () => {
  const generator = await setup();
  const pageUrl = field<HTMLInputElement>("generator-page-url");
  pageUrl.value = "https://other.example";
  pageUrl.dispatchEvent(new Event("input"));
  expect(button().disabled).toBe(true);
  pageUrl.value = url;
  pageUrl.dispatchEvent(new Event("input"));
  await flush();
  expect(button().disabled).toBe(false);
  generator?.updateCurrentPage(null);
  expect(button().disabled).toBe(true);
  forms = [];
  generator?.updateCurrentPage(page);
  await flush();
  expect(scope().options).toHaveLength(1);
  expect(button().disabled).toBe(false);
  button().click();
  await flush();
  expect(entries()).toEqual(captured);
});

test("フォーム一覧の取得失敗では追加を無効化し，再フォーカスで回復する", async () => {
  sendMessage.mockRejectedValueOnce(new Error("通信できません"));
  await setup();
  expect(button().disabled).toBe(true);
  expect(status()).toContain("フォームを取得できません");
  scope().focus();
  await flush();
  expect(button().disabled).toBe(false);
  expect(status()).toBe("");
});
