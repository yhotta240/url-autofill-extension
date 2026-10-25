import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_FIELDS, MAX_URL_LENGTH, parseAutofillUrl } from "../src/content/parser.ts";

test("識別子のないURLは処理しない", () => {
  for (const url of [
    "https://example.com/",
    "https://example.com/#/settings",
    "https://example.com/?q=%23url-autofill:",
  ])
    assert.equal(parseAutofillUrl(url), null);
});

test("既存のクエリとハッシュルートを保持し，最後の識別子を採用する", () => {
  const prefix = "https://example.com/?page=1#/settings#url-autofill:fill(%23old)=1";
  const result = parseAutofillUrl(`${prefix}#url-autofill:fill(%23email)=test%40example.com`);
  assert.equal(result?.cleanUrl, prefix);
  assert.deepEqual(result?.entries, [{ selector: "#email", value: "test@example.com" }]);
});

test("日本語，予約文字，改行，空文字，重複キーを解析する", () => {
  const result = parseAutofillUrl(
    "https://example.com/#url-autofill:fill(%23name)=old&fill(%23name)=%E7%94%B0%E4%B8%AD&fill(%23note)=a%26b%3Dc%0A%2B+ok&fill(%23empty)=",
  );
  assert.deepEqual(
    result?.entries.map(({ value }) => value),
    ["田中", "a&b=c\n+ ok", ""],
  );
});

test("fill(...) 内のセレクタを一度だけデコードする", () => {
  const key = 'fill(input[name="email"])';
  const result = parseAutofillUrl(
    `https://example.com/#url-autofill:${encodeURIComponent(key)}=%2520`,
  );
  assert.deepEqual(result?.entries, [{ selector: 'input[name="email"]', value: "%20" }]);
});

test.each([
  "email=value",
  "email=%FF",
  "email",
  "=value",
])("認識しない指定だけの場合は入力もエラーも返さない: %s", (payload) => {
  assert.deepEqual(parseAutofillUrl(`https://example.com/#url-autofill:${payload}`), {
    cleanUrl: "https://example.com/",
    entries: [],
  });
});

test.each([
  "fill(%23email)=ok&other=%FF",
  "other=%FF&fill(%23email)=ok",
])("認識しない指定を無視し，fill(...)だけを解析する: %s", (payload) => {
  assert.deepEqual(parseAutofillUrl(`https://example.com/#url-autofill:${payload}`), {
    cleanUrl: "https://example.com/",
    entries: [{ selector: "#email", value: "ok" }],
  });
});

test.each([
  "fill(%23name)=ok&fill(%23bad)=%",
  "fill(%23name)=%FF",
  "fill(%23name)",
  "fill()=value",
  "fill(%20)=value",
  "fill(%23email=value",
])("不正なfill指定では一部だけ入力せず，整理後のURLを返す: %s", (payload) => {
  const result = parseAutofillUrl(`https://example.com/#/route#url-autofill:${payload}`);
  assert.ok(result?.error);
  assert.equal(result.cleanUrl, "https://example.com/#/route");
  assert.deepEqual(result.entries, []);
});

test("URL長と項目数の上限を検査する（重複キーも件数に含める）", () => {
  const prefix = "https://example.com/#url-autofill:fill(%23x)=";
  assert.equal(
    parseAutofillUrl(prefix + "a".repeat(MAX_URL_LENGTH - prefix.length))?.error,
    undefined,
  );
  assert.ok(parseAutofillUrl(prefix + "a".repeat(MAX_URL_LENGTH - prefix.length + 1))?.error);
  const pairs = Array(MAX_FIELDS).fill("fill(%23x)=1").join("&");
  assert.equal(parseAutofillUrl(`https://example.com/#url-autofill:${pairs}`)?.error, undefined);
  assert.ok(parseAutofillUrl(`https://example.com/#url-autofill:${pairs}&fill(%23x)=1`)?.error);
});

test("空のペイロードはURL整理だけを行う", () => {
  assert.deepEqual(parseAutofillUrl("https://example.com/#url-autofill:"), {
    cleanUrl: "https://example.com/",
    entries: [],
  });
});
