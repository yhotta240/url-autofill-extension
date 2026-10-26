/** inputなどの値を持つコントロールと，編集可能なHTML要素を区別する． */
export function isEditableElement(
  element: Element,
): element is HTMLElement & { readonly isContentEditable: true } {
  const view = element.ownerDocument.defaultView;
  return (
    !!view &&
    element instanceof view.HTMLElement &&
    !element.matches("input, textarea, select") &&
    element.isContentEditable === true
  );
}

export function getEditingHost(element: HTMLElement): HTMLElement {
  let host = element;
  while (host.parentElement && isEditableElement(host.parentElement)) host = host.parentElement;
  return host;
}

/** 編集領域は親のホストだけを列挙し，通常の入力欄と同じDOM順に返す． */
export function getInputElements(root: Document): HTMLElement[] {
  const view = root.defaultView;
  if (!view) return [];
  return Array.from(root.querySelectorAll("input, textarea, select, [contenteditable]")).filter(
    (element): element is HTMLElement =>
      element instanceof view.HTMLElement &&
      (element.matches("input, textarea, select") ||
        (isEditableElement(element) && getEditingHost(element) === element)),
  );
}

/** 対象の内容を選択し，テキストの貼り付け処理をサイトへ委ねる． */
function selectEditableContents(element: HTMLElement): boolean {
  const root = element.ownerDocument;
  const view = root.defaultView;
  const selection = root.getSelection();
  if (!view || !selection) return false;
  const initialUrl = view.location.href;
  getEditingHost(element).focus();
  const range = root.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  // pasteの前に，サイト側のエディタへ変更した選択範囲を通知する．
  root.dispatchEvent(new view.Event("selectionchange"));
  return element.isConnected && isEditableElement(element) && view.location.href === initialUrl;
}

export function pasteEditableText(
  element: HTMLElement,
  value: string,
): "paste-dispatched" | "unsupported" {
  const view = element.ownerDocument.defaultView;
  if (!view || !selectEditableContents(element)) return "unsupported";
  const clipboardData = new view.DataTransfer();
  clipboardData.setData("text/plain", value);
  element.dispatchEvent(
    new view.ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData,
    }),
  );
  // dispatchEventの戻り値は挿入成功を表さない．送信済みとして扱い，再試行しない．
  return "paste-dispatched";
}

/** 選択した範囲へ一つの編集コマンドだけを実行する． */
export function commandEditableText(
  element: HTMLElement,
  value: string,
  command: "insert-text" | "clipboard-paste",
): "command-dispatched" | "command-failed" | "unsupported" {
  const root = element.ownerDocument;
  if (typeof root.execCommand !== "function" || !selectEditableContents(element))
    return "unsupported";
  let action = "paste";
  if (command === "insert-text") action = "insertText";
  if (value === "") {
    // 空の子要素でBackspace相当の処理をすると，直前の兄弟まで削除してしまう．
    if (root.getSelection()?.isCollapsed) return "command-dispatched";
    action = "delete";
  }
  if (!root.execCommand(action, false, value)) return "command-failed";
  return "command-dispatched";
}
