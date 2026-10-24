import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAX_URL_LENGTH } from "../src/content/parser.ts";
import {
  deleteSavedUrl,
  getSavedUrls,
  readSavedUrl,
  SAVED_URL_PREFIX,
  saveUrl,
} from "../src/utils/saved-urls.ts";

let data: Record<string, unknown>;
const get = vi.fn();
const set = vi.fn();
const remove = vi.fn();
const url = "https://example.com/form#url-autofill:email=test%40example.com";

beforeEach(() => {
  data = { enabled: false, logs: [] };
  get.mockReset().mockImplementation(async () => structuredClone(data));
  set.mockReset().mockImplementation(async (items) => Object.assign(data, items));
  remove.mockReset().mockImplementation(async (key) => {
    delete data[key];
  });
  vi.stubGlobal("chrome", { storage: { local: { get, set, remove } } });
});

afterEach(() => vi.unstubAllGlobals());

test("保存したURLを再読み込みし，既存の設定やログを保持する", async () => {
  const result = await saveUrl(url, " 問い合わせ ");
  expect(result.item.name).toBe("問い合わせ");
  expect(result.duplicate).toBe(false);
  expect(await getSavedUrls()).toEqual([result.item]);
  expect(set).toHaveBeenCalledExactlyOnceWith({ [SAVED_URL_PREFIX + result.item.id]: result.item });
  expect(data.enabled).toBe(false);
  expect(data.logs).toEqual([]);
});

test("同じURLの再保存は既存項目を返し，書き込まない", async () => {
  const first = await saveUrl(url, "問い合わせ");
  set.mockClear();
  expect(await saveUrl(url, "別名")).toEqual({ item: first.item, duplicate: true });
  expect(set).not.toHaveBeenCalled();
});

test("更新はIDと保存順を保持し，他項目への重複は拒否する", async () => {
  const first = await saveUrl(url, "問い合わせ");
  const second = await saveUrl(url.replace("test%40", "other%40"), "別フォーム");
  const changedUrl = url.replace("test%40", "changed%40");
  const changed = await saveUrl(changedUrl, "問い合わせ", first.item.id);
  expect(changed.item).toEqual({ ...first.item, url: changedUrl });
  await expect(saveUrl(second.item.url, "問い合わせ", first.item.id)).rejects.toThrow("すでに保存");
  expect(await getSavedUrls()).toHaveLength(2);
});

test("削除は対象のキーだけを消し，削除済み項目の更新は復活させない", async () => {
  const first = await saveUrl(url, "問い合わせ");
  const second = await saveUrl(url.replace("/form", "/other"), "別フォーム");
  await deleteSavedUrl(first.item.id);
  expect(remove).toHaveBeenCalledExactlyOnceWith(SAVED_URL_PREFIX + first.item.id);
  expect(await getSavedUrls()).toEqual([second.item]);
  await expect(saveUrl(url, "問い合わせ", first.item.id)).rejects.toThrow("削除されています");
});

test("保存順で並べ，無関係または不正なデータを無視する", async () => {
  const older = { id: "older", name: "前のフォーム", url, createdAt: 1 };
  const newer = {
    id: "newer",
    name: "次のフォーム",
    url: url.replace("/form", "/new"),
    createdAt: 2,
  };
  data = {
    ...data,
    [SAVED_URL_PREFIX + older.id]: older,
    [SAVED_URL_PREFIX + newer.id]: newer,
    [`${SAVED_URL_PREFIX}broken`]: { id: "broken", url: "javascript:alert(1)", createdAt: 3 },
    [`${SAVED_URL_PREFIX}mismatch`]: { id: "different", url, createdAt: 4 },
  };
  expect(await getSavedUrls()).toEqual([newer, older]);
});

test.each([
  "https://example.com/",
  "javascript:alert(1)#url-autofill:a=b",
  "https://example.com/#url-autofill:",
  "https://example.com/#url-autofill:a=%xx",
  `https://example.com/#url-autofill:a=${"x".repeat(MAX_URL_LENGTH)}`,
])("不正または上限超過のURLを保存しない: %s", async (invalid) => {
  await expect(saveUrl(invalid, "問い合わせ")).rejects.toThrow();
  expect(set).not.toHaveBeenCalled();
});

test("日本語・予約文字・改行・空値・CSSとハッシュを読み戻せる", () => {
  const parsed = readSavedUrl(
    "https://example.com/form?q=1#/route#url-autofill:email=&fill(%23memo)=%E6%97%A5%E6%9C%AC%0A%26%3D",
  );
  expect(parsed.cleanUrl).toBe("https://example.com/form?q=1#/route");
  expect(parsed.entries).toEqual([
    { target: { kind: "field", value: "email" }, value: "" },
    { target: { kind: "selector", value: "#memo" }, value: "日本\n&=" },
  ]);
});

test("ストレージの読み書きと削除の失敗を呼び出し元へ返す", async () => {
  get.mockRejectedValueOnce(new Error("read"));
  await expect(getSavedUrls()).rejects.toThrow("read");
  set.mockRejectedValueOnce(new Error("write"));
  await expect(saveUrl(url, "問い合わせ")).rejects.toThrow("write");
  remove.mockRejectedValueOnce(new Error("delete"));
  await expect(deleteSavedUrl("id")).rejects.toThrow("delete");
});

test("名前だけの更新でも同じIDで保存する", async () => {
  const first = await saveUrl(url, "元の名前");
  const updated = await saveUrl(url, "新しい名前", first.item.id);
  expect(updated.duplicate).toBe(false);
  expect(updated.item).toEqual({ ...first.item, name: "新しい名前" });
  expect(await getSavedUrls()).toEqual([updated.item]);
});

test.each(["", "   "])("空の名前は保存しない", async (name) => {
  await expect(saveUrl(url, name)).rejects.toThrow("保存名を入力");
  expect(set).not.toHaveBeenCalled();
});

test("名前のない旧データは失わず，名前を付けて更新できる", async () => {
  const old = { id: "old", url, createdAt: 1 };
  data[SAVED_URL_PREFIX + old.id] = old;
  expect(await getSavedUrls()).toEqual([{ ...old, name: "" }]);
  await saveUrl(url, "追加した名前", old.id);
  expect(data[SAVED_URL_PREFIX + old.id]).toEqual({ ...old, name: "追加した名前" });
});
