import { MAX_FIELDS } from "../../content/parser.ts";
import { generateAutofillUrl } from "../../utils/url-generator.ts";
import type { CurrentPage } from "./target-check.ts";
import { createGeneratorItem } from "./url-generator-item.ts";

export function setupUrlGenerator(root: Document = document): void {
  const form = root.querySelector<HTMLFormElement>("#url-generator");
  if (!form) return;
  const pageUrl = form.querySelector<HTMLInputElement>("#generator-page-url");
  const list = form.querySelector<HTMLElement>("#generator-items");
  const template = form.querySelector<HTMLTemplateElement>("#generator-item-template");
  const add = form.querySelector<HTMLButtonElement>("#generator-add");
  const count = form.querySelector<HTMLElement>("#generator-item-count");
  const output = form.querySelector<HTMLElement>("#generator-output");
  const result = output?.querySelector<HTMLElement>("#generator-result");
  const copy = output?.querySelector<HTMLButtonElement>("#generator-copy");
  const error = output?.querySelector<HTMLElement>("#generator-error");
  const sourceStatus = form.querySelector<HTMLElement>("#generator-source-status");
  const copyStatus = output?.querySelector<HTMLElement>("#generator-copy-status");
  if (
    !pageUrl ||
    !list ||
    !template ||
    !add ||
    !count ||
    !output ||
    !result ||
    !copy ||
    !error ||
    !sourceStatus ||
    !copyStatus
  )
    return;

  const items: ReturnType<typeof createGeneratorItem>[] = [];
  let nextId = 1;
  let urlEdited = false;
  let interacted = false;
  let revision = 0;
  let currentPage: CurrentPage | null | undefined;

  function render(showErrors = true): void {
    if (!pageUrl || !result || !copy || !error || !copyStatus) return;
    if (showErrors) interacted = true;
    revision += 1;
    result.textContent = "";
    copy.disabled = true;
    copyStatus.textContent = "";
    error.hidden = true;
    error.textContent = "";
    const errors = items.map((item, index) => {
      const message = item.validate(showErrors);
      item.checkTarget(pageUrl.value, currentPage);
      return message ? `項目${index + 1}：${message}` : "";
    });

    try {
      const firstError = errors.find(Boolean);
      if (firstError) throw new Error(firstError);
      result.textContent = generateAutofillUrl(
        pageUrl.value,
        items.map((item) => item.readEntry()),
      );
      copy.disabled = false;
    } catch (failure) {
      if (showErrors) {
        error.textContent =
          failure instanceof Error ? failure.message : "入力内容を確認してください．";
        error.hidden = false;
      }
    }
    if (showErrors && !pageUrl.validity.valid) pageUrl.setAttribute("aria-invalid", "true");
    else pageUrl.removeAttribute("aria-invalid");
  }

  function updateItems(): void {
    if (!add || !count) return;
    items.forEach((item, index) => {
      item.setNumber(index + 1);
      item.remove.disabled = items.length === 1;
    });
    add.disabled = items.length >= MAX_FIELDS;
    count.textContent = `${items.length} / ${MAX_FIELDS}項目`;
  }

  function addItem(example = false) {
    if (!template || !list || items.length >= MAX_FIELDS) return;
    const item = createGeneratorItem(
      template,
      nextId++,
      () => render(),
      () => {
        if (items.length === 1) return;
        const index = items.indexOf(item);
        items.splice(index, 1);
        item.dispose();
        item.element.remove();
        updateItems();
        render();
        items[Math.min(index, items.length - 1)].target.focus();
      },
      example,
    );
    items.push(item);
    list.append(item.element);
    updateItems();
    return item;
  }

  pageUrl.addEventListener("input", () => {
    urlEdited = true;
    sourceStatus.textContent = "";
    render();
  });
  add.addEventListener("click", () => {
    const item = addItem();
    render();
    item?.target.focus();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    render();
  });
  copy.addEventListener("click", async () => {
    if (copy.disabled || !result.textContent) return;
    const copiedRevision = revision;
    try {
      await navigator.clipboard.writeText(result.textContent);
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
      const url = new URL(tab?.url ?? "");
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported page");
      if (tab.id === undefined) {
        throw new Error("現在のタブIDを取得できません");
      }
      currentPage = { tabId: tab.id, url: url.href };
      if (!urlEdited) {
        pageUrl.value = tab.url ?? "";
        sourceStatus.textContent = "";
      }
    } catch {
      currentPage = null;
      if (!urlEdited) {
        sourceStatus.textContent =
          "現在のページURLを取得できませんでした．対象ページURLを入力してください．";
      }
    }
    render(interacted);
  }

  addItem(true);
  render(false);
  void loadCurrentUrl();
}
