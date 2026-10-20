import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";
import { startAutofill } from "../src/content/controller.ts";
import { DOM_WAIT_MS } from "../src/content/runner.ts";

const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function createPage(html: string, hash = "") {
  const logs: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("warn", (message) => logs.push(String(message)));
  virtualConsole.on("info", (message) => logs.push(String(message)));
  const dom = new JSDOM(html, {
    url: `https://example.com/form?q=1${hash}`,
    pretendToBeVisual: true,
    virtualConsole,
  });
  return { dom, window: dom.window, document: dom.window.document, logs };
}

test("URLを入力前に整理し，履歴stateを保持して一度だけ入力する", async () => {
  const { dom, window, document, logs } = createPage(
    '<input name="email">',
    "#/settings#url-autofill:email=private%40example.com",
  );
  window.history.replaceState({ route: "settings" }, "");
  const urls: string[] = [];
  document.addEventListener("input", () => urls.push(window.location.href));
  const stop = startAutofill(document);
  assert.equal(window.location.href, "https://example.com/form?q=1#/settings");
  assert.deepEqual(window.history.state, { route: "settings" });
  await wait();
  assert.equal(document.querySelector("input")?.value, "private@example.com");
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  await wait();
  assert.deepEqual(urls, ["https://example.com/form?q=1#/settings"]);
  assert.ok(logs.some((line) => line.includes("入力完了: 1件")));
  assert.ok(logs.every((line) => !line.includes("private")));
  stop();
  dom.window.close();
});

test("遅れて追加される入力欄とselectの選択肢を待ち，入力済み項目は上書きしない", async () => {
  const { window, document } = createPage(
    '<input name="first"><select name="choice"></select>',
    "#url-autofill:first=initial&late=arrived&choice=b",
  );
  const stop = startAutofill(document);
  await wait();
  const first = document.querySelector("input");
  assert.ok(first);
  first.value = "user edit";
  const late = document.createElement("input");
  late.name = "late";
  document.body.append(late);
  document.querySelector("select")?.append(new window.Option("B", "b"));
  await wait();
  assert.equal(first.value, "user edit");
  assert.equal(late.value, "arrived");
  assert.equal(document.querySelector("select")?.value, "b");
  stop();
  window.close();
});

test("hashchangeで新しい指定を処理し，古い待機をキャンセルする", async () => {
  const { window, document } = createPage("", "#url-autofill:old=stale");
  const stop = startAutofill(document);
  await wait();
  window.location.hash = "#/next#url-autofill:new=fresh";
  await wait();
  document.body.innerHTML = '<input name="old"><input name="new">';
  await wait();
  const [oldInput, newInput] = document.querySelectorAll("input");
  assert.equal(oldInput.value, "");
  assert.equal(newInput.value, "fresh");
  assert.equal(window.location.hash, "#/next");
  stop();
  window.close();
});

test("通常のハッシュ遷移やpagehideでも待機を終了する", async () => {
  for (const action of ["hash", "pagehide"]) {
    const { window, document } = createPage("", "#url-autofill:late=stale");
    const stop = startAutofill(document);
    if (action === "hash") window.location.hash = "#/other";
    else window.dispatchEvent(new window.PageTransitionEvent("pagehide"));
    await wait();
    document.body.innerHTML = '<input name="late">';
    await wait();
    assert.equal(document.querySelector("input")?.value, "");
    stop();
    window.close();
  }
});

test("不正なURLも整理し，URL整理に失敗した場合は入力しない", async () => {
  for (const failHistory of [false, true]) {
    const { window, document } = createPage(
      '<input name="email">',
      `#url-autofill:email=${failHistory ? "value" : "%FF"}`,
    );
    if (failHistory)
      window.history.replaceState = () => {
        throw new Error("blocked");
      };
    const stop = startAutofill(document);
    await wait();
    assert.equal(document.querySelector("input")?.value, "");
    if (!failHistory) assert.equal(window.location.hash, "");
    stop();
    window.close();
  }
});

test("20件を超える項目を分割して処理する", async () => {
  const html = Array.from({ length: 45 }, (_, i) => `<input name="field${i}">`).join("");
  const payload = Array.from({ length: 45 }, (_, i) => `field${i}=${i}`).join("&");
  const { window, document } = createPage(html, `#url-autofill:${payload}`);
  const stop = startAutofill(document);
  await wait(150);
  assert.deepEqual(
    Array.from(document.querySelectorAll("input"), (item) => item.value),
    Array.from({ length: 45 }, (_, i) => String(i)),
  );
  stop();
  window.close();
});

test("待機を10秒で打ち切り，後から追加された入力欄を変更しない", async () => {
  const { window, document, logs } = createPage("", "#url-autofill:late=value");
  const stop = startAutofill(document);
  await wait(DOM_WAIT_MS + 100);
  assert.ok(logs.some((line) => line.includes("待機終了: 1件")));
  document.body.innerHTML = '<input name="late">';
  await wait();
  assert.equal(document.querySelector("input")?.value, "");
  stop();
  window.close();
});
