import {
  canSwitchDisplayMode,
  DISPLAY_MODE_KEY,
  type DisplayMode,
  type DisplayModeResponse,
  SWITCH_DISPLAY_MODE,
} from "../shared/display-mode.ts";

async function applyMode(mode: DisplayMode): Promise<void> {
  await chrome.action.setPopup({ popup: mode === "popup" ? "popup.html" : "" });
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === "sidepanel" });
  }
}

async function openPopup(windowId: number): Promise<void> {
  await chrome.action.setPopup({ popup: "popup.html" });
  await chrome.action.openPopup({ windowId });
  await chrome.sidePanel.close({ windowId });
}

export function setupDisplayMode(): void {
  const restore = async (): Promise<void> => {
    try {
      const data = await chrome.storage.local.get(DISPLAY_MODE_KEY);
      let mode: DisplayMode = "popup";
      if (data[DISPLAY_MODE_KEY] === "sidepanel" && canSwitchDisplayMode()) mode = "sidepanel";
      await applyMode(mode);
    } catch {
      console.error("表示方法を復元できませんでした．");
    }
  };
  chrome.runtime.onInstalled.addListener(() => {
    void restore();
  });
  chrome.runtime.onStartup.addListener(() => {
    void restore();
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (
      !message ||
      typeof message !== "object" ||
      !("type" in message) ||
      message.type !== SWITCH_DISPLAY_MODE
    )
      return;
    if (
      !("mode" in message) ||
      (message.mode !== "popup" && message.mode !== "sidepanel") ||
      !("windowId" in message) ||
      typeof message.windowId !== "number" ||
      !Number.isInteger(message.windowId) ||
      message.windowId < 0 ||
      !canSwitchDisplayMode()
    ) {
      sendResponse({ ok: false } satisfies DisplayModeResponse);
      return;
    }
    const { mode, windowId } = message;
    let opening: Promise<void>;
    try {
      // ユーザー操作の有効期間内に呼ぶため，この前にawaitを挟まない．
      if (mode === "sidepanel") opening = chrome.sidePanel.open({ windowId });
      else opening = openPopup(windowId);
    } catch {
      sendResponse({ ok: false } satisfies DisplayModeResponse);
      return;
    }
    const finish = async (): Promise<void> => {
      try {
        await opening;
        await applyMode(mode);
        await chrome.storage.local.set({ [DISPLAY_MODE_KEY]: mode });
        sendResponse({ ok: true } satisfies DisplayModeResponse);
      } catch {
        try {
          await applyMode(mode === "popup" ? "sidepanel" : "popup");
        } catch {
          console.error("表示方法を戻せませんでした．");
        }
        sendResponse({ ok: false } satisfies DisplayModeResponse);
      }
    };
    void finish();
    return true;
  });
}
