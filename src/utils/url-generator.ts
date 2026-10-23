import {
  type FillEntry,
  MAX_FIELDS,
  MAX_URL_LENGTH,
  parseAutofillUrl,
  URL_MARKER,
} from "../content/parser.ts";

/** 既存のルートを保持し，最後の専用指定を入力項目の一覧へ置き換える． */
export function generateAutofillUrl(baseUrl: string, entries: readonly FillEntry[]): string {
  let page: URL;
  try {
    page = new URL(baseUrl.trim());
  } catch {
    throw new Error("対象ページURLをHTTPまたはHTTPSの絶対URLで入力してください．");
  }
  if (!["http:", "https:"].includes(page.protocol)) {
    throw new Error("対象ページURLはHTTPまたはHTTPSで指定してください．");
  }
  if (entries.length === 0 || entries.length > MAX_FIELDS) {
    throw new Error(`入力項目は1件以上${MAX_FIELDS}件以下で指定してください．`);
  }

  const keys = new Set<string>();
  const pairs = entries.map((entry, index) => {
    if (!entry.target.value.trim()) {
      throw new Error(`項目${index + 1}：フィールド名またはCSSセレクタを入力してください．`);
    }
    if (entry.target.kind === "field" && entry.target.value.startsWith("fill(")) {
      throw new Error(
        `項目${index + 1}：fill(で始まるフィールド名はCSSセレクタで指定してください．`,
      );
    }
    const key =
      entry.target.kind === "selector" ? `fill(${entry.target.value})` : entry.target.value;
    if (keys.has(key)) {
      throw new Error(`項目${index + 1}：同じ指定先が重複しています．指定先を変更してください．`);
    }
    keys.add(key);
    try {
      return `${encodeURIComponent(key)}=${encodeURIComponent(entry.value)}`;
    } catch {
      throw new Error(
        `項目${index + 1}：指定欄または入力値にURLへ変換できない文字が含まれています．`,
      );
    }
  });
  const cleanUrl = parseAutofillUrl(page.href)?.cleanUrl ?? page.href;
  const result = `${cleanUrl}${URL_MARKER}${pairs.join("&")}`;
  if (result.length > MAX_URL_LENGTH) {
    throw new Error(`生成URLが上限の${MAX_URL_LENGTH.toLocaleString("en-US")}文字を超えています．`);
  }
  return result;
}
