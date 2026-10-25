// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { FillTarget } from "../src/content/parser.ts";
import { createTargetCheck } from "../src/popup/components/target-check.ts";
import { TARGET_CHECK_TYPE } from "../src/shared/target-check.ts";

const url = "https://example.com/form?q=1";
const page = { tabId: 7, url };
const email: FillTarget = { kind: "field", value: "email" };
const sendMessage = vi.fn();
const onResult = vi.fn();
let status: HTMLElement;
let check: ReturnType<typeof createTargetCheck>;

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage.mockReset().mockResolvedValue({ url, status: "found" });
  onResult.mockReset();
  vi.stubGlobal("chrome", { tabs: { sendMessage } });
  status = document.createElement("p");
  check = createTargetCheck(status, onResult);
});

afterEach(() => {
  check.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("入力停止から300ms後に問い合わせ，同じ指定なら再検索しない", async () => {
  check.update(email, url, page);
  expect(status.textContent).toBe("確認中…");
  await vi.advanceTimersByTimeAsync(200);
  check.update({ ...email, value: "username" }, url, page);
  await vi.advanceTimersByTimeAsync(299);
  expect(sendMessage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
    7,
    { type: TARGET_CHECK_TYPE, target: { kind: "field", value: "username" } },
    { frameId: 0 },
  );
  expect(status.textContent).toBe("見つかりました");
  check.update({ ...email, value: "username" }, url, page);
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

test.each([
  ["missing", "現在のページでは見つかりません"],
  ["ambiguous", "複数見つかりました。CSSセレクタで絞ってください"],
  ["invalid-selector", "CSSセレクタの構文を確認してください"],
])("検索結果%sを表示する", async (result, message) => {
  sendMessage.mockResolvedValue({ url, status: result });
  check.update(email, url, page);
  await vi.advanceTimersByTimeAsync(300);
  expect(status.hidden).toBe(false);
  expect(status.textContent).toBe(message);
});

test("入力変更後に届いた古い結果で新しい結果を上書きしない", async () => {
  let reply: (response: unknown) => void = () => {};
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      reply = resolve;
    }),
  );
  check.update(email, url, page);
  await vi.advanceTimersByTimeAsync(300);
  sendMessage.mockResolvedValueOnce({ url, status: "missing" });
  check.update({ kind: "selector", value: "#username" }, url, page);
  await vi.advanceTimersByTimeAsync(300);
  reply({ url, status: "found" });
  await Promise.resolve();
  expect(status.textContent).toBe("現在のページでは見つかりません");
});

test("同じ指定でも読み込み完了後は再確認し，前の文書からの応答を破棄する", async () => {
  let oldReply: (response: unknown) => void = () => {};
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      oldReply = resolve;
    }),
  );
  check.update(email, url, page);
  await vi.advanceTimersByTimeAsync(300);
  const response = {
    url,
    status: "found",
    radio: {
      mode: "group",
      group: "plan",
      options: [{ label: "B", value: "b", disabled: false }],
    },
  };
  sendMessage.mockResolvedValueOnce(response);
  check.update(email, url, { ...page, documentVersion: 1 });
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(status.textContent).toBe("見つかりました");
  oldReply({ url, status: "found", radio: { mode: "direct", value: "old" } });
  await Promise.resolve();
  expect(status.textContent).toBe("見つかりました");
  expect(onResult).toHaveBeenLastCalledWith(response);
  check.update(email, url, { ...page, documentVersion: 1 });
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

test("別のURLでは問い合わせず，確認中にページが変わった場合も一致と表示しない", async () => {
  check.update(email, "https://other.example/", page);
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(status.textContent).toBe("現在のページとURLが異なるため確認できません");
  expect(onResult).toHaveBeenLastCalledWith(null);

  sendMessage.mockResolvedValue({ url: "https://example.com/next", status: "found" });
  check.update(email, url, page);
  await vi.advanceTimersByTimeAsync(300);
  expect(status.textContent).toBe("現在のページとURLが異なるため確認できません");
});

test("取得中・空欄・無効なURLでは結果を消し，取得失敗時は確認不可と表示する", async () => {
  check.update(email, url, undefined);
  expect(status.hidden).toBe(true);
  check.update(email, url, null);
  expect(status.textContent).toBe("このページでは確認できません");
  check.update(email, url, page);
  check.update(null, url, page);
  expect(status.hidden).toBe(true);
  check.update(email, "", page);
  expect(status.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).not.toHaveBeenCalled();
});

test.each(["reject", "invalid"])("通信失敗や不正な応答では確認不可と表示する: %s", async (mode) => {
  if (mode === "reject") sendMessage.mockRejectedValue(new Error("receiving end does not exist"));
  else sendMessage.mockResolvedValue({ url, status: "other" });
  check.update(email, url, page);
  await vi.advanceTimersByTimeAsync(300);
  expect(status.textContent).toBe("このページでは確認できません");
});

test("項目の削除後は問い合わせや遅れて届く結果を反映しない", async () => {
  let reply: (response: unknown) => void = () => {};
  sendMessage.mockReturnValueOnce(
    new Promise((resolve) => {
      reply = resolve;
    }),
  );
  check.update(email, url, page);
  await vi.advanceTimersByTimeAsync(300);
  check.dispose();
  status.textContent = "削除済み";
  reply({ url, status: "found" });
  await Promise.resolve();
  expect(status.textContent).toBe("削除済み");

  check.update({ ...email, value: "username" }, url, page);
  check.dispose();
  await vi.advanceTimersByTimeAsync(300);
  expect(sendMessage).toHaveBeenCalledTimes(1);
});
