import {
  isTargetCheckResponse,
  TARGET_CHECK_TYPE,
  type TargetCheckRequest,
  type TargetCheckResponse,
} from "../../shared/target-check.ts";
import { type CurrentPage, normalizePageUrl } from "../current-page.ts";

const MESSAGES = {
  checking: "確認中…",
  found: "見つかりました",
  missing: "現在のページでは見つかりません",
  ambiguous: "複数見つかりました。CSSセレクタで絞ってください",
  "invalid-selector": "CSSセレクタの構文を確認してください",
  "invalid-radio-group": "同じグループのラジオだけを指定し，valueの重複を避けてください",
  unavailable: "このページでは確認できません",
  "different-page": "現在のページとURLが異なるため確認できません",
};

/** 項目ごとに入力待ちと応答の世代を管理し，古い結果の表示を防ぐ． */
export function createTargetCheck(
  element: HTMLElement,
  onResult: (response: TargetCheckResponse | null) => void = () => {},
  shouldReadValue: () => boolean = () => false,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  let lastKey = "";
  let current:
    | { selector: string | null; pageUrl: string; page: CurrentPage | null | undefined }
    | undefined;

  function show(status: keyof typeof MESSAGES | null): void {
    element.textContent = status === null ? "" : MESSAGES[status];
    element.hidden = status === null;
  }

  function cancel(): void {
    revision += 1;
    clearTimeout(timer);
    timer = undefined;
  }

  async function check(selector: string, page: CurrentPage, url: string, version: number) {
    let status: keyof typeof MESSAGES;
    let result: TargetCheckResponse | null = null;
    try {
      const response: unknown = await chrome.tabs.sendMessage(
        page.tabId,
        {
          type: TARGET_CHECK_TYPE,
          selector,
          ...(shouldReadValue() ? { includeCurrentValue: true } : {}),
        } satisfies TargetCheckRequest,
        { frameId: 0 },
      );
      if (!isTargetCheckResponse(response)) throw new Error("invalid response");
      status = normalizePageUrl(response.url) === url ? response.status : "different-page";
      if (status !== "different-page") result = response;
    } catch {
      status = "unavailable";
    }
    if (version !== revision) return;
    show(status);
    if (result?.targetInfo) {
      element.textContent += `（ラベル：${result.targetInfo.label || "なし"}／タイプ：${result.targetInfo.type}）`;
    }
    onResult(result);
  }

  function update(
    selector: string | null,
    pageUrl: string,
    page: CurrentPage | null | undefined,
    refresh = false,
  ): void {
    current = { selector, pageUrl, page };
    const key = JSON.stringify([selector, pageUrl, page === undefined ? "loading" : page]);
    if (!refresh && key === lastKey) return;
    lastKey = key;
    cancel();
    // フォーカス時の再取得では既存のコントロールを維持する．
    if (!refresh) onResult(null);

    const url = normalizePageUrl(pageUrl);
    if (!selector?.trim() || !url || page === undefined) {
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
        void check(selector, page, url, version);
      }, 300);
    }
  }

  return {
    update,
    refresh(): void {
      if (current) update(current.selector, current.pageUrl, current.page, true);
    },
    dispose(): void {
      cancel();
    },
  };
}
