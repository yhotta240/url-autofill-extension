// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { startAutofill } from "../src/content/controller.ts";
import { DOM_WAIT_MS } from "../src/content/runner.ts";

const cleanups: Array<() => void> = [];
const advance = (ms = 80) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
});

afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function start(root: Document): () => void {
  const stop = startAutofill(root);
  cleanups.push(stop);
  return stop;
}

function createPage(html: string, hash = "") {
  document.body.innerHTML = html;
  window.history.replaceState(null, "", `https://example.com/form?q=1${hash}`);
  const logs: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((message) => logs.push(String(message)));
  vi.spyOn(console, "info").mockImplementation((message) => logs.push(String(message)));
  return { window, document, logs };
}

test("指定範囲へ遅れて追加されるラジオの選択肢を待ち，範囲外は使わない", async () => {
  createPage(
    '<div id="scope"><input type="radio" name="plan" value="a"></div><input type="radio" name="plan" id="outside" value="b">',
    "#url-autofill:fill(%23scope)=b",
  );
  start(document);
  await advance();
  assert.equal(document.querySelector(":checked"), null);
  await advance(DOM_WAIT_MS - 200);
  document
    .querySelector("#scope")
    ?.insertAdjacentHTML("beforeend", '<input type="radio" name="plan" id="later" value="b">');
  await advance();
  assert.equal(document.querySelector<HTMLInputElement>("#later")?.checked, true);
  assert.equal(document.querySelector<HTMLInputElement>("#outside")?.checked, false);
});

test("URLを入力前に整理し，履歴stateを保持して一度だけ入力する", async () => {
  const { window, document, logs } = createPage(
    '<input name="email">',
    "#/settings#url-autofill:fill(input%5Bname%3Demail%5D)=private%40example.com",
  );
  window.history.replaceState({ route: "settings" }, "");
  const urls: string[] = [];
  document.addEventListener("input", () => urls.push(window.location.href));
  const stop = start(document);
  assert.equal(window.location.href, "https://example.com/form?q=1#/settings");
  assert.deepEqual(window.history.state, { route: "settings" });
  await advance();
  assert.equal(document.querySelector("input")?.value, "private@example.com");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  await advance();
  assert.deepEqual(urls, ["https://example.com/form?q=1#/settings"]);
  assert.ok(logs.some((line) => line.includes("入力完了: 1件")));
  assert.ok(logs.every((line) => !line.includes("private")));
  stop();
});

test("遅れて追加される入力欄とselectの選択肢を待ち，入力済み項目は上書きしない", async () => {
  const { window, document } = createPage(
    '<input name="first"><select name="choice"></select>',
    "#url-autofill:fill(input%5Bname%3Dfirst%5D)=initial&fill(input%5Bname%3Dlate%5D)=arrived&fill(select%5Bname%3Dchoice%5D)=b",
  );
  const stop = start(document);
  await advance();
  const first = document.querySelector("input");
  assert.ok(first);
  first.value = "user edit";
  const late = document.createElement("input");
  late.name = "late";
  document.body.append(late);
  document.querySelector("select")?.append(new window.Option("B", "b"));
  await advance();
  assert.equal(first.value, "user edit");
  assert.equal(late.value, "arrived");
  assert.equal(document.querySelector("select")?.value, "b");
  stop();
});

test("hashchangeで新しい指定を処理し，古い待機をキャンセルする", async () => {
  const { window, document } = createPage("", "#url-autofill:fill(input%5Bname%3Dold%5D)=stale");
  const stop = start(document);
  await advance();
  window.location.hash = "#/next#url-autofill:fill(input%5Bname%3Dnew%5D)=fresh";
  await advance();
  document.body.innerHTML = '<input name="old"><input name="new">';
  await advance();
  const [oldInput, newInput] = document.querySelectorAll("input");
  assert.equal(oldInput.value, "");
  assert.equal(newInput.value, "fresh");
  assert.equal(window.location.hash, "#/next");
  stop();
});

test("通常のハッシュ遷移やpagehideでも待機を終了する", async () => {
  for (const action of ["hash", "pagehide"]) {
    const { window, document } = createPage("", "#url-autofill:fill(input%5Bname%3Dlate%5D)=stale");
    const stop = start(document);
    if (action === "hash") window.location.hash = "#/other";
    else window.dispatchEvent(new window.PageTransitionEvent("pagehide"));
    await advance();
    document.body.innerHTML = '<input name="late">';
    await advance();
    assert.equal(document.querySelector("input")?.value, "");
    stop();
  }
});

test("不正なURLも整理し，URL整理に失敗した場合は入力しない", async () => {
  for (const failHistory of [false, true]) {
    const { window, document } = createPage(
      '<input name="email">',
      `#url-autofill:fill(input%5Bname%3Demail%5D)=${failHistory ? "value" : "%FF"}`,
    );
    if (failHistory)
      vi.spyOn(window.history, "replaceState").mockImplementation(() => {
        throw new Error("blocked");
      });
    const stop = start(document);
    await advance();
    assert.equal(document.querySelector("input")?.value, "");
    if (!failHistory) assert.equal(window.location.hash, "");
    stop();
  }
});

test("20件を超える項目を分割して処理する", async () => {
  const html = Array.from({ length: 45 }, (_, i) => `<input name="field${i}">`).join("");
  const payload = Array.from(
    { length: 45 },
    (_, i) => `fill(input%5Bname%3Dfield${i}%5D)=${i}`,
  ).join("&");
  const { document } = createPage(html, `#url-autofill:${payload}`);
  const stop = start(document);
  await advance(16);
  assert.equal(
    Array.from(document.querySelectorAll("input")).filter((item) => item.value !== "").length,
    20,
  );
  await advance(32);
  assert.deepEqual(
    Array.from(document.querySelectorAll("input"), (item) => item.value),
    Array.from({ length: 45 }, (_, i) => String(i)),
  );
  stop();
});

test("待機を10秒で打ち切り，後から追加された入力欄を変更しない", async () => {
  const { document, logs } = createPage("", "#url-autofill:fill(input%5Bname%3Dlate%5D)=value");
  const stop = start(document);
  await advance(DOM_WAIT_MS - 1);
  assert.ok(logs.every((line) => !line.includes("待機終了")));
  await advance(1);
  assert.ok(logs.some((line) => line.includes("待機終了: 1件")));
  assert.equal(vi.getTimerCount(), 0);
  document.body.innerHTML = '<input name="late">';
  await advance();
  assert.equal(document.querySelector("input")?.value, "");
  stop();
});
