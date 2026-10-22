import type { FillTarget } from "../../content/parser.ts";
import { generateAutofillUrl } from "../../utils/url-generator.ts";

export function setupUrlGenerator(root: Document = document): void {
  const form = root.querySelector<HTMLFormElement>("#url-generator");
  if (!form) return;
  const pageUrl = form.querySelector<HTMLInputElement>("#generator-page-url");
  const method = form.querySelector<HTMLSelectElement>("#generator-method");
  const target = form.querySelector<HTMLInputElement>("#generator-target");
  const targetLabel = form.querySelector<HTMLLabelElement>("#generator-target-label");
  const value = form.querySelector<HTMLTextAreaElement>("#generator-value");
  const result = form.querySelector<HTMLTextAreaElement>("#generator-result");
  const copy = form.querySelector<HTMLButtonElement>("#generator-copy");
  const error = form.querySelector<HTMLElement>("#generator-error");
  const sourceStatus = form.querySelector<HTMLElement>("#generator-source-status");
  const copyStatus = form.querySelector<HTMLElement>("#generator-copy-status");
  if (
    !pageUrl ||
    !method ||
    !target ||
    !targetLabel ||
    !value ||
    !result ||
    !copy ||
    !error ||
    !sourceStatus ||
    !copyStatus
  )
    return;

  let mode: FillTarget["kind"] = "field";
  const targets = { field: "email", selector: "#email" };
  let urlEdited = false;
  let interacted = false;
  let revision = 0;

  function render(showErrors = true): void {
    if (!pageUrl || !target || !value || !result || !copy || !error || !copyStatus) return;
    if (showErrors) interacted = true;
    revision += 1;
    result.value = "";
    copy.disabled = true;
    copyStatus.textContent = "";
    error.hidden = true;
    error.textContent = "";
    target.setCustomValidity("");

    try {
      if (mode === "selector" && target.value.trim()) {
        try {
          root.createDocumentFragment().querySelector(target.value);
        } catch {
          target.setCustomValidity("CSSセレクタの構文を確認してください．");
          throw new Error(target.validationMessage);
        }
      }
      result.value = generateAutofillUrl(pageUrl.value, {
        target: { kind: mode, value: target.value },
        value: value.value,
      });
      copy.disabled = false;
    } catch (failure) {
      if (showErrors) {
        error.textContent =
          failure instanceof Error ? failure.message : "入力内容を確認してください．";
        error.hidden = false;
      }
    }
    for (const control of [pageUrl, target]) {
      if (showErrors && !control.validity.valid) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    }
  }

  pageUrl.addEventListener("input", () => {
    urlEdited = true;
    sourceStatus.textContent = "";
    render();
  });
  target.addEventListener("input", () => {
    targets[mode] = target.value;
    render();
  });
  value.addEventListener("input", () => render());
  method.addEventListener("change", () => {
    mode = method.value === "selector" ? "selector" : "field";
    target.value = targets[mode];
    targetLabel.textContent = mode === "selector" ? "CSSセレクタ（必須）" : "フィールド名（必須）";
    target.placeholder = mode === "selector" ? "#email" : "email";
    render();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    render();
  });
  copy.addEventListener("click", async () => {
    if (copy.disabled || !result.value) return;
    const copiedRevision = revision;
    try {
      await navigator.clipboard.writeText(result.value);
      if (copiedRevision === revision) copyStatus.textContent = "コピーしました．";
    } catch {
      if (copiedRevision === revision) {
        copyStatus.textContent = "コピーできませんでした．生成URLを選択してコピーしてください．";
      }
    }
  });

  async function loadCurrentUrl(): Promise<void> {
    if (!pageUrl || !sourceStatus) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (urlEdited) return;
      const url = new URL(tab?.url ?? "");
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported page");
      pageUrl.value = tab.url ?? "";
      sourceStatus.textContent = "";
      render(interacted);
    } catch {
      if (urlEdited) return;
      sourceStatus.textContent =
        "現在のページURLを取得できませんでした．対象ページURLを入力してください．";
      render(interacted);
    }
  }

  render(false);
  void loadCurrentUrl();
}
