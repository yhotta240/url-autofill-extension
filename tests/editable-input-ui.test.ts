// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createEditableInput } from "../src/popup/components/editable-input.ts";
import type { InputMethod } from "../src/shared/input-method.ts";
import { TARGET_TEST_TYPE } from "../src/shared/target-test.ts";

const html = readFileSync("public/popup.html", "utf8");
const page = { tabId: 7, url: "https://example.com/form" };
const query = vi.fn();
const send = vi.fn();
const write = vi.fn();
const disposables: Array<() => void> = [];
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup(initial?: InputMethod) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const template = parsed.querySelector<HTMLTemplateElement>("#generator-item-template");
  if (!template) throw new Error("template missing");
  const item = template.content.cloneNode(true) as DocumentFragment;
  document.body.append(item);
  const containers = document.querySelectorAll<HTMLElement>("[data-editable-input]");
  const container = containers[containers.length - 1];
  const target = container.closest("fieldset")?.querySelector<HTMLInputElement>("[data-target]");
  const value = container.closest("fieldset")?.querySelector<HTMLTextAreaElement>("[data-value]");
  let select = document.querySelector<HTMLSelectElement>("#generator-input-method");
  if (!select) {
    select = parsed.querySelector<HTMLSelectElement>("#generator-input-method");
    if (select) document.body.prepend(select);
  }
  const button = container.querySelector<HTMLButtonElement>("[data-input-test]");
  const status = container.querySelector<HTMLElement>("[data-input-test-status]");
  if (!target || !value || !select || !button || !status) throw new Error("controls missing");
  target.value = "#editor";
  value.value = "テスト";
  if (initial) select.value = initial;
  const control = createEditableInput(container, target, value, select);
  disposables.push(control.dispose);
  control.updatePage(page.url, page);
  const found = () =>
    control.setInfo({
      url: page.url,
      status: "found",
      targetInfo: { label: "本文", type: "contenteditable" },
    });
  const choose = (method: InputMethod) => {
    select.value = method;
    select.dispatchEvent(new Event("change"));
  };
  return { ...control, container, target, value, select, button, status, found, choose };
}

beforeEach(() => {
  query.mockReset().mockResolvedValue([{ id: page.tabId, url: page.url }]);
  send.mockReset().mockResolvedValue({ url: page.url, result: "paste-dispatched" });
  write.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("chrome", { tabs: { query, sendMessage: send } });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
});
afterEach(async () => {
  for (const dispose of disposables.splice(0)) dispose();
  await flush();
  document.body.replaceChildren();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
});

test("入力値の右のテストだけをcontenteditableで表示し，共通の既定は実paste", () => {
  const ui = setup();
  expect(ui.button.hidden).toBe(true);
  ui.found();
  expect(ui.button.hidden).toBe(false);
  expect(ui.select.value).toBe("clipboard-paste");
  ui.setInfo(null);
  expect(ui.button.hidden).toBe(true);
  ui.setInfo({ url: page.url, status: "found", targetInfo: { label: "名前", type: "text" } });
  expect(ui.button.hidden).toBe(true);
});

test("その項目だけを一度テストし，実行済みを成功と断定しない", async () => {
  const ui = setup("paste-event");
  ui.found();
  ui.button.click();
  ui.button.click();
  expect(ui.button.disabled).toBe(true);
  await flush();
  expect(send).toHaveBeenCalledExactlyOnceWith(
    page.tabId,
    {
      type: TARGET_TEST_TYPE,
      pageUrl: page.url,
      selector: "#editor",
      value: "テスト",
      method: "paste-event",
    },
    { frameId: 0 },
  );
  expect(ui.status.textContent).toBe("実行しました．入力先を確認してください．");
  expect(ui.button.disabled).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

test("実クリップボードの書き込み後にテスト要求を送り，失敗時は送らない", async () => {
  const ui = setup("clipboard-paste");
  ui.found();
  const order: string[] = [];
  write.mockImplementation(async () => {
    order.push("write");
  });
  send.mockImplementation(async () => {
    order.push("send");
    return { url: page.url, result: "command-dispatched" };
  });
  ui.button.click();
  await flush();
  expect(order).toEqual(["write", "send"]);
  write.mockRejectedValue(new Error("denied"));
  ui.button.click();
  await flush();
  expect(send).toHaveBeenCalledOnce();
  expect(ui.status.textContent).toContain("書き込めません");
});

test("現在のタブが変わった場合はクリップボードも対象も変更しない", async () => {
  const ui = setup("clipboard-paste");
  ui.found();
  query.mockResolvedValue([{ id: 9, url: page.url }]);
  ui.button.click();
  await flush();
  expect(send).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(ui.status.textContent).toContain("異なります");
});

test("入力や方式変更後に届いた古いテスト応答を表示しない", async () => {
  const ui = setup();
  ui.found();
  let resolve: ((value: unknown) => void) | undefined;
  send.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  ui.button.click();
  await flush();
  ui.choose("insert-text");
  resolve?.({ url: page.url, result: "paste-dispatched" });
  await flush();
  expect(ui.status.textContent).toBe("");
  expect(ui.button.disabled).toBe(false);
});

test("全項目が共通方式を使い，別項目のテストも実行中は無効化する", async () => {
  const first = setup("paste-event");
  const second = setup();
  first.found();
  second.found();
  first.choose("insert-text");
  let resolve: ((value: unknown) => void) | undefined;
  send.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  first.button.click();
  await flush();
  expect(second.button.disabled).toBe(true);
  second.button.click();
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][1].method).toBe("insert-text");
  expect(write).not.toHaveBeenCalled();
  resolve?.({ url: page.url, result: "paste-dispatched" });
  await flush();
  expect(second.button.disabled).toBe(false);
});
