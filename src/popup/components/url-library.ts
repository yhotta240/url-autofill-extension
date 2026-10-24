import { type CurrentPage, getCurrentPage, watchCurrentPage } from "../current-page.ts";
import { isSidePanel } from "./display-mode.ts";
import { setupSavedUrlList } from "./saved-urls.ts";
import { setupUrlGenerator } from "./url-generator.ts";

export async function setupUrlLibrary(root: Document = document): Promise<void> {
  if (!root.querySelector("#url-generator")) return;
  let currentPage: Promise<CurrentPage | null>;
  if (isSidePanel(root)) {
    currentPage = Promise.resolve(null);
    try {
      const window = await chrome.windows.getCurrent();
      if (window.id !== undefined) {
        const watcher = watchCurrentPage(window.id, (page) => {
          generator?.updateCurrentPage(page);
          savedList?.updateCurrentPage(page);
        });
        currentPage = watcher.initial;
        root.defaultView?.addEventListener("pagehide", () => watcher.dispose(), { once: true });
      }
    } catch {
      // 現在ウィンドウが不明な場合も，手入力と全件表示は利用できる．
    }
  } else currentPage = getCurrentPage();
  function showTab(id: string): void {
    root.getElementById(id)?.click();
  }
  const generator = setupUrlGenerator(root, {
    currentPage,
    onUpdated: () => showTab("saved-urls-tab"),
  });
  const savedList = setupSavedUrlList(root, {
    currentPage,
    onEdit: (item) => {
      if (generator?.edit(item)) {
        showTab("settings-tab");
        root.getElementById("generator-page-url")?.focus();
      }
    },
  });
}
