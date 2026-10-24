import type { FillTarget } from "../../content/parser.ts";
import {
  isTargetCheckResponse,
  TARGET_CHECK_TYPE,
  type TargetCheckRequest,
} from "../../shared/target-check.ts";

export type CurrentPage = { tabId: number; url: string };

const MESSAGES = {
  checking: "確認中…",
  found: "見つかりました",
  missing: "現在のページでは見つかりません",
  ambiguous: "複数見つかりました。CSSセレクタで絞ってください",
  "invalid-selector": "CSSセレクタの構文を確認してください",
  unavailable: "このページでは確認できません",
  "different-page": "現在のページとURLが異なるため確認できません",
};

function normalizePageUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** 項目ごとに入力待ちと応答の世代を管理し，古い結果の表示を防ぐ． */
export function createTargetCheck(element: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  let lastKey = "";

  function show(status: keyof typeof MESSAGES | null): void {
    element.textContent = status === null ? "" : MESSAGES[status];
    element.hidden = status === null;
  }

  function cancel(): void {
    revision += 1;
    clearTimeout(timer);
    timer = undefined;
  }

  async function check(target: FillTarget, page: CurrentPage, url: string, version: number) {
    let status: keyof typeof MESSAGES;
    try {
      const response: unknown = await chrome.tabs.sendMessage(
        page.tabId,
        { type: TARGET_CHECK_TYPE, target } satisfies TargetCheckRequest,
        { frameId: 0 },
      );
      if (!isTargetCheckResponse(response)) throw new Error("invalid response");
      status = normalizePageUrl(response.url) === url ? response.status : "different-page";
    } catch {
      status = "unavailable";
    }
    if (version === revision) show(status);
  }

  return {
    update(target: FillTarget | null, pageUrl: string, page: CurrentPage | null | undefined): void {
      const key = JSON.stringify([target, pageUrl, page === undefined ? "loading" : page]);
      if (key === lastKey) return;
      lastKey = key;
      cancel();

      const url = normalizePageUrl(pageUrl);
      if (!target?.value.trim() || !url || page === undefined) {
        show(null);
      } else if (page === null) {
        show("unavailable");
      } else if (normalizePageUrl(page.url) !== url) {
        show("different-page");
      } else {
        show("checking");
        const version = revision;
        timer = setTimeout(() => {
          timer = undefined;
          void check(target, page, url, version);
        }, 300);
      }
    },
    dispose(): void {
      cancel();
    },
  };
}
