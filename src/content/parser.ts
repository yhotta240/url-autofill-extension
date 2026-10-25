export const URL_MARKER = "#url-autofill:";
export const MAX_URL_LENGTH = 16_384;
export const MAX_FIELDS = 100;

export type FillEntry = { selector: string; value: string };
export type AutofillRequest = {
  cleanUrl: string;
  entries: FillEntry[];
  error?: string;
};

/** 最後の専用フラグメントを解析する．失敗時もURL整理に必要な情報を返す． */
export function parseAutofillUrl(url: string): AutofillRequest | null {
  const fragmentIndex = url.indexOf("#");
  const markerIndex = url.lastIndexOf(URL_MARKER);
  if (fragmentIndex < 0 || markerIndex < fragmentIndex) return null;

  const cleanUrl = url.slice(0, markerIndex);
  const invalid = (error: string): AutofillRequest => ({ cleanUrl, entries: [], error });
  if (url.length > MAX_URL_LENGTH) return invalid("URLの長さが上限を超えています");

  const payload = url.slice(markerIndex + URL_MARKER.length);
  if (!payload) return { cleanUrl, entries: [] };
  const pairs = payload.split("&");
  if (pairs.length > MAX_FIELDS) return invalid("入力項目数が上限を超えています");

  const entries = new Map<string, FillEntry>();
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    let key: string;
    try {
      const rawKey = separator < 0 ? pair : pair.slice(0, separator);
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    } catch {
      return invalid("URLエンコードが不正です");
    }
    if (!key.startsWith("fill(")) continue;
    if (separator < 0) return invalid("入力項目は key=value 形式で指定してください");
    if (!key.endsWith(")") || !key.slice(5, -1).trim()) {
      return invalid("fill(...) の指定が不正です");
    }
    let value: string;
    try {
      value = decodeURIComponent(pair.slice(separator + 1).replace(/\+/g, " "));
    } catch {
      return invalid("URLエンコードが不正です");
    }
    entries.set(key, { selector: key.slice(5, -1), value });
  }

  return { cleanUrl, entries: [...entries.values()] };
}
