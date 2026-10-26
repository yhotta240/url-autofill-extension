import { parseAutofillUrl } from "./parser.ts";
import { startFilling } from "./runner.ts";

export function startAutofill(root: Document): () => void {
  const view = root.defaultView;
  if (!view || !["http:", "https:"].includes(view.location.protocol)) return () => {};

  let cancel = () => {};
  let lastUrl = "";
  function handleUrl(): void {
    const url = view?.location.href;
    if (!url || url === lastUrl) return;
    lastUrl = url;
    cancel();
    const request = parseAutofillUrl(url);
    if (!request || !view) return;

    try {
      view.history.replaceState(view.history.state, "", request.cleanUrl);
      lastUrl = view.location.href;
    } catch {
      view.console.warn("[URL AutoFill] URLを整理できないため入力を中止しました");
      return;
    }

    if (request.error) {
      view.console.warn(`[URL AutoFill] ${request.error}`);
      return;
    }
    cancel = startFilling(request.entries, root, request.method);
  }

  const handlePageHide = () => cancel();
  view.addEventListener("hashchange", handleUrl);
  view.addEventListener("pagehide", handlePageHide);
  handleUrl();

  return () => {
    cancel();
    view.removeEventListener("hashchange", handleUrl);
    view.removeEventListener("pagehide", handlePageHide);
  };
}
