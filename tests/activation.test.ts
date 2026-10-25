// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { watchAutofillSetting } from "../src/content/activation.ts";

type ChangeListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
let listeners: Set<ChangeListener>;
let read: (items: Record<string, unknown>) => void;
let stop: () => void;
const runtime: { lastError?: { message: string } } = {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  document.body.innerHTML = '<input name="email">';
  window.history.replaceState(
    null,
    "",
    "https://example.com/#url-autofill:fill(input%5Bname%3Demail%5D)=value",
  );
  runtime.lastError = undefined;
  listeners = new Set();
  vi.stubGlobal("chrome", {
    runtime,
    storage: {
      local: {
        get: vi.fn((_key, callback) => {
          read = callback;
        }),
      },
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.add(listener),
        removeListener: (listener: ChangeListener) => listeners.delete(listener),
      },
    },
  });
  stop = watchAutofillSetting(document);
});

afterEach(() => {
  stop();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function change(enabled: unknown, area: Parameters<ChangeListener>[1] = "local"): void {
  for (const listener of listeners) listener({ enabled: { newValue: enabled } }, area);
}

test.each([undefined, false])("保存値が%sならURLもフォームも変更しない", async (enabled) => {
  const url = window.location.href;
  assert.ok(url.includes("#url-autofill:"));
  assert.equal(document.querySelector("input")?.value, "");
  read({ enabled });
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(window.location.href, url);
  assert.equal(document.querySelector("input")?.value, "");
  assert.equal(vi.getTimerCount(), 0);
});

test("保存された有効状態を読み込んでからURL整理と入力を開始する", async () => {
  assert.ok(window.location.hash.includes("#url-autofill:"));
  read({ enabled: true });
  await vi.advanceTimersByTimeAsync(80);
  assert.equal(window.location.hash, "");
  assert.equal(document.querySelector("input")?.value, "value");
});

test("Popupでの無効化時は動的DOM待機を停止し，以後のハッシュ変更も操作しない", async () => {
  document.body.replaceChildren();
  read({ enabled: true });
  await vi.advanceTimersByTimeAsync(80);
  change(false);
  document.body.innerHTML = '<input name="email">';
  window.location.hash = "#url-autofill:fill(input%5Bname%3Demail%5D)=new";
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(document.querySelector("input")?.value, "");
  assert.equal(window.location.hash, "#url-autofill:fill(input%5Bname%3Demail%5D)=new");
  assert.equal(vi.getTimerCount(), 0);
});

test("Popupで有効化すると現在のURLを処理し，有効状態の重複通知では待機を壊さない", async () => {
  read({ enabled: false });
  await vi.advanceTimersByTimeAsync(0);
  document.body.replaceChildren();
  change(true);
  await vi.advanceTimersByTimeAsync(80);
  change(true);
  document.body.innerHTML = '<input name="email">';
  await vi.advanceTimersByTimeAsync(80);
  assert.equal(document.querySelector("input")?.value, "value");
});

test.each([true, false])("初期読み込みより新しい設定変更（%s）を優先する", async (enabled) => {
  const url = window.location.href;
  change(enabled);
  read({ enabled: !enabled });
  await vi.advanceTimersByTimeAsync(80);
  assert.equal(document.querySelector("input")?.value, enabled ? "value" : "");
  if (!enabled) assert.equal(window.location.href, url);
});

test("別の保存領域や別の設定変更では有効にしない", async () => {
  read({ enabled: false });
  change(true, "sync");
  for (const listener of listeners) listener({ settings: { newValue: {} } }, "local");
  change("true");
  await vi.advanceTimersByTimeAsync(80);
  assert.ok(window.location.hash.includes("#url-autofill:"));
  assert.equal(document.querySelector("input")?.value, "");
});

test("設定の削除も無効化として扱う", async () => {
  document.body.replaceChildren();
  read({ enabled: true });
  await vi.advanceTimersByTimeAsync(80);
  change(undefined);
  document.body.innerHTML = '<input name="email">';
  await vi.advanceTimersByTimeAsync(80);
  assert.equal(document.querySelector("input")?.value, "");
});

test("保存値の読み込み失敗では無効状態を維持する", async () => {
  const url = window.location.href;
  runtime.lastError = { message: "unavailable" };
  read({ enabled: true });
  await vi.advanceTimersByTimeAsync(80);
  assert.equal(window.location.href, url);
  assert.equal(document.querySelector("input")?.value, "");
  assert.equal(vi.mocked(console.warn).mock.calls.length, 1);
});

test("破棄後に初期読み込みが完了しても起動せず，設定監視も解除する", async () => {
  const url = window.location.href;
  stop();
  read({ enabled: true });
  await vi.advanceTimersByTimeAsync(80);
  assert.equal(listeners.size, 0);
  assert.equal(window.location.href, url);
  assert.equal(document.querySelector("input")?.value, "");
});
