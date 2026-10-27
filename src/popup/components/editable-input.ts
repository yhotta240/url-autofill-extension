import { isInputMethod } from "../../shared/input-method.ts";
import type { TargetCheckResponse } from "../../shared/target-check.ts";
import {
  isTargetTestResponse,
  TARGET_TEST_TYPE,
  type TargetTestRequest,
  type TargetTestResult,
} from "../../shared/target-test.ts";
import { type CurrentPage, getCurrentPage, normalizePageUrl } from "../current-page.ts";

let testing = false;
const refreshButtons = new Set<() => void>();

const ERRORS: Partial<Record<TargetTestResult, string>> = {
  "different-page": "現在のページとURLが異なります．",
  missing: "入力先が見つかりません．",
  ambiguous: "入力先が複数見つかりました．",
  "invalid-selector": "CSSセレクタが不正です．",
  unsupported: "この対象または入力方式は利用できません．",
  disabled: "無効な入力先には実行できません．",
  readonly: "読み取り専用の入力先には実行できません．",
  "command-failed": "編集コマンドを実行できませんでした．",
  "clipboard-unavailable": "このページではクリップボードを利用できません．",
  "clipboard-failed": "クリップボードに書き込めませんでした．",
  cancelled: "ページが変更されたため中止しました．",
};

export function createEditableInput(
  container: HTMLElement,
  target: HTMLInputElement,
  value: HTMLTextAreaElement,
  select: HTMLSelectElement,
) {
  function control<T extends Element>(selector: string): T {
    const element = container.querySelector<T>(selector);
    if (!element) throw new Error("入力方式のテンプレートが不正です．");
    return element;
  }
  const test = control<HTMLButtonElement>("[data-input-test]");
  const status = control<HTMLElement>("[data-input-test-status]");
  let page: CurrentPage | null | undefined;
  let pageUrl = "";
  let eligible = false;
  let revision = 0;
  let disposed = false;

  function invalidate(): void {
    revision += 1;
    status.textContent = "";
  }
  function render(): void {
    test.hidden = !eligible;
    test.disabled = !eligible || testing;
  }
  refreshButtons.add(render);
  select.addEventListener("change", invalidate);
  value.addEventListener("input", invalidate);
  target.addEventListener("input", invalidate);

  async function run(): Promise<void> {
    if (testing || !eligible || !page || !isInputMethod(select.value)) return;
    const snapshot = {
      tabId: page.tabId,
      pageUrl: normalizePageUrl(pageUrl),
      selector: target.value,
      value: value.value,
      method: select.value,
    };
    if (!snapshot.pageUrl) return;
    const version = ++revision;
    const current = () => !disposed && version === revision;
    testing = true;
    for (const update of refreshButtons) update();
    status.textContent = "実行中…";
    try {
      const active = await getCurrentPage();
      if (!current()) return;
      if (active?.tabId !== snapshot.tabId || active.url !== snapshot.pageUrl) {
        status.textContent = ERRORS["different-page"] ?? "";
        return;
      }
      if (snapshot.method === "clipboard-paste") {
        try {
          await navigator.clipboard.writeText(snapshot.value);
        } catch {
          if (current()) status.textContent = ERRORS["clipboard-failed"] ?? "";
          return;
        }
        if (!current()) return;
        const latest = await getCurrentPage();
        if (!current()) return;
        if (latest?.tabId !== snapshot.tabId || latest.url !== snapshot.pageUrl) {
          status.textContent = ERRORS["different-page"] ?? "";
          return;
        }
      }
      const response: unknown = await chrome.tabs.sendMessage(
        snapshot.tabId,
        {
          type: TARGET_TEST_TYPE,
          pageUrl: snapshot.pageUrl,
          selector: snapshot.selector,
          value: snapshot.value,
          method: snapshot.method,
        } satisfies TargetTestRequest,
        { frameId: 0 },
      );
      if (!current()) return;
      if (!isTargetTestResponse(response) || normalizePageUrl(response.url) !== snapshot.pageUrl) {
        status.textContent = "テスト結果を確認できませんでした．";
      } else if (["filled", "paste-dispatched", "command-dispatched"].includes(response.result)) {
        status.textContent = "実行しました．入力先を確認してください．";
      } else status.textContent = ERRORS[response.result] ?? "テストを実行できませんでした．";
    } catch {
      if (current()) status.textContent = "このページではテストを実行できませんでした．";
    } finally {
      testing = false;
      for (const update of refreshButtons) update();
    }
  }
  const clicked = () => {
    void run();
  };
  test.addEventListener("click", clicked);
  render();
  return {
    setInfo(response: TargetCheckResponse | null): void {
      const next = response?.status === "found" && response.targetInfo?.type === "contenteditable";
      if (eligible !== next) invalidate();
      eligible = next;
      render();
    },
    updatePage(url: string, next: CurrentPage | null | undefined): void {
      if (pageUrl !== url || page?.tabId !== next?.tabId || page?.url !== next?.url) {
        invalidate();
        eligible = false;
      }
      pageUrl = url;
      page = next;
      render();
    },
    dispose(): void {
      disposed = true;
      invalidate();
      refreshButtons.delete(render);
      select.removeEventListener("change", invalidate);
      value.removeEventListener("input", invalidate);
      target.removeEventListener("input", invalidate);
      test.removeEventListener("click", clicked);
    },
  };
}
