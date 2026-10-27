import { expect, test } from "vitest";
import { type FillEntry, MAX_FIELDS, parseAutofillUrl } from "../src/content/parser.ts";
import { DEFAULT_INPUT_METHOD } from "../src/shared/input-method.ts";
import { readSavedUrl } from "../src/utils/saved-urls.ts";
import { generateAutofillUrl } from "../src/utils/url-generator.ts";

test.each([
  "paste-event",
  "insert-text",
  "clipboard-paste",
] as const)("全体方式%sのURL生成・解析・保存URL復元", (method) => {
  const entry: FillEntry = {
    selector: 'div[aria-label="入力=本文"]:not(.hidden)',
    value: "日本語\n&=+",
  };
  const url = generateAutofillUrl("https://example.com/#/route", [entry], method);
  expect(decodeURIComponent(url)).toContain(`fill(${entry.selector})=`);
  const restored = readSavedUrl(url);
  expect(restored.entries[0]).toEqual(entry);
  expect(restored.method).toBe(method);
  if (method === DEFAULT_INPUT_METHOD) expect(url).not.toContain("method=");
  else expect(url).toContain(`method=${method}`);
});

test("不正な全体方式と矛盾する指定を拒否する", () => {
  for (const payload of ["method=unknown", "method", "method=insert-text&method=paste-event"]) {
    expect(parseAutofillUrl(`https://example.com/#url-autofill:${payload}`)?.error).toBeTruthy();
  }
});

test("項目100個でも全体方式を追加できる", () => {
  const entries = Array.from({ length: MAX_FIELDS }, (_, index) => ({
    selector: `#field${index}`,
    value: "a",
  }));
  const result = parseAutofillUrl(
    generateAutofillUrl("https://example.com/", entries, "paste-event"),
  );
  expect(result?.entries).toHaveLength(MAX_FIELDS);
  expect(result?.method).toBe("paste-event");
});
