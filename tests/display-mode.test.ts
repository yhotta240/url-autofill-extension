import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setupDisplayMode } from "../src/background/display-mode.ts";
import { DISPLAY_MODE_KEY, SWITCH_DISPLAY_MODE } from "../src/shared/display-mode.ts";

let message: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let installed: () => void;
let startup: () => void;
const get = vi.fn();
const set = vi.fn();
const setPopup = vi.fn();
const setBehavior = vi.fn();
const openPanel = vi.fn();
const closePanel = vi.fn();
const openPopup = vi.fn();

beforeEach(() => {
  get.mockReset().mockResolvedValue({});
  for (const mock of [set, setPopup, setBehavior, openPanel, closePanel, openPopup]) {
    mock.mockReset().mockResolvedValue(undefined);
  }
  vi.stubGlobal("chrome", {
    runtime: {
      onInstalled: {
        addListener: (callback: () => void) => {
          installed = callback;
        },
      },
      onStartup: {
        addListener: (callback: () => void) => {
          startup = callback;
        },
      },
      onMessage: {
        addListener: (callback: typeof message) => {
          message = callback;
        },
      },
    },
    action: { setPopup, openPopup },
    sidePanel: { open: openPanel, close: closePanel, setPanelBehavior: setBehavior },
    storage: { local: { get, set } },
  });
  setupDisplayMode();
});
afterEach(() => vi.unstubAllGlobals());

function switchMode(mode: "popup" | "sidepanel") {
  const response = vi.fn();
  const completed = new Promise<unknown>((resolve) => response.mockImplementation(resolve));
  const keepAlive = message({ type: SWITCH_DISPLAY_MODE, mode, windowId: 12 }, {}, response);
  return { response, completed, keepAlive };
}

test("ユーザー操作の同期処理でサイドパネルを開き，成功後に表示方法を保存する", async () => {
  let finishOpen: () => void = () => {};
  openPanel.mockReturnValue(
    new Promise<void>((resolve) => {
      finishOpen = resolve;
    }),
  );
  const request = switchMode("sidepanel");
  expect(request.keepAlive).toBe(true);
  expect(openPanel).toHaveBeenCalledExactlyOnceWith({ windowId: 12 });
  expect(get).not.toHaveBeenCalled();
  expect(setPopup).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  finishOpen();
  expect(await request.completed).toEqual({ ok: true });
  expect(setPopup).toHaveBeenLastCalledWith({ popup: "" });
  expect(setBehavior).toHaveBeenLastCalledWith({ openPanelOnActionClick: true });
  expect(set).toHaveBeenCalledExactlyOnceWith({ [DISPLAY_MODE_KEY]: "sidepanel" });
});

test("ポップアップを開いてから対象ウィンドウのサイドパネルを閉じる", async () => {
  expect(await switchMode("popup").completed).toEqual({ ok: true });
  expect(setPopup).toHaveBeenCalledWith({ popup: "popup.html" });
  expect(openPopup).toHaveBeenCalledExactlyOnceWith({ windowId: 12 });
  expect(closePanel).toHaveBeenCalledExactlyOnceWith({ windowId: 12 });
  expect(openPopup.mock.invocationCallOrder[0]).toBeLessThan(
    closePanel.mock.invocationCallOrder[0],
  );
  expect(setBehavior).toHaveBeenLastCalledWith({ openPanelOnActionClick: false });
  expect(set).toHaveBeenCalledExactlyOnceWith({ [DISPLAY_MODE_KEY]: "popup" });
});

test.each([
  "popup",
  "sidepanel",
] as const)("開く処理が失敗したら表示方法を記憶せず元に戻す: %s", async (mode) => {
  if (mode === "popup") openPopup.mockRejectedValueOnce(new Error("unavailable"));
  else openPanel.mockRejectedValueOnce(new Error("unavailable"));
  expect(await switchMode(mode).completed).toEqual({ ok: false });
  expect(set).not.toHaveBeenCalled();
  expect(closePanel).not.toHaveBeenCalled();
  expect(setPopup).toHaveBeenLastCalledWith({ popup: mode === "popup" ? "" : "popup.html" });
});

test("起動時に最後の表示方法を復元する", async () => {
  get.mockResolvedValue({ [DISPLAY_MODE_KEY]: "sidepanel" });
  startup();
  await vi.waitFor(() =>
    expect(setBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true }),
  );
  expect(setPopup).toHaveBeenCalledWith({ popup: "" });
  expect(openPanel).not.toHaveBeenCalled();
});

test("初期値と非対応環境ではポップアップを維持する", async () => {
  installed();
  await vi.waitFor(() =>
    expect(setBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false }),
  );
  expect(setPopup).toHaveBeenCalledWith({ popup: "popup.html" });
  setPopup.mockClear();
  get.mockResolvedValue({ [DISPLAY_MODE_KEY]: "sidepanel" });
  vi.stubGlobal("chrome", {
    ...chrome,
    sidePanel: { open: openPanel, setPanelBehavior: setBehavior },
  });
  startup();
  await vi.waitFor(() => expect(setPopup).toHaveBeenCalledWith({ popup: "popup.html" }));
});

test("別のメッセージは無視し，不正な切替要求は実行しない", () => {
  const response = vi.fn();
  expect(message({ type: "other" }, {}, response)).toBeUndefined();
  expect(response).not.toHaveBeenCalled();
  message({ type: SWITCH_DISPLAY_MODE, mode: "sidepanel", windowId: -1 }, {}, response);
  expect(response).toHaveBeenCalledWith({ ok: false });
  expect(openPanel).not.toHaveBeenCalled();
});
