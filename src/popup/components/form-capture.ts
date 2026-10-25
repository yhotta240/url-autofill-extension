import type { FillEntry } from "../../content/parser.ts";
import {
  captureError,
  FORM_CAPTURE_TYPE,
  isCaptureResponse,
  isFormsResponse,
} from "../../shared/form-capture.ts";
import { type CurrentPage, normalizePageUrl } from "../current-page.ts";

type CaptureState = {
  page: CurrentPage | null | undefined;
  url: string;
  version: number;
  selectors: string[];
  busy: boolean;
};

export function createFormCapture(
  root: Document,
  state: () => CaptureState,
  append: (entries: FillEntry[]) => void,
) {
  const scope = root.querySelector<HTMLSelectElement>("#generator-capture-scope");
  const button = root.querySelector<HTMLButtonElement>("#generator-capture");
  const status = root.querySelector<HTMLElement>("#generator-capture-status");
  if (!scope || !button || !status) throw new Error("取り込み欄が見つかりません．");
  let context = "";
  let formsVersion = 0;
  let captureVersion = 0;
  let ready = false;
  let loading = false;
  let capturing = false;
  let formsKey = "";

  function eligible(current: CaptureState): boolean {
    const url = normalizePageUrl(current.url);
    return !!url && !!current.page && normalizePageUrl(current.page.url) === url;
  }

  function sync(current = state()): void {
    if (!scope || !button) return;
    scope.disabled = !eligible(current);
    button.disabled =
      scope.disabled || scope.selectedIndex < 0 || !ready || loading || capturing || current.busy;
  }

  async function loadForms(): Promise<void> {
    if (!scope || !status) return;
    const current = state();
    if (!eligible(current) || !current.page) return;
    const version = ++formsVersion;
    loading = true;
    if (!capturing) status.textContent = "";
    sync(current);
    try {
      const response: unknown = await chrome.tabs.sendMessage(
        current.page.tabId,
        { type: FORM_CAPTURE_TYPE, action: "forms" },
        { frameId: 0 },
      );
      if (version !== formsVersion) return;
      if (
        !isFormsResponse(response) ||
        normalizePageUrl(response.url) !== normalizePageUrl(current.url)
      ) {
        throw new Error("このページではフォームを取得できません．");
      }
      const key = JSON.stringify(response.forms);
      if (key !== formsKey) {
        formsKey = key;
        const selected = scope.selectedIndex < 0 ? null : scope.value;
        scope.replaceChildren(
          new Option("ページ全体", ""),
          ...response.forms.map((form) => new Option(form.label, form.selector)),
        );
        const found =
          selected !== null &&
          (!selected || response.forms.some((form) => form.selector === selected));
        if (found) scope.value = selected;
        else scope.selectedIndex = -1;
      }
      if (scope.selectedIndex < 0)
        status.textContent = "選択したフォームが見つかりません．範囲を選び直してください．";
      ready = true;
    } catch {
      if (version !== formsVersion) return;
      ready = false;
      status.textContent = "このページではフォームを取得できません．";
    } finally {
      if (version === formsVersion) {
        loading = false;
        sync();
      }
    }
  }

  scope.addEventListener("focus", () => {
    void loadForms();
  });
  scope.addEventListener("change", () => {
    captureVersion += 1;
    capturing = false;
    status.textContent = "";
    sync();
  });
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    const current = state();
    if (!current.page || !eligible(current)) return;
    const selected = scope.value;
    const version = ++captureVersion;
    capturing = true;
    status.textContent = "入力内容を取得しています…";
    sync(current);
    try {
      const response: unknown = await chrome.tabs.sendMessage(
        current.page.tabId,
        {
          type: FORM_CAPTURE_TYPE,
          action: "capture",
          scope: selected || null,
          existing: current.selectors,
        },
        { frameId: 0 },
      );
      if (version !== captureVersion) return;
      const latest = state();
      if (latest.version !== current.version || scope.value !== selected || latest.busy) {
        status.textContent = "入力内容が変更されました．もう一度追加してください．";
        return;
      }
      const error = captureError(response);
      if (error) throw new Error(error);
      if (
        !isCaptureResponse(response) ||
        normalizePageUrl(response.url) !== normalizePageUrl(current.url)
      ) {
        throw new Error("入力内容を取得できませんでした．");
      }
      append(response.entries);
      status.textContent = `${response.entries.length}件追加しました（重複${response.duplicates}件・対象外${response.skipped}件）．`;
    } catch (error) {
      if (version === captureVersion)
        status.textContent =
          error instanceof Error ? error.message : "入力内容を取得できませんでした．";
    } finally {
      if (version === captureVersion) {
        capturing = false;
        sync();
      }
    }
  });

  return {
    update(): void {
      const current = state();
      const key = JSON.stringify([current.page ?? null, normalizePageUrl(current.url)]);
      if (key !== context) {
        context = key;
        formsVersion += 1;
        captureVersion += 1;
        capturing = false;
        loading = false;
        ready = false;
        formsKey = "";
        scope.value = "";
        scope.replaceChildren(new Option("ページ全体", ""));
        status.textContent =
          !current.page || !eligible(current)
            ? "現在のページと対象ページURLが一致するときに取り込めます．"
            : "";
        void loadForms();
      }
      sync(current);
    },
  };
}
