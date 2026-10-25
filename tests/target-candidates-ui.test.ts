// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTargetCandidates } from "../src/popup/components/target-candidates.ts";
import { setupUrlGenerator } from "../src/popup/components/url-generator.ts";
import { TARGET_CANDIDATES_TYPE } from "../src/shared/target-candidates.ts";

const url = "https://example.com/form?q=1";
const page = { tabId: 7, url };
const sendMessage = vi.fn();
let input: HTMLInputElement;
let panel: HTMLElement;
let candidates: ReturnType<typeof createTargetCandidates>;

function options(): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('[role="option"]')];
}
function type(value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function key(value: string, composing = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    isComposing: composing,
  });
  input.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<input id="target" value="email"><div data-panel hidden><ul data-candidate-list role="listbox"></ul><p data-candidate-status role="status"></p></div>';
  input = document.querySelector("input") as HTMLInputElement;
  panel = document.querySelector("[data-panel]") as HTMLElement;
  sendMessage
    .mockReset()
    .mockResolvedValue({ url, candidates: ["email", "EmailAddress", "username"] });
  vi.stubGlobal("chrome", {
    tabs: { sendMessage, query: vi.fn().mockResolvedValue([{ id: page.tabId, url }]) },
  });
  candidates = createTargetCandidates(input, panel);
  candidates.update(url, page);
});

afterEach(() => {
  candidates.dispose();
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("フォーカス時は入力内容を変えず全候補を取得し，入力中は通信せず部分一致で絞る", async () => {
  expect(sendMessage).not.toHaveBeenCalled();
  input.focus();
  expect(panel.textContent).toContain("候補を取得しています");
  await Promise.resolve();
  expect(input.value).toBe("email");
  expect(options().map((option) => option.textContent)).toEqual([
    "email",
    "EmailAddress",
    "username",
  ]);
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
    7,
    { type: TARGET_CANDIDATES_TYPE },
    { frameId: 0 },
  );
  type("MAIL");
  expect(options().map((option) => option.textContent)).toEqual(["email", "EmailAddress"]);
  type("unknown");
  expect(panel.textContent).toContain("一致する候補がありません");
  expect(sendMessage).toHaveBeenCalledTimes(1);
  input.blur();
  input.focus();
  await Promise.resolve();
  expect(options()).toHaveLength(3);
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

test("マウス選択で入力イベントを発火し，フォーカスを保ったまま候補を閉じる", async () => {
  input.focus();
  await Promise.resolve();
  const changed = vi.fn();
  input.addEventListener("input", changed);
  const option = options()[2];
  const pointer = new Event("pointerdown", { bubbles: true, cancelable: true });
  option.dispatchEvent(pointer);
  expect(pointer.defaultPrevented).toBe(true);
  option.click();
  expect(input.value).toBe("username");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(input);
  expect(panel.hidden).toBe(true);
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

test("上下キーで移動し，IME中は確定せずEnterで選択する", async () => {
  input.focus();
  await Promise.resolve();
  key("ArrowUp");
  expect(input.getAttribute("aria-activedescendant")).toBe(options()[2].id);
  expect(options()[2].getAttribute("aria-selected")).toBe("true");
  key("ArrowDown");
  key("ArrowDown");
  expect(options()[1].getAttribute("aria-selected")).toBe("true");
  expect(panel.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  expect(key("Enter", true).defaultPrevented).toBe(false);
  expect(input.value).toBe("email");
  expect(key("Enter").defaultPrevented).toBe(true);
  expect(input.value).toBe("EmailAddress");
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  expect(panel.hidden).toBe(true);
});

test("Escape・フォーカス離脱では手入力を維持し，閉じた後の応答を表示しない", async () => {
  let reply: (value: unknown) => void = () => {};
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      reply = resolve;
    }),
  );
  input.focus();
  type("custom");
  key("Escape");
  reply({ url, candidates: ["late"] });
  await Promise.resolve();
  expect(panel.hidden).toBe(true);
  expect(input.value).toBe("custom");
  input.blur();
  input.focus();
  await Promise.resolve();
  input.blur();
  expect(panel.hidden).toBe(true);
  expect(input.value).toBe("custom");
});

test("タブ・文書の変更時は再取得し，古い候補を破棄する", async () => {
  let oldReply: (value: unknown) => void = () => {};
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      oldReply = resolve;
    }),
  );
  input.focus();
  candidates.update(url, { ...page, tabId: 9 });
  await Promise.resolve();
  oldReply({ url, candidates: ["old"] });
  await Promise.resolve();
  expect(options().map((option) => option.textContent)).not.toContain("old");
  candidates.update(url, { ...page, documentVersion: 1 });
  await Promise.resolve();
  expect(sendMessage).toHaveBeenCalledTimes(3);
  candidates.update(url, { ...page, tabId: 8 });
  await Promise.resolve();
  expect(sendMessage.mock.lastCall?.[0]).toBe(8);
  input.blur();
  candidates.update(url, page);
  expect(sendMessage).toHaveBeenCalledTimes(4);
});

test("現在ページの取得中は待ち，URL不一致や非対応ページでは問い合わせない", async () => {
  candidates.update(url, undefined);
  input.focus();
  expect(panel.textContent).toContain("候補を取得しています");
  candidates.update(url, null);
  expect(panel.textContent).toContain("このページでは候補を取得できません");
  candidates.update("https://other.example/", page);
  expect(panel.textContent).toContain("現在のページとURLが異なるため");
  expect(sendMessage).not.toHaveBeenCalled();
  candidates.update(url, page);
  await Promise.resolve();
  expect(options()).toHaveLength(3);
});

test.each([
  "empty",
  "reject",
  "invalid",
  "different-url",
])("候補なしと通信・応答の失敗を区別する: %s", async (mode) => {
  if (mode === "reject") sendMessage.mockRejectedValue(new Error("no receiver"));
  else if (mode === "invalid") sendMessage.mockResolvedValue({ url, candidates: [7] });
  else
    sendMessage.mockResolvedValue({
      url: mode === "different-url" ? "https://other.example/" : url,
      candidates: [],
    });
  input.focus();
  await Promise.resolve();
  expect(options()).toHaveLength(0);
  expect(panel.textContent).toContain(
    mode === "empty" ? "候補がありません" : "候補を取得できません",
  );
});

test("項目の破棄後は応答を反映せず，再フォーカスでも問い合わせない", async () => {
  let reply: (value: unknown) => void = () => {};
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      reply = resolve;
    }),
  );
  input.focus();
  candidates.dispose();
  reply({ url, candidates: ["late"] });
  await Promise.resolve();
  expect(panel.hidden).toBe(true);
  input.blur();
  input.focus();
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

test("選択したCSSセレクタをURL生成・存在確認へ反映する", async () => {
  candidates.dispose();
  const parsed = new DOMParser().parseFromString(
    readFileSync("public/popup.html", "utf8"),
    "text/html",
  );
  document.body.innerHTML = parsed.getElementById("settings")?.outerHTML ?? "";
  sendMessage.mockImplementation((_tabId, message) =>
    Promise.resolve(
      message.type === TARGET_CANDIDATES_TYPE
        ? { url, candidates: ["#username"] }
        : { url, status: "found" },
    ),
  );
  setupUrlGenerator();
  await vi.advanceTimersByTimeAsync(0);
  input = document.querySelector("[data-target]") as HTMLInputElement;
  panel = document.querySelector("[data-target-candidates]") as HTMLElement;
  input.focus();
  await Promise.resolve();
  options()[0].click();
  expect(document.getElementById("generator-result")?.textContent).toContain(
    "fill(%23username)=test%40example.com",
  );
  await vi.advanceTimersByTimeAsync(300);
  expect(document.querySelector("[data-target-status]")?.textContent).toBe("見つかりました");
});
