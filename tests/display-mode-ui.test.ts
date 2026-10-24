// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setupDisplayModeSwitch } from "../src/popup/components/display-mode.ts";
import { SWITCH_DISPLAY_MODE } from "../src/shared/display-mode.ts";

const sendMessage = vi.fn();
const getWindow = vi.fn();
let button: HTMLButtonElement;
let status: HTMLElement;

beforeEach(() => {
  document.body.innerHTML =
    '<button id="display-mode-button" hidden><svg><path/></svg></button><p id="display-mode-status" hidden></p>';
  button = document.getElementById("display-mode-button") as HTMLButtonElement;
  status = document.getElementById("display-mode-status") as HTMLElement;
  window.history.replaceState(null, "", "/popup.html");
  sendMessage.mockReset().mockResolvedValue({ ok: true });
  getWindow.mockReset().mockResolvedValue({ id: 12 });
  vi.stubGlobal("chrome", {
    sidePanel: { open() {}, close() {} },
    action: { openPopup() {} },
    windows: { getCurrent: getWindow },
    runtime: { sendMessage },
  });
  vi.spyOn(window, "close").mockImplementation(() => {});
});
afterEach(() => {
  window.history.replaceState(null, "", "/form?q=1");
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("Popupからの切替成功時は画面を閉じ，入力内容を送信しない", async () => {
  await setupDisplayModeSwitch();
  expect(button.hidden).toBe(false);
  expect(button.title).toBe("サイドパネルで開く");
  button.click();
  await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
    type: SWITCH_DISPLAY_MODE,
    mode: "sidepanel",
    windowId: 12,
  });
});

test("サイドパネルでは戻る操作を送信し，閉じる処理はService Workerに任せる", async () => {
  window.history.replaceState(null, "", "/popup.html?view=sidepanel");
  await setupDisplayModeSwitch();
  expect(button.getAttribute("aria-label")).toBe("ポップアップに戻る");
  button.click();
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
  expect(sendMessage).toHaveBeenCalledWith({
    type: SWITCH_DISPLAY_MODE,
    mode: "popup",
    windowId: 12,
  });
  expect(window.close).not.toHaveBeenCalled();
});

test("処理中の連打を防ぎ，失敗時は元の画面で再試行できる", async () => {
  let finish: (value: { ok: boolean }) => void = () => {};
  sendMessage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await setupDisplayModeSwitch();
  button.click();
  button.click();
  expect(button.disabled).toBe(true);
  expect(sendMessage).toHaveBeenCalledOnce();
  finish({ ok: false });
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(status.hidden).toBe(false);
  expect(status.textContent).toBe("表示方法を切り替えられませんでした．");
  expect(window.close).not.toHaveBeenCalled();
});

test("通信の失敗も画面内に表示する", async () => {
  sendMessage.mockRejectedValue(new Error("unavailable"));
  await setupDisplayModeSwitch();
  button.click();
  await vi.waitFor(() => expect(status.hidden).toBe(false));
  expect(button.disabled).toBe(false);
});

test("必要なAPIがない環境ではアイコンを表示しない", async () => {
  vi.stubGlobal("chrome", { ...chrome, sidePanel: {} });
  await setupDisplayModeSwitch();
  expect(button.hidden).toBe(true);
  expect(getWindow).not.toHaveBeenCalled();
});
