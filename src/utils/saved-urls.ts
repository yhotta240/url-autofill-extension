import { parseAutofillUrl } from "../content/parser.ts";
import { generateAutofillUrl } from "./url-generator.ts";

export const SAVED_URL_PREFIX = "saved-url:";
export type SavedUrl = { id: string; name: string; url: string; createdAt: number };

export function readSavedUrl(url: string) {
  const request = parseAutofillUrl(url);
  if (!request || request.error || request.entries.length === 0) {
    throw new Error("保存URLの形式が不正です．");
  }
  generateAutofillUrl(request.cleanUrl, request.entries);
  return request;
}

export async function getSavedUrls(): Promise<SavedUrl[]> {
  const data = await chrome.storage.local.get(null);
  const items: SavedUrl[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(SAVED_URL_PREFIX) || !value || typeof value !== "object") continue;
    const item = value as Partial<SavedUrl>;
    if (
      typeof item.id !== "string" ||
      key !== SAVED_URL_PREFIX + item.id ||
      typeof item.url !== "string" ||
      (item.name !== undefined && typeof item.name !== "string") ||
      typeof item.createdAt !== "number" ||
      !Number.isFinite(item.createdAt)
    )
      continue;
    try {
      readSavedUrl(item.url);
      items.push({ id: item.id, name: item.name ?? "", url: item.url, createdAt: item.createdAt });
    } catch {
      // 他の保存データや破損した項目は一覧に含めない．
    }
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveUrl(url: string, name: string, id?: string) {
  name = name.trim();
  if (!name) throw new Error("保存名を入力してください．");
  readSavedUrl(url);
  const items = await getSavedUrls();
  const original = items.find((item) => item.id === id);
  if (id !== undefined && !original) throw new Error("編集対象は削除されています．");
  const duplicate = items.find((item) => item.url === url);
  if (duplicate) {
    if (id !== undefined && duplicate.id !== id) {
      throw new Error("同じURLがすでに保存されています．");
    }
    if (id === undefined || duplicate.name === name) return { item: duplicate, duplicate: true };
  }
  const item: SavedUrl = {
    id: original?.id ?? crypto.randomUUID(),
    name,
    url,
    createdAt: original?.createdAt ?? Date.now(),
  };
  await chrome.storage.local.set({ [SAVED_URL_PREFIX + item.id]: item });
  return { item, duplicate: false };
}

export async function deleteSavedUrl(id: string): Promise<void> {
  await chrome.storage.local.remove(SAVED_URL_PREFIX + id);
}
