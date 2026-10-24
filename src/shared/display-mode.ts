export type DisplayMode = "popup" | "sidepanel";
export const DISPLAY_MODE_KEY = "displayMode";
export const SWITCH_DISPLAY_MODE = "url-autofill:switch-display-mode";
export type DisplayModeRequest = {
  type: typeof SWITCH_DISPLAY_MODE;
  mode: DisplayMode;
  windowId: number;
};
export type DisplayModeResponse = { ok: boolean };

export function canSwitchDisplayMode(): boolean {
  return (
    typeof chrome.sidePanel?.open === "function" &&
    typeof chrome.sidePanel?.close === "function" &&
    typeof chrome.action?.openPopup === "function"
  );
}
