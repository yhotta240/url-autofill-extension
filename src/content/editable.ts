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

/** 改行をbr要素で表現し，URLの値をHTMLとして解析しない． */
export function setEditableText(element: HTMLElement, value: string): void {
  const root = element.ownerDocument;
  const fragment = root.createDocumentFragment();
  value.split(/\r\n?|\n/).forEach((line, index) => {
    if (index > 0) fragment.append(root.createElement("br"));
    fragment.append(root.createTextNode(line));
  });
  root.defaultView?.Element.prototype.replaceChildren.call(element, fragment);
}
