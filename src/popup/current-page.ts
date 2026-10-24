export type CurrentPage = { tabId: number; url: string };

export async function getCurrentPage(windowId?: number): Promise<CurrentPage | null> {
  try {
    const query: chrome.tabs.QueryInfo = { active: true };
    if (windowId === undefined) query.currentWindow = true;
    else query.windowId = windowId;
    const [tab] = await chrome.tabs.query(query);
    const url = new URL(tab?.url ?? "");
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (tab.id === undefined) return null;
    return { tabId: tab.id, url: url.href };
  } catch {
    return null;
  }
}

/** 初回取得とタブ変更時の取得を同じ世代で管理する． */
export function watchCurrentPage(windowId: number, onChange: (page: CurrentPage | null) => void) {
  let version = 0;
  let lastKey: string | undefined;
  let resolveInitial: ((page: CurrentPage | null) => void) | undefined;
  const initial = new Promise<CurrentPage | null>((resolve) => {
    resolveInitial = resolve;
  });
  const refresh = async (): Promise<void> => {
    const request = ++version;
    const page = await getCurrentPage(windowId);
    if (request !== version) return;
    const key = JSON.stringify(page);
    if (key === lastKey) return;
    lastKey = key;
    if (resolveInitial) {
      resolveInitial(page);
      resolveInitial = undefined;
    } else onChange(page);
  };
  const activated: Parameters<typeof chrome.tabs.onActivated.addListener>[0] = (info) => {
    if (info.windowId === windowId) void refresh();
  };
  const updated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (
    _tabId,
    change,
    tab,
  ) => {
    if (
      tab.windowId === windowId &&
      tab.active &&
      (change.url !== undefined || change.status === "complete")
    ) {
      void refresh();
    }
  };
  chrome.tabs.onActivated.addListener(activated);
  chrome.tabs.onUpdated.addListener(updated);
  void refresh();
  return {
    initial,
    dispose(): void {
      version += 1;
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
      resolveInitial?.(null);
      resolveInitial = undefined;
    },
  };
}
