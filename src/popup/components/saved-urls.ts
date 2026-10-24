import {
  deleteSavedUrl,
  getSavedUrls,
  SAVED_URL_PREFIX,
  type SavedUrl,
} from "../../utils/saved-urls.ts";
import type { CurrentPage } from "../current-page.ts";

export function setupSavedUrlList(
  root: Document,
  options: { currentPage: Promise<CurrentPage | null>; onEdit: (item: SavedUrl) => void },
) {
  const list = root.querySelector<HTMLElement>("#saved-items");
  const template = root.querySelector<HTMLTemplateElement>("#saved-item-template");
  const search = root.querySelector<HTMLInputElement>("#saved-search");
  const hostScope = root.querySelector<HTMLInputElement>("#saved-scope-host");
  const allScope = root.querySelector<HTMLInputElement>("#saved-scope-all");
  const empty = root.querySelector<HTMLElement>("#saved-empty");
  const status = root.querySelector<HTMLElement>("#saved-action-status");
  const sourceStatus = root.querySelector<HTMLElement>("#saved-source-status");
  if (
    !list ||
    !template ||
    !search ||
    !hostScope ||
    !allScope ||
    !empty ||
    !status ||
    !sourceStatus
  ) {
    return;
  }

  let items: SavedUrl[] = [];
  let currentHost: string | null = null;
  let loading = true;
  let loadFailed = false;
  let loadRevision = 0;
  let actionRevision = 0;

  const createRow = (item: SavedUrl): DocumentFragment => {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const name = fragment.querySelector<HTMLElement>("[data-name]");
    const url = fragment.querySelector<HTMLElement>("[data-url]");
    const favicon = fragment.querySelector<HTMLImageElement>("[data-favicon]");
    const fallback = fragment.querySelector("[data-fallback]");
    const edit = fragment.querySelector<HTMLButtonElement>("[data-edit]");
    const remove = fragment.querySelector<HTMLButtonElement>("[data-delete]");
    const copy = fragment.querySelector<HTMLButtonElement>("[data-copy]");
    const open = fragment.querySelector<HTMLButtonElement>("[data-open]");
    if (!name || !url || !favicon || !fallback || !edit || !remove || !copy || !open) {
      throw new Error("保存URLのテンプレートが不正です．");
    }
    const page = new URL(item.url);
    name.textContent = item.name || "名称未設定";
    name.title = name.textContent;
    url.textContent = item.url;
    url.title = item.url;
    const iconUrl = new URL("https://www.google.com/s2/favicons");
    iconUrl.searchParams.set("domain", page.hostname);
    iconUrl.searchParams.set("sz", "32");
    favicon.referrerPolicy = "no-referrer";
    favicon.src = iconUrl.href;
    favicon.addEventListener(
      "error",
      () => {
        favicon.hidden = true;
        fallback.removeAttribute("hidden");
      },
      { once: true },
    );

    edit.addEventListener("click", () => options.onEdit(item));
    remove.addEventListener("click", async () => {
      if (!root.defaultView?.confirm(`「${name.textContent}」を削除しますか？`)) return;
      const version = ++actionRevision;
      remove.disabled = true;
      try {
        await deleteSavedUrl(item.id);
        if (version === actionRevision) status.textContent = "削除しました．";
        search.focus();
      } catch {
        if (version === actionRevision) status.textContent = "削除できませんでした．";
      } finally {
        remove.disabled = false;
      }
    });
    copy.addEventListener("click", async () => {
      const version = ++actionRevision;
      try {
        await navigator.clipboard.writeText(item.url);
        if (version === actionRevision) status.textContent = "コピーしました．";
      } catch {
        if (version === actionRevision) status.textContent = "コピーできませんでした．";
      }
    });
    open.addEventListener("click", async () => {
      const version = ++actionRevision;
      try {
        await chrome.tabs.create({ url: item.url });
      } catch {
        if (version === actionRevision) status.textContent = "ページを開けませんでした．";
      }
    });
    return fragment;
  };

  const render = (): void => {
    const query = search.value.trim().toLowerCase();
    const matches = items.filter((item) => {
      const page = new URL(item.url);
      return (
        (!hostScope.checked || page.host === currentHost) &&
        `${item.name} ${item.url}`.toLowerCase().includes(query)
      );
    });
    list.replaceChildren(...matches.map(createRow));
    empty.hidden = !loading && !loadFailed && matches.length > 0;
    if (loading) empty.textContent = "読み込んでいます…";
    else if (loadFailed) empty.textContent = "保存URLを読み込めませんでした．";
    else if (items.length === 0) empty.textContent = "保存したURLはありません．";
    else empty.textContent = "一致するURLはありません．";
  };

  async function load(): Promise<void> {
    const version = ++loadRevision;
    try {
      const saved = await getSavedUrls();
      if (version !== loadRevision) return;
      items = saved;
      loadFailed = false;
    } catch {
      if (version !== loadRevision) return;
      items = [];
      loadFailed = true;
    }
    loading = false;
    render();
  }

  const filter = (): void => {
    actionRevision += 1;
    status.textContent = "";
    render();
  };
  search.addEventListener("input", filter);
  hostScope.addEventListener("change", filter);
  allScope.addEventListener("change", filter);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Object.keys(changes).some((key) => key.startsWith(SAVED_URL_PREFIX))) {
      void load();
    }
  });

  const updateCurrentPage = (page: CurrentPage | null): void => {
    currentHost = null;
    hostScope.disabled = true;
    hostScope.title = "";
    sourceStatus.textContent = "";
    if (page) {
      currentHost = new URL(page.url).host;
      hostScope.disabled = false;
      hostScope.title = currentHost;
    } else {
      allScope.checked = true;
      sourceStatus.textContent = "現在のホストを取得できないため，すべて表示しています．";
    }
    render();
  };
  const loadHost = async (): Promise<void> => {
    updateCurrentPage(await options.currentPage);
  };
  void loadHost();
  void load();
  return { updateCurrentPage };
}
