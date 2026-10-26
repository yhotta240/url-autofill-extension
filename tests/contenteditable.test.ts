// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { executeFill, fillElement, getFillBlockReason } from "../src/content/autofill.ts";
import { getEditingHost, getInputElements } from "../src/content/editable.ts";
import { captureForm } from "../src/content/form-capture.ts";
import { parseAutofillUrl } from "../src/content/parser.ts";
import { readTargetValue } from "../src/content/read-target-value.ts";
import { resolveTarget } from "../src/content/resolver.ts";
import { startFilling } from "../src/content/runner.ts";
import { getTargetCandidates } from "../src/content/target-candidates.ts";
import { listenForTargetChecks } from "../src/content/target-check.ts";
import { getTargetInfo } from "../src/content/target-info.ts";
import { testTarget } from "../src/content/target-test.ts";
import { TARGET_CANDIDATES_TYPE } from "../src/shared/target-candidates.ts";
import { TARGET_CHECK_TYPE } from "../src/shared/target-check.ts";
import { isTargetTestRequest, TARGET_TEST_TYPE } from "../src/shared/target-test.ts";
import { generateAutofillUrl } from "../src/utils/url-generator.ts";

const nativeEditable = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "isContentEditable");

beforeEach(() => {
  // jsdomにないクリップボードイベントを補完する．挿入処理は模倣しない．
  vi.stubGlobal(
    "DataTransfer",
    class {
      private values = new Map<string, string>();
      setData(type: string, value: string) {
        this.values.set(type, value);
      }
      getData(type: string) {
        return this.values.get(type) ?? "";
      }
    },
  );
  vi.stubGlobal(
    "ClipboardEvent",
    class extends Event {
      readonly clipboardData: DataTransfer | null;
      constructor(type: string, init: ClipboardEventInit = {}) {
        super(type, init);
        this.clipboardData = init.clipboardData ?? null;
      }
    },
  );
  // jsdom未実装の編集可否を補完する．サイト側の貼り付け処理は実Chromeで検証する．
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
  Reflect.deleteProperty(document, "execCommand");
  Reflect.deleteProperty(navigator, "clipboard");
  if (!nativeEditable) Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
});

function editor(id = "editor"): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function renderedText(element: HTMLElement, text: string): void {
  Object.defineProperty(element, "innerText", { configurable: true, get: () => text });
}

function mockCommand() {
  const command = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", { configurable: true, value: command });
  return command;
}
function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

test("insertText・空値のdeleteを一度だけ実行し，失敗時にpasteへ切り替えない", async () => {
  document.body.innerHTML = '<div id="editor" contenteditable>保持</div>';
  const command = mockCommand();
  const pasted = vi.fn();
  editor().addEventListener("paste", pasted);
  expect(await executeFill(editor(), "更新", "insert-text")).toBe("command-dispatched");
  expect(command).toHaveBeenLastCalledWith("insertText", false, "更新");
  expect(await executeFill(editor(), "", "insert-text")).toBe("command-dispatched");
  expect(command).toHaveBeenLastCalledWith("delete", false, "");
  command.mockReturnValue(false);
  expect(await executeFill(editor(), "更新", "insert-text")).toBe("command-failed");
  expect(command).toHaveBeenCalledTimes(3);
  expect(pasted).not.toHaveBeenCalled();
  expect(editor().textContent).toBe("保持");
});

test("実pasteはクリップボード準備後に実行し，Popupで準備済みなら書き直さない", async () => {
  document.body.innerHTML = '<div id="editor" contenteditable>保持</div>';
  const order: string[] = [];
  mockClipboard(async () => {
    order.push("write");
  });
  const command = mockCommand();
  command.mockImplementation(() => {
    order.push("paste");
    return true;
  });
  expect(await executeFill(editor(), "更新", "clipboard-paste")).toBe("command-dispatched");
  expect(order).toEqual(["write", "paste"]);
  order.length = 0;
  expect(await executeFill(editor(), "更新", "clipboard-paste", { clipboardPrepared: true })).toBe(
    "command-dispatched",
  );
  expect(order).toEqual(["paste"]);
});

test("共通の既定は実pasteで，通常inputとradioの処理は変えない", async () => {
  document.body.innerHTML =
    '<input id="plain"><input id="radio" type="radio" name="r" value="yes"><div id="editor" contenteditable>保持</div>';
  const write = vi.fn(async () => {});
  mockClipboard(write);
  const command = mockCommand();
  vi.useFakeTimers();
  const stop = startFilling(
    [
      { selector: "#plain", value: "名前" },
      { selector: "#radio", value: "yes" },
      { selector: "#editor", value: "本文" },
    ],
    document,
  );
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect((editor("plain") as HTMLInputElement).value).toBe("名前");
    expect((editor("radio") as HTMLInputElement).checked).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith("本文");
    expect(command).toHaveBeenCalledExactlyOnceWith("paste", false, "本文");
  } finally {
    stop();
    vi.useRealTimers();
  }
});

test("クリップボード準備中の中断や保護属性追加では貼り付けない", async () => {
  document.body.innerHTML = '<div id="editor" contenteditable>保持</div>';
  let done: (() => void) | undefined;
  mockClipboard(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  const command = mockCommand();
  let cancelled = false;
  const first = executeFill(editor(), "更新", "clipboard-paste", { cancelled: () => cancelled });
  cancelled = true;
  done?.();
  expect(await first).toBe("cancelled");
  const second = executeFill(editor(), "更新", "clipboard-paste");
  editor().setAttribute("aria-readonly", "true");
  done?.();
  expect(await second).toBe("readonly");
  expect(command).not.toHaveBeenCalled();
});

test("クリップボードAPI欠如と書き込み失敗を返し，別方式を試さない", async () => {
  document.body.innerHTML = '<div id="editor" contenteditable>保持</div>';
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  expect(await executeFill(editor(), "更新", "clipboard-paste")).toBe("clipboard-unavailable");
  mockClipboard(async () => {
    throw new Error("denied");
  });
  expect(await executeFill(editor(), "更新", "clipboard-paste")).toBe("clipboard-failed");
  expect(editor().textContent).toBe("保持");
});

test("テスト要求のページ・対象・方式と保護属性を検証する", async () => {
  document.body.innerHTML = '<div id="editor" contenteditable>保持</div>';
  const request = {
    type: TARGET_TEST_TYPE,
    pageUrl: location.href,
    selector: "#editor",
    value: "更新",
    method: "insert-text",
  } as const;
  expect(isTargetTestRequest(request)).toBe(true);
  expect(isTargetTestRequest({ ...request, method: "unknown" })).toBe(false);
  const command = mockCommand();
  expect(
    (await testTarget(document, { ...request, pageUrl: "https://other.example/" })).result,
  ).toBe("different-page");
  expect(command).not.toHaveBeenCalled();
  expect((await testTarget(document, request)).result).toBe("command-dispatched");
  editor().setAttribute("aria-readonly", "true");
  expect((await testTarget(document, request)).result).toBe("readonly");
  expect(command).toHaveBeenCalledOnce();
});

test("非同期入力中のDOM変更でも項目を並行実行せず，中断後は入力しない", async () => {
  document.body.innerHTML =
    '<div id="editor" contenteditable>保持</div><div id="second" contenteditable>保持</div>';
  const resolvers: Array<() => void> = [];
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  mockClipboard(writeText);
  const command = mockCommand();
  vi.useFakeTimers();
  const stop = startFilling(
    [
      { selector: "#editor", value: "first" },
      { selector: "#second", value: "second" },
    ],
    document,
  );
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(writeText).toHaveBeenCalledTimes(1);
    document.body.setAttribute("data-changed", "true");
    await vi.advanceTimersByTimeAsync(100);
    expect(writeText).toHaveBeenCalledTimes(1);
    resolvers[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(command).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledTimes(2);
    stop();
    resolvers[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(command).toHaveBeenCalledOnce();
  } finally {
    stop();
    vi.useRealTimers();
    document.body.removeAttribute("data-changed");
  }
});

test.each([
  "",
  "true",
  "TRUE",
  "plaintext-only",
])("編集欄%sへ改行とHTML文字列をtext/plainのpasteで渡す", async (mode) => {
  document.body.innerHTML = `<div id="editor" contenteditable="${mode}" aria-label="本文"><b>元の内容</b></div>`;
  const element = editor();
  const events: Event[] = [];
  element.addEventListener("paste", (event) => events.push(event));
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
  const before = element.innerHTML;
  expect(await executeFill(element, value, "paste-event")).toBe("paste-dispatched");
  expect(element.innerHTML).toBe(before);
  expect(events.map((event) => event.type)).toEqual(["paste"]);
  expect(events[0]).toBeInstanceOf(ClipboardEvent);
  expect((events[0] as ClipboardEvent).clipboardData?.getData("text/plain")).toBe(value);
  expect((events[0] as ClipboardEvent).clipboardData?.getData("text/html")).toBe("");
  expect(events[0].bubbles && events[0].composed && events[0].cancelable).toBe(true);
  expect(document.activeElement).toBe(element);
  expect(document.getSelection()?.toString()).toBe("元の内容");
  expect(await executeFill(element, "", "paste-event")).toBe("paste-dispatched");
  expect((events[1] as ClipboardEvent).clipboardData?.getData("text/plain")).toBe("");
  expect(element.innerHTML).toBe(before);
});

test("サイトのpaste処理が使う選択範囲を先に通知する", async () => {
  document.body.innerHTML = '<div id="editor" contenteditable>元の内容</div>';
  let siteSelection = "";
  const selectionChanged = () => {
    siteSelection = document.getSelection()?.toString() ?? "";
  };
  document.addEventListener("selectionchange", selectionChanged);
  editor().addEventListener("paste", (event) => {
    event.preventDefault();
    expect(siteSelection).toBe("元の内容");
    editor().textContent = event.clipboardData?.getData("text/plain") ?? "";
  });
  try {
    expect(await executeFill(editor(), "更新", "paste-event")).toBe("paste-dispatched");
    expect(editor().textContent).toBe("更新");
  } finally {
    document.removeEventListener("selectionchange", selectionChanged);
  }
});

test("paste要求は一度だけ送信し，入力完了として集計しない", async () => {
  document.body.innerHTML = '<div id="editor" contenteditable>保持</div>';
  const pasted = vi.fn((event: Event) => event.preventDefault());
  editor().addEventListener("paste", pasted);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.useFakeTimers();
  const stop = startFilling([{ selector: "#editor", value: "更新" }], document, "paste-event");
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(pasted).toHaveBeenCalledOnce();
    expect(editor().textContent).toBe("保持");
    expect(log).toHaveBeenCalledWith("[URL AutoFill] 入力完了: 0件，スキップ: 0件");
    expect(log).toHaveBeenCalledWith("[URL AutoFill] 貼り付け要求を送信: 1件");
  } finally {
    stop();
    log.mockRestore();
    vi.useRealTimers();
  }
});

test.each([
  ['contenteditable="false"', "unsupported"],
  ['contenteditable="invalid"', "unsupported"],
  ['contenteditable="true" aria-readonly="true"', "readonly"],
  ['contenteditable="true" aria-disabled="true"', "disabled"],
  ['contenteditable="true" inert', "disabled"],
  ['contenteditable="true" autocomplete="one-time-code"', "unsupported"],
])("編集不可・対象外の編集欄を変更せず，現在値も読まない: %s", async (attributes, reason) => {
  document.body.innerHTML = `<div id="editor" ${attributes}>保持</div>`;
  const element = editor();
  Object.defineProperty(element, "innerText", {
    get() {
      throw new Error("対象外は読まない");
    },
  });
  expect(getFillBlockReason(element)).toBe(reason);
  expect(await executeFill(element, "変更")).toBe(reason);
  expect(element.textContent).toBe("保持");
  expect(getTargetCandidates(document)).toEqual([]);
  expect(readTargetValue({ status: "found", kind: "element", element })).toBeUndefined();
});

test("機密指定の子を含む親編集欄を読み書き・候補・取り込みから除外する", async () => {
  document.body.innerHTML =
    '<div id="editor" contenteditable>本文<span autocomplete="one-time-code">123456</span></div>';
  const element = editor();
  const before = element.innerHTML;
  const read = vi.fn(() => "本文123456");
  Object.defineProperty(element, "innerText", { get: read });
  expect(readTargetValue(resolveTarget("#editor", document))).toBeUndefined();
  expect(await executeFill(element, "変更")).toBe("unsupported");
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
])("保護された子を含む親を拒否し，子のDOMと入力値を保持する: %s", async (child, reason) => {
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
  expect(await executeFill(element, "変更")).toBe(reason);
  expect(readTargetValue(resolveTarget("#editor", document))).toBeUndefined();
  expect(getTargetCandidates(document)).not.toContain("#editor");
  expect(captureForm(document, null, []).entries).toEqual([]);
  expect(element.innerHTML).toBe(before);
  expect(element.firstElementChild).toBe(protectedNode);
  expect(protectedNode?.isConnected).toBe(true);
  expect(read).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});

test("保護された兄弟を巻き込まない子は，明示指定で読み書きできる", async () => {
  document.body.innerHTML =
    '<div contenteditable><span id="editor">編集対象</span><span contenteditable="false" id="protected">固定</span></div>';
  renderedText(editor(), "編集対象");
  expect(readTargetValue(resolveTarget("#editor", document))).toBe("編集対象");
  expect(await executeFill(editor(), "更新", "paste-event")).toBe("paste-dispatched");
  expect(editor("protected").textContent).toBe("固定");
});

test("通常の入れ子編集領域は候補と取り込みから除外しない", async () => {
  document.body.innerHTML =
    '<div id="editor" contenteditable><span>本文</span><div contenteditable="plaintext-only">入れ子</div></div>';
  renderedText(editor(), "本文\n入れ子");
  expect(getTargetCandidates(document)).toEqual(["#editor"]);
  expect(captureForm(document, null, []).entries).toEqual([
    { selector: "#editor", value: "本文\n入れ子" },
  ]);
  expect(await executeFill(editor(), "更新", "paste-event")).toBe("paste-dispatched");
});

test("編集ホストの機密指定を継承する子からも値を読み書きしない", async () => {
  document.body.innerHTML =
    '<div contenteditable autocomplete="cc-number"><span id="editor">保持</span></div>';
  Object.defineProperty(editor(), "innerText", {
    get() {
      throw new Error("保護された内容は読まない");
    },
  });
  expect(await executeFill(editor(), "変更")).toBe("unsupported");
  expect(readTargetValue(resolveTarget("#editor", document))).toBeUndefined();
  expect(editor().textContent).toBe("保持");
  expect(getTargetCandidates(document)).toEqual([]);
});

test("編集可能なbuttonはsubmit型ではなく編集欄として扱う", async () => {
  document.body.innerHTML = '<button id="editor" contenteditable aria-label="本文">内容</button>';
  expect(getTargetInfo(resolveTarget("#editor", document))).toEqual({
    label: "本文",
    type: "contenteditable",
  });
  expect(getTargetCandidates(document)).toEqual(["#editor"]);
  expect(await executeFill(editor(), "更新", "paste-event")).toBe("paste-dispatched");
  expect(editor().textContent).toBe("内容");
});

test("継承した子だけを選択し，pasteを編集ホストへ伝播する", async () => {
  document.body.innerHTML =
    '<div id="editor" contenteditable><span id="child">子</span><div id="nested" contenteditable>入れ子</div><div contenteditable="false"><span id="blocked">固定</span><div id="separate" contenteditable="plaintext-only">別領域</div></div></div>';
  expect(getTargetCandidates(document)).toEqual(["#separate"]);
  expect(getInputElements(document).map((element) => element.id)).toEqual(["editor", "separate"]);
  expect(getEditingHost(editor("child"))).toBe(editor());
  const changed = vi.fn();
  editor().addEventListener("paste", changed);
  expect(await executeFill(editor("child"), "更新", "paste-event")).toBe("paste-dispatched");
  expect(changed.mock.calls[0][0].target).toBe(editor("child"));
  expect(document.activeElement).toBe(editor());
  expect(document.getSelection()?.toString()).toBe("子");
  expect(editor("nested").textContent).toBe("入れ子");
  expect(await executeFill(editor("blocked"), "変更", "paste-event")).toBe("unsupported");
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

test("フォーム範囲に属する編集欄だけを取り込む", () => {
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
