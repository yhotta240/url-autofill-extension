import {
  type FillEntry,
  MAX_FIELDS,
  MAX_URL_LENGTH,
  parseAutofillUrl,
  URL_MARKER,
} from "../content/parser.ts";
import { DEFAULT_INPUT_METHOD, type InputMethod, isInputMethod } from "../shared/input-method.ts";

/** 既存のルートを保持し，最後の専用指定を入力項目の一覧へ置き換える． */
export function generateAutofillUrl(
  baseUrl: string,
  entries: readonly FillEntry[],
  method: InputMethod = DEFAULT_INPUT_METHOD,
): string {
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
  if (!isInputMethod(method)) throw new Error("入力方式が不正です．");

  const keys = new Set<string>();
  const pairs = entries.map((entry, index) => {
    if (!entry.selector.trim()) {
      throw new Error(`項目${index + 1}：CSSセレクタを入力してください．`);
    }
    const key = `fill(${entry.selector})`;
    if (keys.has(entry.selector)) {
      throw new Error(`項目${index + 1}：同じ指定先が重複しています．指定先を変更してください．`);
    }
    keys.add(entry.selector);
    try {
      return `${encodeURIComponent(key)}=${encodeURIComponent(entry.value)}`;
    } catch {
      throw new Error(
        `項目${index + 1}：指定欄または入力値にURLへ変換できない文字が含まれています．`,
      );
    }
  });
  if (method !== DEFAULT_INPUT_METHOD) pairs.unshift(`method=${encodeURIComponent(method)}`);
  const cleanUrl = parseAutofillUrl(page.href)?.cleanUrl ?? page.href;
  const result = `${cleanUrl}${URL_MARKER}${pairs.join("&")}`;
  if (result.length > MAX_URL_LENGTH) {
    throw new Error(`生成URLが上限の${MAX_URL_LENGTH.toLocaleString("en-US")}文字を超えています．`);
  }
  return result;
}
