import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getCurrentPage, watchCurrentPage } from "../src/popup/current-page.ts";

const query = vi.fn();
const removeActivated = vi.fn();
const removeUpdated = vi.fn();
let activated: Parameters<typeof chrome.tabs.onActivated.addListener>[0];
let updated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0];

beforeEach(() => {
  query.mockReset().mockResolvedValue([{ id: 1, url: "https://example.com/" }]);
  removeActivated.mockReset();
  removeUpdated.mockReset();
  vi.stubGlobal("chrome", {
    tabs: {
      query,
      onActivated: {
        addListener: (callback: typeof activated) => {
          activated = callback;
        },
        removeListener: removeActivated,
      },
      onUpdated: {
        addListener: (callback: typeof updated) => {
          updated = callback;
        },
        removeListener: removeUpdated,
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

test("Popupは現在ウィンドウから一度だけ取得する", async () => {
  expect(await getCurrentPage()).toEqual({ tabId: 1, url: "https://example.com/" });
  expect(query).toHaveBeenCalledExactlyOnceWith({ active: true, currentWindow: true });
});

test("指定ウィンドウに限定してタブ切替とURL変更に追従する", async () => {
  const change = vi.fn();
  const watcher = watchCurrentPage(12, change);
  expect(await watcher.initial).toEqual({ tabId: 1, url: "https://example.com/" });
  expect(query).toHaveBeenCalledExactlyOnceWith({ active: true, windowId: 12 });
  activated({ tabId: 2, windowId: 99 });
  updated(2, { url: "https://other.example/" }, {
    id: 2,
    active: true,
    windowId: 99,
  } as chrome.tabs.Tab);
  expect(query).toHaveBeenCalledOnce();
  query.mockResolvedValue([{ id: 2, url: "https://other.example/" }]);
  activated({ tabId: 2, windowId: 12 });
  await vi.waitFor(() =>
    expect(change).toHaveBeenCalledWith({ tabId: 2, url: "https://other.example/" }),
  );
  query.mockResolvedValue([{ id: 2, url: "chrome://settings/" }]);
  updated(2, { url: "chrome://settings/" }, {
    id: 2,
    active: true,
    windowId: 12,
  } as chrome.tabs.Tab);
  await vi.waitFor(() => expect(change).toHaveBeenLastCalledWith(null));
  watcher.dispose();
});

test("背景タブの変更と同じページの重複通知を無視する", async () => {
  const change = vi.fn();
  const watcher = watchCurrentPage(12, change);
  await watcher.initial;
  updated(2, { url: "https://other.example/" }, {
    id: 2,
    active: false,
    windowId: 12,
  } as chrome.tabs.Tab);
  expect(query).toHaveBeenCalledOnce();
  activated({ tabId: 1, windowId: 12 });
  await Promise.resolve();
  await Promise.resolve();
  expect(change).not.toHaveBeenCalled();
  watcher.dispose();
});

test("同じタブとURLでも読み込み完了を通知し，再読み込みごとに確認を更新できる", async () => {
  const change = vi.fn();
  const watcher = watchCurrentPage(12, change);
  await watcher.initial;
  const tab = { id: 1, active: true, windowId: 12 } as chrome.tabs.Tab;
  updated(1, { status: "complete" }, tab);
  await vi.waitFor(() => expect(change).toHaveBeenCalledOnce());
  const first = change.mock.calls[0][0];
  expect(first).toMatchObject({ tabId: 1, url: "https://example.com/" });
  expect(first.documentVersion).toBeTypeOf("number");
  updated(1, { status: "complete" }, tab);
  await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(2));
  expect(change.mock.calls[1][0].documentVersion).not.toBe(first.documentVersion);
  watcher.dispose();
});

test("初回取得より新しい取得結果を優先し，遅れた応答と終了後の応答を破棄する", async () => {
  let oldResponse: (tabs: Array<{ id: number; url: string }>) => void = () => {};
  query.mockReturnValueOnce(
    new Promise((resolve) => {
      oldResponse = resolve;
    }),
  );
  const change = vi.fn();
  const watcher = watchCurrentPage(12, change);
  query.mockResolvedValue([{ id: 2, url: "https://new.example/" }]);
  activated({ tabId: 2, windowId: 12 });
  expect(await watcher.initial).toEqual({ tabId: 2, url: "https://new.example/" });
  oldResponse([{ id: 1, url: "https://old.example/" }]);
  await Promise.resolve();
  expect(change).not.toHaveBeenCalled();
  query.mockResolvedValue([{ id: 3, url: "https://late.example/" }]);
  activated({ tabId: 3, windowId: 12 });
  watcher.dispose();
  await Promise.resolve();
  await Promise.resolve();
  expect(change).not.toHaveBeenCalled();
  expect(removeActivated).toHaveBeenCalledWith(activated);
  expect(removeUpdated).toHaveBeenCalledWith(updated);
});
