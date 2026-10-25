// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseAutofillUrl } from "../src/content/parser.ts";
import { resolveTarget } from "../src/content/resolver.ts";
import { getTargetCandidates } from "../src/content/target-candidates.ts";
import { listenForTargetChecks } from "../src/content/target-check.ts";
import { TARGET_CANDIDATES_TYPE } from "../src/shared/target-candidates.ts";
import { generateAutofillUrl } from "../src/utils/url-generator.ts";

beforeEach(() => {
  // jsdomにはCSS.escapeがないため，識別子内の特殊文字を16進エスケープする．
  vi.stubGlobal("CSS", {
    escape: (value: string) =>
      value.replace(/[^a-zA-Z_-]/gu, (char) => `\\${char.codePointAt(0)?.toString(16)} `),
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test("name/idを要素順で返し，非フォームのnameや同じ要素の重複を除く", () => {
  document.body.innerHTML =
    '<meta name="description"><textarea name="description" id="description"></textarea><input name="email" id="email-id"><input name="other" id="email"><select id="choice"></select>';
  expect(getTargetCandidates(document, "field")).toEqual([
    "description",
    "email",
    "email-id",
    "other",
    "choice",
  ]);
});

test("ラジオのCSS候補をグループへまとめ，重複valueなら単体を残す", () => {
  document.body.innerHTML =
    '<fieldset id="parent"><input type="radio" name="plan" id="a" value="a"><input type="radio" name="plan" id="b" value="b"></fieldset>';
  expect(getTargetCandidates(document, "field")).toEqual(["plan", "a", "b"]);
  expect(getTargetCandidates(document, "selector")).toEqual(["input[type=radio][name=plan]"]);
  document.querySelector<HTMLInputElement>("#b")?.setAttribute("value", "a");
  expect(getTargetCandidates(document, "field")).toEqual(["a", "b"]);
  expect(getTargetCandidates(document, "selector")).toEqual(["#a", "#b"]);
});

test("同名でも別フォームを混ぜず，form属性で関連付いた範囲外のラジオも含める", () => {
  document.body.innerHTML =
    '<form id="first"><input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b" disabled><input type="radio" name="plan" value="other" form="second"></form><input type="radio" name="plan" value="external" form="first"><form id="second"><input type="radio" name="plan" value="c"></form>';
  const selectors = getTargetCandidates(document, "selector");
  expect(selectors).toHaveLength(2);
  const groups = selectors.map((selector) => {
    const result = resolveTarget({ kind: "selector", value: selector }, document);
    expect(result.status).toBe("found");
    if (result.status !== "found" || result.kind !== "radio-group")
      throw new Error("グループではありません");
    return result.elements;
  });
  expect(groups[0].map((radio) => radio.value)).toEqual(["a", "b", "external"]);
  expect(groups[1].map((radio) => radio.value)).toEqual(["other", "c"]);
});

test("IDのないフォームとフォーム外の同名グループも別々のCSS候補にする", () => {
  document.body.innerHTML =
    '<input type="radio" name="plan" value="outside-a"><input type="radio" name="plan" value="outside-b"><form><input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b"></form><form><input type="radio" name="plan" value="c"><input type="radio" name="plan" value="d"></form>';
  const selectors = getTargetCandidates(document, "selector");
  expect(selectors).toHaveLength(3);
  expect(
    selectors.map((selector) =>
      [...document.querySelectorAll<HTMLInputElement>(selector)].map((radio) => radio.value),
    ),
  ).toEqual([
    ["outside-a", "outside-b"],
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("単独・nameなし・入力対象外を含むラジオは単体候補を維持する", () => {
  document.body.innerHTML =
    '<input type="radio" id="single" name="single" value="a"><input type="radio" id="unnamed" value="a"><input type="radio" id="safe" name="blocked" value="a"><input type="radio" name="blocked" value="b" autocomplete="one-time-code"><input type="checkbox" id="check" name="single">';
  expect(getTargetCandidates(document, "selector")).toEqual([
    "#single",
    "#unnamed",
    "#safe",
    "#check",
  ]);
});

test("グループ全体を指せない場合は，一部だけをまとめず単体候補を残す", () => {
  document.body.innerHTML =
    '<input type="radio" id="a" name="plan" value="a"><input type="radio" id="b" name="plan" value="b"><input type="radio" id="orphan" name="plan" value="orphan" form="missing"><form id="owner"><input type="radio" name="plan" value="c"><input type="radio" name="plan" value="d"></form>';
  const selectors = getTargetCandidates(document, "selector");
  expect(selectors.slice(0, 3)).toEqual(["#a", "#b", "#orphan"]);
  expect(selectors).toHaveLength(4);
  expect(
    [...document.querySelectorAll<HTMLInputElement>(selectors[3])].map((radio) => radio.value),
  ).toEqual(["c", "d"]);
});

test("特殊文字を含むグループ名をエスケープし，生成URLから同じグループを復元できる", () => {
  document.body.innerHTML = '<input type="radio" value="a"><input type="radio" value="b">';
  for (const radio of document.querySelectorAll("input")) radio.name = 'プラン["a"]';
  const selectors = getTargetCandidates(document, "selector");
  expect(selectors).toHaveLength(1);
  const entry = { target: { kind: "selector" as const, value: selectors[0] }, value: "b" };
  const request = parseAutofillUrl(generateAutofillUrl(window.location.href, [entry]));
  expect(request?.entries).toEqual([entry]);
  expect(resolveTarget(entry.target, document)).toMatchObject({
    status: "found",
    kind: "radio-group",
  });
});

test("曖昧なname/idや別の要素を指すidを除き，一意な代替idは残す", () => {
  document.body.innerHTML =
    '<input name="repeat" id="first"><input name="repeat" id="second"><div id="duplicate"></div><input id="duplicate"><input name="   "><input>';
  expect(getTargetCandidates(document, "field")).toEqual(["first", "second"]);
});

test.each([
  "\n",
  "\r",
  "\r\n",
])("改行を含むname/idはCSSでのみ指定でき，有効な代替名は残す: %j", (newline) => {
  const named = document.createElement("input");
  named.name = `first${newline}last`;
  named.id = "safe-id";
  const identified = document.createElement("textarea");
  identified.id = `other${newline}id`;
  identified.name = "safe-name";
  const similar = document.createElement("input");
  similar.name = "firstlast";
  const controls = [named, identified, similar];
  document.body.append(...controls);

  expect(getTargetCandidates(document, "field")).toEqual(["safe-id", "safe-name", "firstlast"]);
  const selectors = getTargetCandidates(document, "selector");
  expect(selectors).toHaveLength(controls.length);
  selectors.forEach((selector, index) => {
    expect(document.querySelector(selector)).toBe(controls[index]);
  });
});

test("fill(で始まるname/idを除外し，代替候補とCSSからURLを生成できる", () => {
  document.body.innerHTML =
    '<input name="fill(email)" id="email-id"><input name="message" id="fill(message)"><textarea name="fill(notes)"></textarea><input id="fill(id)"><input name="refill(email)"><input name="Fill(email)">';
  const fields = getTargetCandidates(document, "field");
  expect(fields).toEqual(["email-id", "message", "refill(email)", "Fill(email)"]);
  const controls = [...document.querySelectorAll("input, textarea")];
  const selectors = getTargetCandidates(document, "selector");
  expect(selectors).toHaveLength(controls.length);
  selectors.forEach((selector, index) => {
    expect(document.querySelector(selector)).toBe(controls[index]);
  });
  for (const [kind, values] of [
    ["field", fields],
    ["selector", selectors],
  ] as const) {
    for (const value of values) {
      const entry = { target: { kind, value }, value: "test" };
      const url = generateAutofillUrl(window.location.href, [entry]);
      expect(parseAutofillUrl(url)?.entries).toEqual([entry]);
    }
  }
});

test("既存の自動入力に対応しない入力欄は両方の候補から除く", () => {
  document.body.innerHTML = `
    <input name="text"><input type="checkbox" name="check"><input type="radio" id="radio">
    <input type="password" name="password"><input type="hidden" name="hidden">
    <input type="file" name="file"><input type="tel" name="tel"><button name="button"></button>
    <input name="otp" autocomplete="section-signin one-time-code">
    <textarea name="card" autocomplete="CC-NUMBER"></textarea>
    <input name="auth" autocomplete="new-password"><input name="disabled" disabled>
    <fieldset disabled><input name="fieldset-disabled"></fieldset>
    <input name="readonly" readonly><textarea name="readonly-textarea" readonly></textarea>
    <select name="disabled-select" disabled></select>`;
  expect(getTargetCandidates(document, "field")).toEqual(["text", "check", "radio"]);
  expect(getTargetCandidates(document, "selector")).toEqual([
    "input[name=text]",
    "input[name=check]",
    "#radio",
  ]);
});

test("CSSはidとnameを優先し，属性なし・重複ありの要素も一意に指す", () => {
  document.body.innerHTML =
    '<form id="form"><input id="email" name="email"><textarea name="message"></textarea><input><span></span><input><select name="repeat"></select><select name="repeat"></select><input id="dup"><input id="dup"></form>';
  const controls = [...document.querySelectorAll("input, textarea, select")];
  const selectors = getTargetCandidates(document, "selector");
  expect(selectors.slice(0, 2)).toEqual(["#email", "textarea[name=message]"]);
  expect(selectors).toHaveLength(controls.length);
  selectors.forEach((selector, index) => {
    const result = resolveTarget({ kind: "selector", value: selector }, document);
    expect(result.status).toBe("found");
    if (result.status === "found" && result.kind === "element")
      expect(result.element).toBe(controls[index]);
  });
});

test("日本語・予約文字を含むname/idをエスケープし，入力値やページを変更しない", () => {
  const idInput = document.createElement("input");
  idInput.id = '1日本語:[]"';
  const nameInput = document.createElement("textarea");
  nameInput.name = '氏名["a"]\\\n';
  document.body.append(idInput, nameInput);
  const before = document.body.innerHTML;
  for (const element of [idInput, nameInput]) {
    Object.defineProperty(element, "value", {
      get: () => {
        throw new Error("入力値は取得しない");
      },
    });
  }
  const changed = vi.fn();
  document.addEventListener("input", changed);
  const selectors = getTargetCandidates(document, "selector");
  expect(selectors).toHaveLength(2);
  expect(document.querySelector(selectors[0])).toBe(idInput);
  expect(document.querySelector(selectors[1])).toBe(nameInput);
  expect(getTargetCandidates(document, "field")).toEqual([idInput.id]);
  expect(document.body.innerHTML).toBe(before);
  expect(changed).not.toHaveBeenCalled();
  document.removeEventListener("input", changed);
});

test("候補取得は有効状態を参照せず，要求した指定方法の文字列だけを返す", () => {
  document.body.innerHTML = '<input id="email" name="email" value="secret">';
  let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = () => {};
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        },
        removeListener: vi.fn(),
      },
    },
  });
  const dispose = listenForTargetChecks(document);
  const reply = vi.fn();
  listener({ type: TARGET_CANDIDATES_TYPE, kind: "selector" }, {}, reply);
  expect(reply).toHaveBeenCalledExactlyOnceWith({
    url: window.location.href,
    candidates: ["#email"],
  });
  reply.mockClear();
  for (const request of [
    null,
    { type: "other" },
    { type: TARGET_CANDIDATES_TYPE, kind: "unknown" },
  ]) {
    listener(request, {}, reply);
  }
  expect(reply).not.toHaveBeenCalled();
  dispose();
});
