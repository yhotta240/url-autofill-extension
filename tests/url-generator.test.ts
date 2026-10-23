import { expect, test } from "vitest";
import {
  type FillEntry,
  MAX_FIELDS,
  MAX_URL_LENGTH,
  parseAutofillUrl,
} from "../src/content/parser.ts";
import { generateAutofillUrl } from "../src/utils/url-generator.ts";

const email: FillEntry = { target: { kind: "field", value: "email" }, value: "test@example.com" };

test("name / idの入力指定を生成する", () => {
  expect(generateAutofillUrl("https://example.com/form", [email])).toBe(
    "https://example.com/form#url-autofill:email=test%40example.com",
  );
});

test.each([
  { target: { kind: "field", value: "氏名 &+" }, value: "田中 &=+\n#url-autofill:" },
  { target: { kind: "selector", value: 'input[name="email"]' }, value: "日本語 % +\n" },
] satisfies FillEntry[])("エンコードした指定と値を既存パーサーで復元できる: $target.kind", (entry) => {
  const base = "https://example.com/form?q=1#/settings";
  const parsed = parseAutofillUrl(generateAutofillUrl(base, [entry]));
  expect(parsed?.cleanUrl).toBe(base);
  expect(parsed?.entries).toEqual([entry]);
  expect(parsed?.error).toBeUndefined();
});

test("CSSセレクタをfill(...)で指定する", () => {
  expect(
    generateAutofillUrl("https://example.com/form", [
      {
        ...email,
        target: { kind: "selector", value: "#email" },
      },
    ]),
  ).toBe("https://example.com/form#url-autofill:fill(%23email)=test%40example.com");
});

test("最後の専用指定だけを置き換え，通常のクエリとハッシュを保持する", () => {
  const prefix = "https://example.com/?q=1#/settings#url-autofill:old=keep";
  expect(generateAutofillUrl(`${prefix}#url-autofill:replace=old`, [email])).toBe(
    `${prefix}#url-autofill:email=test%40example.com`,
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

test.each(["field", "selector"] as const)("指定欄が空なら拒否する: %s", (kind) => {
  expect(() =>
    generateAutofillUrl("https://example.com/", [
      {
        ...email,
        target: { kind, value: "  " },
      },
    ]),
  ).toThrow("フィールド名またはCSSセレクタを入力してください");
});

test("フィールド名を意図せずCSS指定として生成しない", () => {
  expect(() =>
    generateAutofillUrl("https://example.com/", [
      {
        ...email,
        target: { kind: "field", value: "fill(#email)" },
      },
    ]),
  ).toThrow("CSSセレクタで指定してください");
});

test("URL長の上限を既存パーサーと揃える", () => {
  const base = "https://example.com/";
  const prefix = generateAutofillUrl(base, [{ ...email, value: "" }]);
  const value = "a".repeat(MAX_URL_LENGTH - prefix.length);
  expect(generateAutofillUrl(base, [{ ...email, value }])).toHaveLength(MAX_URL_LENGTH);
  expect(() => generateAutofillUrl(base, [{ ...email, value: `${value}a` }])).toThrow("上限");
});

test("URLエンコードできない文字は固定メッセージで拒否する", () => {
  expect(() =>
    generateAutofillUrl("https://example.com/", [{ ...email, value: "\uD800" }]),
  ).toThrow("URLへ変換できない文字");
});

test("異なる指定方法の項目を順番どおりに結合し，既存パーサーで復元できる", () => {
  const entries: FillEntry[] = [
    email,
    { target: { kind: "selector", value: "#username" }, value: "田中\n+ &=#" },
    { target: { kind: "field", value: "notes" }, value: "" },
  ];
  const base = "https://example.com/form?q=1#/settings";
  const url = generateAutofillUrl(`${base}#url-autofill:old=value`, entries);
  expect(url).toContain("email=test%40example.com&fill(%23username)=");
  expect(url).toMatch(/&notes=$/);
  expect(parseAutofillUrl(url)).toEqual({ cleanUrl: base, entries });
});

test.each(["field", "selector"] as const)("同じ指定先の重複を拒否する: %s", (kind) => {
  const entry: FillEntry = { target: { kind, value: "email" }, value: "first" };
  expect(() =>
    generateAutofillUrl("https://example.com/", [entry, { ...entry, value: "last" }]),
  ).toThrow("項目2：同じ指定先が重複");
});

test("指定方法が異なる同名の対象は区別する", () => {
  const entries: FillEntry[] = [email, { target: { kind: "selector", value: "email" }, value: "" }];
  expect(parseAutofillUrl(generateAutofillUrl("https://example.com/", entries))?.entries).toEqual(
    entries,
  );
});

test("空の一覧と上限超過を拒否し，上限件数をパーサーで復元できる", () => {
  const base = "https://example.com/";
  const entries: FillEntry[] = Array.from({ length: MAX_FIELDS }, (_, i) => ({
    target: { kind: "field", value: `field${i}` },
    value: "",
  }));
  expect(parseAutofillUrl(generateAutofillUrl(base, entries))?.entries).toEqual(entries);
  expect(() => generateAutofillUrl(base, [])).toThrow("1件以上");
  expect(() => generateAutofillUrl(base, [...entries, email])).toThrow(`${MAX_FIELDS}件以下`);
});

test("複数項目の合計でURL長の上限を判定する", () => {
  const base = "https://example.com/";
  const note: FillEntry = { target: { kind: "field", value: "notes" }, value: "" };
  const prefix = generateAutofillUrl(base, [email, note]);
  const value = "a".repeat(MAX_URL_LENGTH - prefix.length);
  const entries = [email, { ...note, value }];
  const url = generateAutofillUrl(base, entries);
  expect(url).toHaveLength(MAX_URL_LENGTH);
  expect(parseAutofillUrl(url)?.entries).toEqual(entries);
  expect(() => generateAutofillUrl(base, [email, { ...note, value: `${value}a` }])).toThrow("上限");
});
