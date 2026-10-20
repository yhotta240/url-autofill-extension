export const URL_MARKER = "#url-autofill:";
export const MAX_URL_LENGTH = 16_384;
export const MAX_FIELDS = 100;

export type FillTarget = { kind: "field" | "selector"; value: string };
export type FillEntry = { target: FillTarget; value: string };
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
    if (separator < 1) return invalid("入力項目は key=value 形式で指定してください");

    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(pair.slice(0, separator).replace(/\+/g, " "));
      value = decodeURIComponent(pair.slice(separator + 1).replace(/\+/g, " "));
    } catch {
      return invalid("URLエンコードが不正です");
    }
    if (!key) return invalid("入力項目名が空です");

    let target: FillTarget = { kind: "field", value: key };
    if (key.startsWith("fill(")) {
      if (!key.endsWith(")") || !key.slice(5, -1).trim()) {
        return invalid("fill(...) の指定が不正です");
      }
      target = { kind: "selector", value: key.slice(5, -1) };
    }
    entries.set(key, { target, value });
  }

  return { cleanUrl, entries: [...entries.values()] };
}
