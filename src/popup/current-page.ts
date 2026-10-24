export type CurrentPage = { tabId: number; url: string };

export async function getCurrentPage(): Promise<CurrentPage | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? "");
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (tab.id === undefined) return null;
    return { tabId: tab.id, url: url.href };
  } catch {
    return null;
  }
}
