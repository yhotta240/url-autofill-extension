import {
  canSwitchDisplayMode,
  type DisplayModeRequest,
  type DisplayModeResponse,
  SWITCH_DISPLAY_MODE,
} from "../../shared/display-mode.ts";

export function isSidePanel(root: Document = document): boolean {
  return new URL(root.URL).searchParams.get("view") === "sidepanel";
}

export async function setupDisplayModeSwitch(root: Document = document): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>("#display-mode-button");
  const icon = button?.querySelector("path");
  const status = root.getElementById("display-mode-status");
  if (!button || !icon || !status || !canSwitchDisplayMode()) return;
  try {
    const window = await chrome.windows.getCurrent();
    if (window.id === undefined) return;
    const windowId = window.id;
    const panel = isSidePanel(root);
    const label = panel ? "ポップアップに戻る" : "サイドパネルで開く";
    button.title = label;
    button.setAttribute("aria-label", label);
    icon.setAttribute("d", panel ? "M3 8h18" : "M15 3v18");
    button.hidden = false;
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      status.hidden = true;
      try {
        const response: DisplayModeResponse | undefined = await chrome.runtime.sendMessage({
          type: SWITCH_DISPLAY_MODE,
          mode: panel ? "popup" : "sidepanel",
          windowId,
        } satisfies DisplayModeRequest);
        if (!response?.ok) throw new Error("switch failed");
        if (!panel) root.defaultView?.close();
      } catch {
        status.textContent = "表示方法を切り替えられませんでした．";
        status.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  } catch {
    status.textContent = "表示切替を準備できませんでした．";
    status.hidden = false;
  }
}
