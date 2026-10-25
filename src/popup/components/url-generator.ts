import { type FillEntry, MAX_FIELDS } from "../../content/parser.ts";
import { readSavedUrl, type SavedUrl, saveUrl } from "../../utils/saved-urls.ts";
import { generateAutofillUrl } from "../../utils/url-generator.ts";
import { type CurrentPage, getCurrentPage } from "../current-page.ts";
import { createFormCapture } from "./form-capture.ts";
import { createGeneratorItem } from "./url-generator-item.ts";

export function setupUrlGenerator(
  root: Document = document,
  options: { currentPage?: Promise<CurrentPage | null>; onUpdated?: () => void } = {},
) {
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
  const save = output?.querySelector<HTMLButtonElement>("#generator-save");
  const cancel = output?.querySelector<HTMLButtonElement>("#generator-cancel");
  const saveStatus = output?.querySelector<HTMLElement>("#generator-save-status");
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
    !copyStatus ||
    !save ||
    !cancel ||
    !saveStatus
  )
    return;

  const items: ReturnType<typeof createGeneratorItem>[] = [];
  let nextId = 1;
  let urlEdited = false;
  let interacted = false;
  let revision = 0;
  let currentPage: CurrentPage | null | undefined;
  let editingId: string | undefined;
  let saving = false;
  let savedName = "";
  let baseline = "";
  let rendering = false;
  let sampleUntouched = true;

  function snapshot(): string {
    return JSON.stringify([savedName, pageUrl?.value, items.map((item) => item.readEntry())]);
  }

  function render(showErrors = true): void {
    if (rendering || !pageUrl || !result || !copy || !error || !copyStatus || !save || !saveStatus)
      return;
    rendering = true;
    if (showErrors) interacted = true;
    revision += 1;
    result.textContent = "";
    copy.disabled = true;
    save.disabled = true;
    copyStatus.textContent = "";
    saveStatus.textContent = "";
    error.hidden = true;
    error.textContent = "";
    const errors = items.map((item, index) => {
      item.checkTarget(pageUrl.value, currentPage);
      const message = item.validate(showErrors);
      return message ? `項目${index + 1}：${message}` : "";
    });

    try {
      const firstError = errors.find(Boolean);
      if (firstError) throw new Error(firstError);
      const groups = items
        .map((item) => item.selectedRadioGroup())
        .filter((group) => group !== undefined);
      if (new Set(groups).size !== groups.length) {
        throw new Error("同じラジオグループを複数の項目で選択できません．");
      }
      result.textContent = generateAutofillUrl(
        pageUrl.value,
        items.map((item) => item.readEntry()),
      );
      copy.disabled = false;
      save.disabled = saving;
    } catch (failure) {
      if (showErrors) {
        error.textContent =
          failure instanceof Error ? failure.message : "入力内容を確認してください．";
        error.hidden = false;
      }
    }
    if (showErrors && !pageUrl.validity.valid) pageUrl.setAttribute("aria-invalid", "true");
    else pageUrl.removeAttribute("aria-invalid");
    rendering = false;
    capture.update();
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

  function addItem(initial?: FillEntry) {
    if (!template || !list || items.length >= MAX_FIELDS) return;
    const item = createGeneratorItem(
      template,
      nextId++,
      () => {
        sampleUntouched = false;
        render();
      },
      () => {
        if (items.length === 1) return;
        sampleUntouched = false;
        const index = items.indexOf(item);
        items.splice(index, 1);
        item.dispose();
        item.element.remove();
        updateItems();
        render();
        items[Math.min(index, items.length - 1)].target.focus();
      },
      initial,
      () => render(interacted),
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
    sampleUntouched = false;
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

  save.addEventListener("click", async () => {
    if (save.disabled || !result.textContent) return;
    const enteredName = root.defaultView?.prompt("保存名を入力してください．", savedName);
    if (enteredName == null) return;
    const name = enteredName.trim();
    if (!name) {
      saveStatus.textContent = "保存名を入力してください．";
      return;
    }
    savedName = name;
    saveStatus.textContent = "";
    saving = true;
    capture.update();
    save.disabled = true;
    cancel.disabled = true;
    const savedRevision = revision;
    const savedSnapshot = snapshot();
    try {
      const saved = await saveUrl(result.textContent, name, editingId);
      baseline = savedSnapshot;
      if (savedRevision === revision) {
        saveStatus.textContent = saved.duplicate
          ? "同じURLがすでに保存されています．"
          : "保存しました．";
        if (editingId !== undefined) {
          editingId = undefined;
          save.textContent = "保存";
          cancel.hidden = true;
          options.onUpdated?.();
        }
      }
    } catch (failure) {
      if (savedRevision === revision) {
        saveStatus.textContent =
          failure instanceof Error ? failure.message : "保存できませんでした．";
      }
    } finally {
      saving = false;
      capture.update();
      save.disabled = !result.textContent;
      cancel.disabled = false;
    }
  });

  function replaceItems(entries: readonly FillEntry[]): void {
    for (const item of items) item.dispose();
    items.length = 0;
    list?.replaceChildren();
    for (const entry of entries) addItem(entry);
  }

  const sample: FillEntry = {
    selector: "#email",
    value: "test@example.com",
  };
  const capture = createFormCapture(
    root,
    () => ({
      page: currentPage,
      url: pageUrl.value,
      version: revision,
      selectors:
        sampleUntouched && !editingId ? [] : items.map((item) => item.readEntry().selector),
      busy: saving,
    }),
    (entries) => {
      if (saving) throw new Error("保存が完了してから追加してください．");
      if (entries.length === 0) return;
      const replace = sampleUntouched && !editingId;
      if ((replace ? 0 : items.length) + entries.length > MAX_FIELDS) {
        throw new Error(`入力項目は${MAX_FIELDS}件までです．項目を減らしてから追加してください．`);
      }
      if (replace) replaceItems(entries);
      else for (const entry of entries) addItem(entry);
      sampleUntouched = false;
      render();
    },
  );
  cancel.addEventListener("click", () => {
    editingId = undefined;
    save.textContent = "保存";
    cancel.hidden = true;
    savedName = "";
    urlEdited = false;
    interacted = false;
    sampleUntouched = true;
    pageUrl.value = currentPage?.url ?? "";
    sourceStatus.textContent =
      currentPage === null
        ? "現在のページURLを取得できませんでした．対象ページURLを入力してください．"
        : "";
    replaceItems([sample]);
    render(false);
    baseline = snapshot();
  });

  const updateCurrentPage = (page: CurrentPage | null): void => {
    currentPage = page;
    if (!urlEdited) {
      sourceStatus.textContent = page
        ? ""
        : "現在のページURLを取得できませんでした．対象ページURLを入力してください．";
      const nextUrl = page?.url ?? "";
      if (pageUrl.value !== nextUrl) {
        const wasClean = snapshot() === baseline;
        pageUrl.value = nextUrl;
        render(interacted);
        if (wasClean) baseline = snapshot();
        return;
      }
    }
    for (const item of items) item.checkTarget(pageUrl.value, page);
    capture.update();
  };

  async function loadCurrentUrl(): Promise<void> {
    updateCurrentPage(await (options.currentPage ?? getCurrentPage()));
  }

  addItem(sample);
  render(false);
  baseline = snapshot();
  void loadCurrentUrl();

  return {
    updateCurrentPage,
    edit(item: SavedUrl): boolean {
      if (saving) return false;
      if (
        snapshot() !== baseline &&
        !root.defaultView?.confirm("未保存の変更を破棄して編集しますか？")
      ) {
        return false;
      }
      try {
        const request = readSavedUrl(item.url);
        sampleUntouched = false;
        urlEdited = true;
        pageUrl.value = request.cleanUrl;
        sourceStatus.textContent = "";
        replaceItems(request.entries);
        editingId = item.id;
        savedName = item.name;
        save.textContent = "更新";
        cancel.hidden = false;
        render();
        baseline = snapshot();
        return true;
      } catch {
        saveStatus.textContent = "保存URLを読み込めませんでした．";
        return false;
      }
    },
  };
}
