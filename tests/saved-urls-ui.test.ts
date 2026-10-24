// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import "bootstrap/js/dist/tab.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setupUrlLibrary } from "../src/popup/components/url-library.ts";
import { SAVED_URL_PREFIX, type SavedUrl } from "../src/utils/saved-urls.ts";

const html = readFileSync("public/popup.html", "utf8");
const currentUrl = "https://example.com/form?q=1#/route";
let data: Record<string, unknown>;
let listeners: Array<Parameters<typeof chrome.storage.onChanged.addListener>[0]>;
const get = vi.fn();
const set = vi.fn();
const remove = vi.fn();
const query = vi.fn();
const createTab = vi.fn();
const writeText = vi.fn();
const confirm = vi.fn();
const prompt = vi.fn();

function field<T extends HTMLElement = HTMLInputElement>(id: string): T {
  return document.getElementById(id) as T;
}
function rows(): HTMLLIElement[] {
  return [...document.querySelectorAll<HTMLLIElement>("#saved-items > li")];
}
function action(name: string, row = 0): HTMLButtonElement {
  return rows()[row].querySelector(`[data-${name}]`) as HTMLButtonElement;
}
function change(id: string, value: string): void {
  field<HTMLInputElement>(id).value = value;
  field(id).dispatchEvent(new Event("input", { bubbles: true }));
}
function entry(id: string, host = "example.com", createdAt = 1): SavedUrl {
  return { id, name: id, url: `https://${host}/${id}#url-autofill:email=${id}`, createdAt };
}
function store(...items: SavedUrl[]): void {
  for (const item of items) data[SAVED_URL_PREFIX + item.id] = item;
}
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}
async function setup(): Promise<void> {
  setupUrlLibrary();
  await flush();
}
function emit(key: string, newValue?: SavedUrl): void {
  for (const listener of listeners) listener({ [key]: { newValue } }, "local");
}

beforeEach(() => {
  vi.useFakeTimers();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  data = { enabled: false };
  listeners = [];
  get.mockReset().mockImplementation(async () => structuredClone(data));
  set.mockReset().mockImplementation(async (items: Record<string, SavedUrl>) => {
    Object.assign(data, items);
    for (const [key, item] of Object.entries(items)) emit(key, item);
  });
  remove.mockReset().mockImplementation(async (key: string) => {
    delete data[key];
    emit(key);
  });
  query.mockReset().mockResolvedValue([{ id: 7, url: currentUrl }]);
  createTab.mockReset().mockResolvedValue({ id: 8 });
  writeText.mockReset().mockResolvedValue(undefined);
  confirm.mockReset().mockReturnValue(true);
  prompt.mockReset().mockReturnValue("問い合わせフォーム");
  vi.stubGlobal("chrome", {
    tabs: {
      query,
      create: createTab,
      sendMessage: vi.fn().mockResolvedValue({ url: currentUrl, status: "found" }),
    },
    storage: {
      local: { get, set, remove },
      onChanged: {
        addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
      },
    },
  });
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.spyOn(window, "confirm").mockImplementation(confirm);
  vi.spyOn(window, "prompt").mockImplementation(prompt);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("現在タブを一度だけ取得し，現在ホストをポートも含めて絞り込む", async () => {
  store(
    entry("older"),
    entry("newer", "example.com", 2),
    entry("other", "other.example"),
    entry("port", "example.com:8080"),
  );
  await setup();
  expect(query).toHaveBeenCalledTimes(1);
  expect(rows().map((row) => row.querySelector("[data-url]")?.textContent)).toEqual([
    entry("newer").url,
    entry("older").url,
  ]);
  expect(field<HTMLInputElement>("saved-scope-host").checked).toBe(true);
  field("saved-scope-all").click();
  expect(rows()).toHaveLength(4);
  change("saved-search", "OTHER.EXAMPLE");
  expect(rows()).toHaveLength(1);
  change("saved-search", "does-not-exist");
  expect(rows()).toHaveLength(0);
  expect(field("saved-empty").textContent).toBe("一致するURLはありません．");
});

test("現在URLを取得できなければ全件表示し，保存なしと読み込み失敗を区別する", async () => {
  query.mockRejectedValue(new Error("unavailable"));
  await setup();
  expect(field<HTMLInputElement>("saved-scope-all").checked).toBe(true);
  expect(field<HTMLInputElement>("saved-scope-host").disabled).toBe(true);
  expect(field("saved-empty").textContent).toBe("保存したURLはありません．");
  expect(field("saved-source-status").textContent).toContain("すべて表示");
  get.mockRejectedValueOnce(new Error("read"));
  emit(`${SAVED_URL_PREFIX}other`);
  await flush();
  expect(field("saved-empty").textContent).toBe("保存URLを読み込めませんでした．");
});

test("フォームの生成結果を明示的に保存し，再保存は重複させない", async () => {
  await setup();
  expect(set).not.toHaveBeenCalled();
  const generated = field("generator-result").textContent;
  field("generator-save").click();
  expect(prompt).toHaveBeenCalledExactlyOnceWith("保存名を入力してください．", "");
  expect(document.getElementById("generator-name")).toBeNull();
  expect(field<HTMLButtonElement>("generator-save").disabled).toBe(true);
  await flush();
  expect(rows()).toHaveLength(1);
  expect(rows()[0].querySelector("[data-url]")?.textContent).toBe(generated);
  expect(rows()[0].querySelector("[data-name]")?.textContent).toBe("問い合わせフォーム");
  expect(rows()[0].querySelector("[data-host]")).toBeNull();
  expect(field("generator-save-status").textContent).toBe("保存しました．");
  field("generator-save").click();
  await flush();
  expect(set).toHaveBeenCalledTimes(1);
  expect(field("generator-save-status").textContent).toBe("同じURLがすでに保存されています．");
  change("generator-page-url", "invalid");
  expect(field<HTMLButtonElement>("generator-save").disabled).toBe(true);
});

test("保存に失敗しても入力を保持し，保存ボタンから再試行できる", async () => {
  await setup();
  const generated = field("generator-result").textContent;
  set.mockRejectedValueOnce(new Error("保存できませんでした．"));
  field("generator-save").click();
  await flush();
  expect(field("generator-save-status").textContent).toBe("保存できませんでした．");
  expect(field("generator-result").textContent).toBe(generated);
  expect(field<HTMLButtonElement>("generator-save").disabled).toBe(false);
  expect(rows()).toHaveLength(0);
  field("generator-save").click();
  await flush();
  expect(prompt).toHaveBeenLastCalledWith("保存名を入力してください．", "問い合わせフォーム");
  expect(rows()).toHaveLength(1);
});

test("編集で複数項目・CSS・改行・空値・ハッシュを復元し，同じIDを更新して一覧へ戻る", async () => {
  const saved: SavedUrl = {
    id: "edit",
    name: "フォーム入力",
    createdAt: 10,
    url: "https://example.com/form?q=1#/route#url-autofill:email=&fill(%23memo)=%E6%97%A5%E6%9C%AC%0A%26%3D",
  };
  store(saved);
  await setup();
  field("saved-urls-tab").click();
  action("edit").click();
  expect(field("settings-tab").getAttribute("aria-selected")).toBe("true");
  expect(field<HTMLInputElement>("generator-page-url").value).toBe(currentUrl);
  const inputs = document.querySelectorAll<HTMLInputElement>("[data-target]");
  const values = document.querySelectorAll<HTMLTextAreaElement>("[data-value]");
  expect([...inputs].map((input) => input.value)).toEqual(["email", "#memo"]);
  expect([...values].map((value) => value.value)).toEqual(["", "日本\n&="]);
  expect(document.querySelectorAll<HTMLSelectElement>("[data-method]")[1].value).toBe("selector");
  expect(field("generator-save").textContent).toBe("更新");
  prompt.mockReturnValueOnce("更新した名前");
  values[1].value = "変更\n値";
  values[1].dispatchEvent(new Event("input", { bubbles: true }));
  field("generator-save").click();
  expect(prompt).toHaveBeenLastCalledWith("保存名を入力してください．", saved.name);
  await flush();
  const updated = data[SAVED_URL_PREFIX + saved.id] as SavedUrl;
  expect(updated.id).toBe(saved.id);
  expect(updated.name).toBe("更新した名前");
  expect(updated.createdAt).toBe(10);
  expect(updated.url).toContain(encodeURIComponent("変更\n値"));
  expect(field("saved-urls-tab").getAttribute("aria-selected")).toBe("true");
  expect(field("generator-cancel").hidden).toBe(true);
});

test("未保存変更の置き換えを確認し，キャンセルで新規作成へ戻す", async () => {
  store(entry("one"), entry("two", "example.com", 2));
  await setup();
  change("generator-page-url", "https://example.com/draft");
  confirm.mockReturnValueOnce(false);
  action("edit").click();
  expect(field<HTMLInputElement>("generator-page-url").value).toContain("/draft");
  expect(field("generator-save").textContent).toBe("保存");
  action("edit").click();
  expect(field("generator-save").textContent).toBe("更新");
  field("generator-cancel").click();
  expect(field<HTMLInputElement>("generator-page-url").value).toBe(currentUrl);
  expect(document.querySelectorAll("[data-generator-item]")).toHaveLength(1);
  expect(field("generator-save").textContent).toBe("保存");
  expect(field("generator-cancel").hidden).toBe(true);
  expect(document.getElementById("generator-name")).toBeNull();
  expect(set).not.toHaveBeenCalled();
});

test("保存名で検索でき，ホスト名を重ねて表示しない", async () => {
  store({ ...entry("contact"), name: "問い合わせ窓口" }, { ...entry("other"), name: "別フォーム" });
  await setup();
  change("saved-search", "問い合わせ");
  expect(rows()).toHaveLength(1);
  expect(rows()[0].querySelector("[data-name]")?.textContent).toBe("問い合わせ窓口");
  expect(rows()[0].querySelector("[data-host]")).toBeNull();
  expect(rows()[0].querySelector("[data-url]")?.textContent).toBe(entry("contact").url);
});

test("名前がない旧項目はホスト名で補わず，編集で名前を付けられる", async () => {
  data[`${SAVED_URL_PREFIX}old`] = { id: "old", url: entry("old").url, createdAt: 1 };
  await setup();
  expect(rows()[0].querySelector("[data-name]")?.textContent).toBe("名称未設定");
  action("edit").click();
  prompt.mockReturnValueOnce("追加した名前");
  field("generator-save").click();
  expect(prompt).toHaveBeenLastCalledWith("保存名を入力してください．", "");
  await flush();
  expect(rows()[0].querySelector("[data-name]")?.textContent).toBe("追加した名前");
  expect((data[`${SAVED_URL_PREFIX}old`] as SavedUrl).url).toBe(entry("old").url);
});

test.each([null, "", "   "])("名前入力のキャンセルや空欄では保存しない: %s", async (name) => {
  await setup();
  prompt.mockReturnValueOnce(name);
  const generated = field("generator-result").textContent;
  field("generator-save").click();
  await flush();
  expect(set).not.toHaveBeenCalled();
  expect(field("generator-result").textContent).toBe(generated);
  expect(field<HTMLButtonElement>("generator-save").disabled).toBe(false);
  if (name !== null)
    expect(field("generator-save-status").textContent).toBe("保存名を入力してください．");
});

test("更新失敗時には編集状態を保持する", async () => {
  store(entry("edit"));
  await setup();
  action("edit").click();
  const value = document.querySelector<HTMLTextAreaElement>("[data-value]") as HTMLTextAreaElement;
  value.value = "new";
  value.dispatchEvent(new Event("input", { bubbles: true }));
  set.mockRejectedValueOnce(new Error("保存できませんでした．"));
  field("generator-save").click();
  await flush();
  expect(value.value).toBe("new");
  expect(field("generator-save").textContent).toBe("更新");
  expect(field("generator-cancel").hidden).toBe(false);
  expect((data[`${SAVED_URL_PREFIX}edit`] as SavedUrl).url).toBe(entry("edit").url);
});

test("削除確認のキャンセルと失敗では項目を残し，成功時のみ削除する", async () => {
  store(entry("delete"));
  await setup();
  confirm.mockReturnValueOnce(false);
  action("delete").click();
  expect(remove).not.toHaveBeenCalled();
  remove.mockRejectedValueOnce(new Error("delete"));
  action("delete").click();
  await flush();
  expect(rows()).toHaveLength(1);
  expect(field("saved-action-status").textContent).toBe("削除できませんでした．");
  get.mockClear();
  action("delete").click();
  await flush();
  expect(rows()).toHaveLength(0);
  expect(field("saved-action-status").textContent).toBe("削除しました．");
  expect(get).toHaveBeenCalledTimes(1);
});

test("一覧からURLをコピーし，失敗を表示する", async () => {
  store(entry("copy"));
  await setup();
  action("copy").click();
  await flush();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(entry("copy").url);
  expect(field("saved-action-status").textContent).toBe("コピーしました．");
  writeText.mockRejectedValueOnce(new Error("denied"));
  action("copy").click();
  await flush();
  expect(field("saved-action-status").textContent).toBe("コピーできませんでした．");
  expect(document.querySelector("#saved-items a")).toBeNull();
});

test("コピーの右のアイコンから保存URLを新しいタブで開き，失敗時は知らせる", async () => {
  store(entry("open"));
  await setup();
  expect(createTab).not.toHaveBeenCalled();
  expect(action("copy").nextElementSibling).toBe(action("open"));
  action("open").click();
  await flush();
  expect(createTab).toHaveBeenCalledExactlyOnceWith({ url: entry("open").url });
  createTab.mockRejectedValueOnce(new Error("unavailable"));
  action("open").click();
  await flush();
  expect(field("saved-action-status").textContent).toBe("ページを開けませんでした．");
});

test("別Popupの追加・削除を検索状態を維持して反映する", async () => {
  await setup();
  change("saved-search", "external");
  const item = entry("external");
  store(item);
  emit(SAVED_URL_PREFIX + item.id, item);
  await flush();
  expect(rows()).toHaveLength(1);
  delete data[SAVED_URL_PREFIX + item.id];
  emit(SAVED_URL_PREFIX + item.id);
  await flush();
  expect(rows()).toHaveLength(0);
  expect(field<HTMLInputElement>("saved-search").value).toBe("external");
  get.mockClear();
  emit("logs");
  expect(get).not.toHaveBeenCalled();
});

test("Google Favicon APIにホスト名だけを渡し，取得失敗時は代替アイコンにする", async () => {
  store(entry("icon"));
  await setup();
  const img = rows()[0].querySelector<HTMLImageElement>("img") as HTMLImageElement;
  const iconUrl = new URL(img.src);
  expect(iconUrl.origin + iconUrl.pathname).toBe("https://www.google.com/s2/favicons");
  expect([...iconUrl.searchParams]).toEqual([
    ["domain", "example.com"],
    ["sz", "32"],
  ]);
  expect(img.referrerPolicy).toBe("no-referrer");
  img.dispatchEvent(new Event("error"));
  expect(img.hidden).toBe(true);
  expect(rows()[0].querySelector("[data-fallback]")?.hasAttribute("hidden")).toBe(false);
  for (const name of ["edit", "delete", "copy", "open"]) {
    expect(action(name).getAttribute("aria-label")).toBe(action(name).title);
    expect(action(name).getAttribute("type")).toBe("button");
  }
});
