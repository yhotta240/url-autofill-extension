import { type FillEntry, MAX_URL_LENGTH, parseAutofillUrl, URL_MARKER } from "../content/parser.ts";

/** 既存のルートを保持し，最後の専用指定を1項目の入力指定へ置き換える． */
export function generateAutofillUrl(baseUrl: string, entry: FillEntry): string {
  let page: URL;
  try {
    page = new URL(baseUrl.trim());
  } catch {
    throw new Error("対象ページURLをHTTPまたはHTTPSの絶対URLで入力してください．");
  }
  if (!["http:", "https:"].includes(page.protocol)) {
    throw new Error("対象ページURLはHTTPまたはHTTPSで指定してください．");
  }
  if (!entry.target.value.trim()) {
    throw new Error("フィールド名またはCSSセレクタを入力してください．");
  }
  if (entry.target.kind === "field" && entry.target.value.startsWith("fill(")) {
    throw new Error("fill(で始まるフィールド名はCSSセレクタで指定してください．");
  }

  const key = entry.target.kind === "selector" ? `fill(${entry.target.value})` : entry.target.value;
  const cleanUrl = parseAutofillUrl(page.href)?.cleanUrl ?? page.href;
  let result: string;
  try {
    result = `${cleanUrl}${URL_MARKER}${encodeURIComponent(key)}=${encodeURIComponent(entry.value)}`;
  } catch {
    throw new Error("指定欄または入力値にURLへ変換できない文字が含まれています．");
  }
  if (result.length > MAX_URL_LENGTH) {
    throw new Error(`生成URLが上限の${MAX_URL_LENGTH.toLocaleString("en-US")}文字を超えています．`);
  }
  return result;
}
