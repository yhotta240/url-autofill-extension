// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fillElement, getFillBlockReason } from "../src/content/autofill.ts";
import { getEditingHost, getInputElements } from "../src/content/editable.ts";
import { captureForm } from "../src/content/form-capture.ts";
import { parseAutofillUrl } from "../src/content/parser.ts";
import { readTargetValue } from "../src/content/read-target-value.ts";
import { resolveTarget } from "../src/content/resolver.ts";
import { getTargetCandidates } from "../src/content/target-candidates.ts";
import { listenForTargetChecks } from "../src/content/target-check.ts";
import { getTargetInfo } from "../src/content/target-info.ts";
import { TARGET_CANDIDATES_TYPE } from "../src/shared/target-candidates.ts";
import { TARGET_CHECK_TYPE } from "../src/shared/target-check.ts";
import { generateAutofillUrl } from "../src/utils/url-generator.ts";

const nativeEditable = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "isContentEditable");

beforeEach(() => {
  // jsdom未実装の編集可否だけを補完する．改行の描画・取得は実Chromeでも検証する．
  if (!nativeEditable)
    Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
      configurable: true,
      get() {
        for (let element: Element | null = this; element; element = element.parentElement) {
          const mode = element.getAttribute("contenteditable")?.toLowerCase();
          if (mode === "false") return false;
          if (mode === "" || mode === "true" || mode === "plaintext-only") return true;
        }
        return false;
      },
    });
  vi.stubGlobal("CSS", {
    escape: (value: string) =>
      value.replace(/[^a-zA-Z_-]/gu, (char) => `\\${char.codePointAt(0)?.toString(16)} `),
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  if (!nativeEditable) Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
});

function editor(id = "editor"): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function renderedText(element: HTMLElement, text: string): void {
  Object.defineProperty(element, "innerText", { configurable: true, get: () => text });
}

test.each([
  "",
  "true",
  "TRUE",
  "plaintext-only",
])("編集欄%sに改行とHTML文字列をテキストとして入力する", (mode) => {
  document.body.innerHTML = `<div id="editor" contenteditable="${mode}" aria-label="本文"><b>元の内容</b></div>`;
  const element = editor();
  const events: Event[] = [];
  element.addEventListener("input", (event) => events.push(event));
  element.addEventListener("change", (event) => events.push(event));
  const value = '<img src=x onerror="alert(1)">\n2行目';
  expect(resolveTarget("#editor", document)).toMatchObject({
    status: "found",
    kind: "element",
    element,
  });
  expect(getTargetCandidates(document)).toEqual(["#editor"]);
  expect(getTargetInfo(resolveTarget("#editor", document))).toEqual({
    label: "本文",
    type: "contenteditable",
  });
  expect(fillElement(element, value)).toBe("filled");
  expect(element.querySelector("img")).toBeNull();
  expect(element.querySelector("b")).toBeNull();
  expect(element.querySelectorAll("br")).toHaveLength(1);
  expect([...element.childNodes].map((node) => node.nodeName)).toEqual(["#text", "BR", "#text"]);
  expect(events.map((event) => event.type)).toEqual(["input", "change"]);
  expect(events[0]).toBeInstanceOf(InputEvent);
  expect((events[0] as InputEvent).inputType).toBe("insertText");
  expect((events[0] as InputEvent).data).toBe(value);
  expect(events[0].bubbles && events[0].composed).toBe(true);
  expect(fillElement(element, "")).toBe("filled");
  expect(element.innerHTML).toBe("");
});

test.each([
  ['contenteditable="false"', "unsupported"],
  ['contenteditable="invalid"', "unsupported"],
  ['contenteditable="true" aria-readonly="true"', "readonly"],
  ['contenteditable="true" aria-disabled="true"', "disabled"],
  ['contenteditable="true" inert', "disabled"],
  ['contenteditable="true" autocomplete="one-time-code"', "unsupported"],
])("編集不可・対象外の編集欄を変更せず，現在値も読まない: %s", (attributes, reason) => {
  document.body.innerHTML = `<div id="editor" ${attributes}>保持</div>`;
  const element = editor();
  Object.defineProperty(element, "innerText", {
    get() {
      throw new Error("対象外は読まない");
    },
  });
  expect(getFillBlockReason(element)).toBe(reason);
  expect(fillElement(element, "変更")).toBe(reason);
  expect(element.textContent).toBe("保持");
  expect(getTargetCandidates(document)).toEqual([]);
  expect(readTargetValue({ status: "found", kind: "element", element })).toBeUndefined();
});

test("機密指定の子を含む親編集欄を読み書き・候補・取り込みから除外する", () => {
  document.body.innerHTML =
    '<div id="editor" contenteditable>本文<span autocomplete="one-time-code">123456</span></div>';
  const element = editor();
  const before = element.innerHTML;
  const read = vi.fn(() => "本文123456");
  Object.defineProperty(element, "innerText", { get: read });
  expect(readTargetValue(resolveTarget("#editor", document))).toBeUndefined();
  expect(fillElement(element, "変更")).toBe("unsupported");
  expect(getTargetCandidates(document)).toEqual([]);
  expect(captureForm(document, null, []).entries).toEqual([]);
  expect(read).not.toHaveBeenCalled();
  expect(element.innerHTML).toBe(before);
});

test.each([
  ['<span contenteditable="false">固定</span>', "readonly"],
  ['<span contenteditable="FALSE">固定</span>', "readonly"],
  ['<span aria-readonly="true">固定</span>', "readonly"],
  ['<span aria-readonly="TRUE">固定</span>', "readonly"],
  ['<span aria-disabled="true">固定</span>', "disabled"],
  ["<span inert>固定</span>", "disabled"],
  ['<span autocomplete="section-check CC-NUMBER">秘密</span>', "unsupported"],
  ['<input type="password" value="secret">', "unsupported"],
  ['<input readonly value="固定">', "readonly"],
  ["<select disabled><option>固定</option></select>", "disabled"],
])("保護された子を含む親を拒否し，子のDOMと入力値を保持する: %s", (child, reason) => {
  document.body.innerHTML = `<div id="editor" contenteditable>本文<div>${child}</div></div>`;
  const element = editor();
  const protectedNode = element.firstElementChild;
  const before = element.innerHTML;
  const read = vi.fn(() => "本文と保護された内容");
  const changed = vi.fn();
  Object.defineProperty(element, "innerText", { get: read });
  element.addEventListener("input", changed);
  element.addEventListener("change", changed);
  expect(getFillBlockReason(element)).toBe(reason);
  expect(fillElement(element, "変更")).toBe(reason);
  expect(readTargetValue(resolveTarget("#editor", document))).toBeUndefined();
  expect(getTargetCandidates(document)).not.toContain("#editor");
  expect(captureForm(document, null, []).entries).toEqual([]);
  expect(element.innerHTML).toBe(before);
  expect(element.firstElementChild).toBe(protectedNode);
  expect(protectedNode?.isConnected).toBe(true);
  expect(read).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});

test("保護された兄弟を巻き込まない子は，明示指定で読み書きできる", () => {
  document.body.innerHTML =
    '<div contenteditable><span id="editor">編集対象</span><span contenteditable="false" id="protected">固定</span></div>';
  renderedText(editor(), "編集対象");
  expect(readTargetValue(resolveTarget("#editor", document))).toBe("編集対象");
  expect(fillElement(editor(), "更新")).toBe("filled");
  expect(editor("protected").textContent).toBe("固定");
});

test("通常の入れ子編集領域は候補と取り込みから除外しない", () => {
  document.body.innerHTML =
    '<div id="editor" contenteditable><span>本文</span><div contenteditable="plaintext-only">入れ子</div></div>';
  renderedText(editor(), "本文\n入れ子");
  expect(getTargetCandidates(document)).toEqual(["#editor"]);
  expect(captureForm(document, null, []).entries).toEqual([
    { selector: "#editor", value: "本文\n入れ子" },
  ]);
  expect(fillElement(editor(), "更新")).toBe("filled");
});

test("編集ホストの機密指定を継承する子からも値を読み書きしない", () => {
  document.body.innerHTML =
    '<div contenteditable autocomplete="cc-number"><span id="editor">保持</span></div>';
  Object.defineProperty(editor(), "innerText", {
    get() {
      throw new Error("保護された内容は読まない");
    },
  });
  expect(fillElement(editor(), "変更")).toBe("unsupported");
  expect(readTargetValue(resolveTarget("#editor", document))).toBeUndefined();
  expect(editor().textContent).toBe("保持");
  expect(getTargetCandidates(document)).toEqual([]);
});

test("編集可能なbuttonはsubmit型ではなく編集欄として扱う", () => {
  document.body.innerHTML = '<button id="editor" contenteditable aria-label="本文">内容</button>';
  expect(getTargetInfo(resolveTarget("#editor", document))).toEqual({
    label: "本文",
    type: "contenteditable",
  });
  expect(getTargetCandidates(document)).toEqual(["#editor"]);
  expect(fillElement(editor(), "更新")).toBe("filled");
  expect(editor().textContent).toBe("更新");
});

test("入れ子は重複候補にせず，継承した子への入力イベントは編集ホストから送る", () => {
  document.body.innerHTML =
    '<div id="editor" contenteditable><span id="child">子</span><div id="nested" contenteditable>入れ子</div><div contenteditable="false"><span id="blocked">固定</span><div id="separate" contenteditable="plaintext-only">別領域</div></div></div>';
  expect(getTargetCandidates(document)).toEqual(["#separate"]);
  expect(getInputElements(document).map((element) => element.id)).toEqual(["editor", "separate"]);
  expect(getEditingHost(editor("child"))).toBe(editor());
  const changed = vi.fn();
  editor().addEventListener("input", changed);
  expect(fillElement(editor("child"), "更新")).toBe("filled");
  expect(changed.mock.calls[0][0].target).toBe(editor());
  expect(editor("nested").textContent).toBe("入れ子");
  expect(fillElement(editor("blocked"), "変更")).toBe("unsupported");
  expect(editor("blocked").textContent).toBe("固定");
  expect(resolveTarget("#blocked", document).status).toBe("missing");
});

test("候補・ラベル確認では内容を読まず，明示された現在値要求にだけ返す", () => {
  document.body.innerHTML = '<div id="editor" contenteditable aria-label="本文">既存の内容</div>';
  let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = () => {};
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (next: typeof listener) => {
          listener = next;
        },
        removeListener: vi.fn(),
      },
    },
  });
  const dispose = listenForTargetChecks(document);
  const read = vi.fn(() => "既存\nの内容");
  Object.defineProperty(editor(), "innerText", { get: read });
  const reply = vi.fn();
  listener({ type: TARGET_CANDIDATES_TYPE }, {}, reply);
  expect(reply.mock.calls[0][0].candidates).toEqual([
    { selector: "#editor", label: "本文", type: "contenteditable" },
  ]);
  listener({ type: TARGET_CHECK_TYPE, selector: "#editor" }, {}, reply);
  expect(read).not.toHaveBeenCalled();
  expect(reply.mock.calls[1][0]).not.toHaveProperty("currentValue");
  listener({ type: TARGET_CHECK_TYPE, selector: "#editor", includeCurrentValue: true }, {}, reply);
  expect(read).toHaveBeenCalledOnce();
  expect(reply.mock.calls[2][0].currentValue).toBe("既存\nの内容");
  dispose();
});

test("フォーム範囲に属する編集欄だけを取り込み，生成URLから再入力できる", () => {
  document.body.innerHTML =
    '<form id="first"><div id="editor" contenteditable><span contenteditable>既存内容</span></div><input id="name" value="名前"></form><form id="second"><div id="other" contenteditable>別フォーム</div></form><div id="outside" contenteditable>フォーム外</div>';
  renderedText(editor(), "既存\n内容");
  renderedText(editor("other"), "別フォーム");
  renderedText(editor("outside"), "フォーム外");
  const before = document.body.innerHTML;
  const scoped = captureForm(document, "#first", []);
  expect(scoped.entries.map((entry) => entry.value)).toEqual(["既存\n内容", "名前"]);
  expect(document.body.innerHTML).toBe(before);
  const all = captureForm(document, null, ["#editor"]);
  expect(all.entries.map((entry) => entry.value)).toEqual(["名前", "別フォーム", "フォーム外"]);
  expect(all.duplicates).toBe(1);
  const request = parseAutofillUrl(generateAutofillUrl("https://example.com/form", scoped.entries));
  expect(request?.entries).toEqual(scoped.entries);
  expect(fillElement(editor(), request?.entries[0].value ?? "")).toBe("filled");
  expect(editor().querySelectorAll("br")).toHaveLength(1);
  expect(editor().textContent).toBe("既存内容");
});

test("編集欄内の通常inputは値として扱い，まとめて取り込むときは領域を重複させない", () => {
  document.body.innerHTML =
    '<div id="editor" contenteditable>本文<input id="name" value="名前"></div>';
  renderedText(editor(), "本文");
  const input = document.getElementById("name") as HTMLInputElement;
  expect(fillElement(input, "更新")).toBe("filled");
  expect(input.value).toBe("更新");
  expect(input.textContent).toBe("");
  const result = captureForm(document, null, []);
  expect(result.entries).toEqual([{ selector: "#editor", value: "本文" }]);
  expect(result.duplicates).toBe(1);
});
