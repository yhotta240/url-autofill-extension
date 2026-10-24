import "./popup.css";
import "bootstrap/js/dist/tab.js";
import "bootstrap/js/dist/collapse.js";
import { isSidePanel } from "./components/display-mode.ts";
import { applyTheme, getTheme } from "./components/theme";
import { PopupManager } from "./manager";

document.documentElement.classList.toggle("sidepanel", isSidePanel());

try {
  // フラッシュ防止のため先にテーマを適用
  const theme = getTheme();
  applyTheme(theme);
} catch (_e) {
  // ignore
}

document.addEventListener("DOMContentLoaded", () => new PopupManager());
