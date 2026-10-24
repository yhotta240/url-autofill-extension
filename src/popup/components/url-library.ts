import { getCurrentPage } from "../current-page.ts";
import { setupSavedUrlList } from "./saved-urls.ts";
import { setupUrlGenerator } from "./url-generator.ts";

export function setupUrlLibrary(root: Document = document): void {
  if (!root.querySelector("#url-generator")) return;
  const currentPage = getCurrentPage();
  function showTab(id: string): void {
    root.getElementById(id)?.click();
  }
  const generator = setupUrlGenerator(root, {
    currentPage,
    onUpdated: () => showTab("saved-urls-tab"),
  });
  setupSavedUrlList(root, {
    currentPage,
    onEdit: (item) => {
      if (generator?.edit(item)) {
        showTab("settings-tab");
        root.getElementById("generator-page-url")?.focus();
      }
    },
  });
}
