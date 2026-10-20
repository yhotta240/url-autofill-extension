import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FIELDS, MAX_URL_LENGTH, parseAutofillUrl } from "../src/content/parser.ts";

test("識別子のないURLは処理しない", () => {
  for (const url of [
    "https://example.com/",
    "https://example.com/#/settings",
    "https://example.com/?q=%23url-autofill:",
  ]) {
    assert.equal(parseAutofillUrl(url), null);
  }
});

test("既存のクエリとハッシュルートを保持し，最後の識別子を採用する", () => {
  const prefix = "https://example.com/?page=1#/settings#url-autofill:old=1";
  const result = parseAutofillUrl(`${prefix}#url-autofill:email=test%40example.com`);
  assert.equal(result?.cleanUrl, prefix);
  assert.deepEqual(result?.entries, [
    { target: { kind: "field", value: "email" }, value: "test@example.com" },
  ]);
});

test("日本語，予約文字，改行，空文字，重複キーを解析する", () => {
  const result = parseAutofillUrl(
    "https://example.com/#url-autofill:name=old&name=%E7%94%B0%E4%B8%AD&note=a%26b%3Dc%0A%2B+ok&empty=",
  );
  assert.deepEqual(
    result?.entries.map(({ value }) => value),
    ["田中", "a&b=c\n+ ok", ""],
  );
});

test("fill(...) 内のセレクタを一度だけデコードする", () => {
  const key = `fill(input[name="email"])`;
  const result = parseAutofillUrl(
    `https://example.com/#url-autofill:${encodeURIComponent(key)}=%2520`,
  );
  assert.deepEqual(result?.entries, [
    { target: { kind: "selector", value: 'input[name="email"]' }, value: "%20" },
  ]);
});

test("不正な指定では一部だけの入力を行わず，整理後のURLを返す", () => {
  for (const payload of [
    "name=ok&bad=%",
    "name=%FF",
    "name",
    "=value",
    "fill()=value",
    "fill(%23email=value",
  ]) {
    const result = parseAutofillUrl(`https://example.com/#/route#url-autofill:${payload}`);
    assert.ok(result?.error);
    assert.equal(result.cleanUrl, "https://example.com/#/route");
    assert.deepEqual(result.entries, []);
  }
});

test("URL長と項目数の上限を検査する（重複キーも件数に含める）", () => {
  const prefix = "https://example.com/#url-autofill:x=";
  assert.equal(
    parseAutofillUrl(prefix + "a".repeat(MAX_URL_LENGTH - prefix.length))?.error,
    undefined,
  );
  assert.ok(parseAutofillUrl(prefix + "a".repeat(MAX_URL_LENGTH - prefix.length + 1))?.error);
  const pairs = Array(MAX_FIELDS).fill("x=1").join("&");
  assert.equal(parseAutofillUrl(`https://example.com/#url-autofill:${pairs}`)?.error, undefined);
  assert.ok(parseAutofillUrl(`https://example.com/#url-autofill:${pairs}&x=1`)?.error);
});

test("空のペイロードはURL整理だけを行う", () => {
  assert.deepEqual(parseAutofillUrl("https://example.com/#url-autofill:"), {
    cleanUrl: "https://example.com/",
    entries: [],
  });
});
