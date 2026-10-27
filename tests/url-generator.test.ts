import { expect, test } from "vitest";
import {
  type FillEntry,
  MAX_FIELDS,
  MAX_URL_LENGTH,
  parseAutofillUrl,
} from "../src/content/parser.ts";
import { DEFAULT_INPUT_METHOD } from "../src/shared/input-method.ts";
import { generateAutofillUrl } from "../src/utils/url-generator.ts";

const email: FillEntry = { selector: "#email", value: "test@example.com" };

test("CSSセレクタをfill(...)で指定する", () => {
  expect(generateAutofillUrl("https://example.com/form", [email])).toBe(
    "https://example.com/form#url-autofill:fill(%23email)=test%40example.com",
  );
});

test.each([
  { selector: '[name="氏名 &+"]', value: "田中 &=+\n#url-autofill:" },
  { selector: 'input[name="email"]', value: "日本語 % +\n" },
] satisfies FillEntry[])("エンコードしたセレクタと値を復元できる: $selector", (entry) => {
  const base = "https://example.com/form?q=1#/settings";
  expect(parseAutofillUrl(generateAutofillUrl(base, [entry]))).toEqual({
    cleanUrl: base,
    entries: [entry],
    method: DEFAULT_INPUT_METHOD,
  });
});

test("最後の専用指定だけを置き換え，通常のクエリとハッシュを保持する", () => {
  const prefix = "https://example.com/?q=1#/settings#url-autofill:fill(%23old)=keep";
  expect(generateAutofillUrl(`${prefix}#url-autofill:replace=old`, [email])).toBe(
    `${prefix}#url-autofill:fill(%23email)=test%40example.com`,
  );
});

test("空の入力値や前後の空白を維持する", () => {
  for (const value of ["", "  text  ", "\n"]) {
    const entry = { ...email, value };
    expect(parseAutofillUrl(generateAutofillUrl("https://example.com/", [entry]))?.entries).toEqual(
      [entry],
    );
  }
});

test.each([
  "",
  "/form",
  "not a url",
  "file:///form",
  "javascript:alert(1)",
  "chrome://settings/",
])("HTTP/HTTPSの絶対URL以外は拒否する: %s", (url) =>
  expect(() => generateAutofillUrl(url, [email])).toThrow());

test("セレクタが空なら拒否する", () => {
  expect(() => generateAutofillUrl("https://example.com/", [{ ...email, selector: "  " }])).toThrow(
    "CSSセレクタを入力してください",
  );
});

test("URL長の上限を既存パーサーと揃える", () => {
  const base = "https://example.com/";
  const prefix = generateAutofillUrl(base, [{ ...email, value: "" }]);
  const value = "a".repeat(MAX_URL_LENGTH - prefix.length);
  expect(generateAutofillUrl(base, [{ ...email, value }])).toHaveLength(MAX_URL_LENGTH);
  expect(() => generateAutofillUrl(base, [{ ...email, value: `${value}a` }])).toThrow("上限");
});

test("URLエンコードできない文字は固定メッセージで拒否する", () => {
  for (const entry of [
    { ...email, value: "\uD800" },
    { ...email, selector: "\uD800" },
  ])
    expect(() => generateAutofillUrl("https://example.com/", [entry])).toThrow(
      "URLへ変換できない文字",
    );
});

test("複数項目を順番どおりに結合し，復元できる", () => {
  const entries: FillEntry[] = [
    email,
    { selector: "#username", value: "田中\n+ &=#" },
    { selector: "textarea[name=notes]", value: "" },
  ];
  const base = "https://example.com/form?q=1#/settings";
  const url = generateAutofillUrl(`${base}#url-autofill:old=value`, entries);
  expect(parseAutofillUrl(url)).toEqual({ cleanUrl: base, entries, method: DEFAULT_INPUT_METHOD });
});

test("同じセレクタの重複を拒否する", () => {
  expect(() =>
    generateAutofillUrl("https://example.com/", [email, { ...email, value: "last" }]),
  ).toThrow("項目2：同じ指定先が重複");
});

test("空の一覧と上限超過を拒否し，上限件数をパーサーで復元できる", () => {
  const base = "https://example.com/";
  const entries: FillEntry[] = Array.from({ length: MAX_FIELDS }, (_, i) => ({
    selector: `#field${i}`,
    value: "",
  }));
  expect(parseAutofillUrl(generateAutofillUrl(base, entries))?.entries).toEqual(entries);
  expect(() => generateAutofillUrl(base, [])).toThrow("1件以上");
  expect(() => generateAutofillUrl(base, [...entries, email])).toThrow(`${MAX_FIELDS}件以下`);
});

test("複数項目の合計でURL長の上限を判定する", () => {
  const base = "https://example.com/";
  const note: FillEntry = { selector: "#notes", value: "" };
  const prefix = generateAutofillUrl(base, [email, note]);
  const value = "a".repeat(MAX_URL_LENGTH - prefix.length);
  const entries = [email, { ...note, value }];
  expect(generateAutofillUrl(base, entries)).toHaveLength(MAX_URL_LENGTH);
  expect(parseAutofillUrl(generateAutofillUrl(base, entries))?.entries).toEqual(entries);
  expect(() => generateAutofillUrl(base, [email, { ...note, value: `${value}a` }])).toThrow("上限");
});
