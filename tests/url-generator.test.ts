import { expect, test } from "vitest";
import { type FillEntry, MAX_URL_LENGTH, parseAutofillUrl } from "../src/content/parser.ts";
import { generateAutofillUrl } from "../src/utils/url-generator.ts";

const email: FillEntry = { target: { kind: "field", value: "email" }, value: "test@example.com" };

test("name / idの入力指定を生成する", () => {
  expect(generateAutofillUrl("https://example.com/form", email)).toBe(
    "https://example.com/form#url-autofill:email=test%40example.com",
  );
});

test.each([
  { target: { kind: "field", value: "氏名 &+" }, value: "田中 &=+\n#url-autofill:" },
  { target: { kind: "selector", value: 'input[name="email"]' }, value: "日本語 % +\n" },
] satisfies FillEntry[])("エンコードした指定と値を既存パーサーで復元できる: $target.kind", (entry) => {
  const base = "https://example.com/form?q=1#/settings";
  const parsed = parseAutofillUrl(generateAutofillUrl(base, entry));
  expect(parsed?.cleanUrl).toBe(base);
  expect(parsed?.entries).toEqual([entry]);
  expect(parsed?.error).toBeUndefined();
});

test("CSSセレクタをfill(...)で指定する", () => {
  expect(
    generateAutofillUrl("https://example.com/form", {
      ...email,
      target: { kind: "selector", value: "#email" },
    }),
  ).toBe("https://example.com/form#url-autofill:fill(%23email)=test%40example.com");
});

test("最後の専用指定だけを置き換え，通常のクエリとハッシュを保持する", () => {
  const prefix = "https://example.com/?q=1#/settings#url-autofill:old=keep";
  expect(generateAutofillUrl(`${prefix}#url-autofill:replace=old`, email)).toBe(
    `${prefix}#url-autofill:email=test%40example.com`,
  );
});

test("空の入力値や前後の空白を維持する", () => {
  for (const value of ["", "  text  ", "\n"]) {
    const entry = { ...email, value };
    expect(parseAutofillUrl(generateAutofillUrl("https://example.com/", entry))?.entries).toEqual([
      entry,
    ]);
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
  expect(() => generateAutofillUrl(url, email)).toThrow());

test.each(["field", "selector"] as const)("指定欄が空なら拒否する: %s", (kind) => {
  expect(() =>
    generateAutofillUrl("https://example.com/", {
      ...email,
      target: { kind, value: "  " },
    }),
  ).toThrow("フィールド名またはCSSセレクタを入力してください");
});

test("フィールド名を意図せずCSS指定として生成しない", () => {
  expect(() =>
    generateAutofillUrl("https://example.com/", {
      ...email,
      target: { kind: "field", value: "fill(#email)" },
    }),
  ).toThrow("CSSセレクタで指定してください");
});

test("URL長の上限を既存パーサーと揃える", () => {
  const base = "https://example.com/";
  const prefix = generateAutofillUrl(base, { ...email, value: "" });
  const value = "a".repeat(MAX_URL_LENGTH - prefix.length);
  expect(generateAutofillUrl(base, { ...email, value })).toHaveLength(MAX_URL_LENGTH);
  expect(() => generateAutofillUrl(base, { ...email, value: `${value}a` })).toThrow("上限");
});

test("URLエンコードできない文字は固定メッセージで拒否する", () => {
  expect(() => generateAutofillUrl("https://example.com/", { ...email, value: "\uD800" })).toThrow(
    "URLへ変換できない文字",
  );
});
