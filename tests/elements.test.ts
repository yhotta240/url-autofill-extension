import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { test } from "vitest";
import { fillElement, fillRadioGroup } from "../src/content/autofill.ts";
import { resolveTarget } from "../src/content/resolver.ts";

test("ラジオの単体指定は同名の他ボタンへ展開しない", () => {
  const { document } = new JSDOM(
    '<input type="radio" name="plan" id="a" value="a"><input type="radio" name="plan" value="b">',
  ).window;
  const result = resolveTarget({ kind: "field", value: "a" }, document);
  assert.ok(result.status === "found" && result.kind === "element");
  assert.equal(result.element.id, "a");
});

test.each([
  { kind: "field", value: "plan" },
  { kind: "selector", value: "#scope input" },
  { kind: "selector", value: "#scope" },
] as const)("ラジオのグループは指定範囲のページ順で解決する: %j", (target) => {
  const { document } = new JSDOM(
    '<fieldset id="scope"><legend>プラン</legend><label><input type="radio" name="plan" value="a">A</label><input type="radio" name="plan" value="b"></fieldset>',
  ).window;
  const result = resolveTarget(target, document);
  assert.ok(result.status === "found" && result.kind === "radio-group");
  assert.deepEqual(
    result.elements.map((radio) => radio.value),
    ["a", "b"],
  );
});

test("親のhiddenを除外し，範囲外の同名ラジオへ展開しない", () => {
  const { document } = new JSDOM(
    '<div id="scope"><input type="hidden" name="plan"><label><input type="radio" name="plan" value="a">A</label></div><input type="radio" name="plan" value="b">',
  ).window;
  const result = resolveTarget({ kind: "selector", value: "#scope" }, document);
  assert.ok(result.status === "found" && result.kind === "radio-group");
  assert.equal(result.elements.length, 1);
});

test.each([
  '<input type="radio" name="x" value="a"><input type="radio" name="y" value="b">',
  '<input type="radio" name="x" value="a"><input name="x">',
  '<input type="radio" name="x" value="a"><textarea></textarea>',
  '<input type="radio" name="x" value="a"><select></select>',
  '<input type="radio" name="x" value="a"><input type="checkbox" name="x">',
  '<input type="radio" name="x" value="a"><button>送信</button>',
  '<input type="radio" value="a"><input type="radio" value="b">',
  '<input type="radio" name="x" value="a"><input type="radio" name="x" value="a">',
  '<form><input type="radio" name="x" value="a"></form><form><input type="radio" name="x" value="b"></form>',
])("異なるグループ・入力型・空name・重複valueを拒否する: %s", (html) => {
  const { document } = new JSDOM(`<div id="scope">${html}</div>`).window;
  assert.equal(
    resolveTarget({ kind: "selector", value: "#scope" }, document).status,
    "invalid-radio-group",
  );
});

test("親要素が複数一致した場合は配下をまとめない", () => {
  const { document } = new JSDOM(
    '<label><input type="radio" name="x" value="a"></label><label><input type="radio" name="x" value="b"></label>',
  ).window;
  assert.equal(
    resolveTarget({ kind: "selector", value: "label" }, document).status,
    "invalid-radio-group",
  );
});

test("グループ判定は祖先ではなくform属性による所有者を使う", () => {
  const { document } = new JSDOM(
    '<form id="owner"></form><div id="scope"><input type="radio" name="x" form="owner" value="a"><input type="radio" name="x" form="owner" value="b"></div>',
  ).window;
  const result = resolveTarget({ kind: "selector", value: "#scope" }, document);
  assert.ok(result.status === "found" && result.kind === "radio-group");
  result.elements[1].removeAttribute("form");
  assert.equal(
    resolveTarget({ kind: "selector", value: "#scope" }, document).status,
    "invalid-radio-group",
  );
});

test("グループの空valueは選択し，単体の空値は従来どおり解除する", () => {
  const { document } = new JSDOM(
    '<input type="radio" name="x" value=""><input type="radio" name="x" value="b" checked><input type="radio" name="x" value="disabled" disabled>',
  ).window;
  const radios = [...document.querySelectorAll("input")];
  const changed: string[] = [];
  document.addEventListener("input", () => changed.push("input"));
  document.addEventListener("change", () => changed.push("change"));
  assert.equal(fillRadioGroup(radios, ""), "filled");
  assert.equal(radios[0].checked, true);
  assert.equal(radios[1].checked, false);
  assert.deepEqual(changed, ["input", "change"]);
  assert.equal(fillElement(radios[0], ""), "filled");
  assert.equal(radios[0].checked, false);
  assert.equal(fillRadioGroup(radios, "disabled"), "disabled");
  assert.deepEqual(
    radios.map((radio) => radio.value),
    ["", "b", "disabled"],
  );
});

test("nameを優先し，一致しない場合のみidで検索する", () => {
  const { document } = new JSDOM('<input name="email"><input id="email"><input id="only-id">')
    .window;
  const named = resolveTarget({ kind: "field", value: "email" }, document);
  assert.equal(named.status, "found");
  if (named.status === "found" && named.kind === "element")
    assert.equal(named.element.getAttribute("name"), "email");
  assert.equal(resolveTarget({ kind: "field", value: "only-id" }, document).status, "found");
  assert.equal(resolveTarget({ kind: "field", value: "missing" }, document).status, "missing");
});

test("非フォーム要素のnameは重複判定から除外する", () => {
  const { document } = new JSDOM(
    '<meta name="description"><textarea name="description"></textarea><form name="email"></form><input name="email"><iframe name="choice"></iframe><select name="choice"></select>',
  ).window;
  for (const [name, tag] of [
    ["description", "TEXTAREA"],
    ["email", "INPUT"],
    ["choice", "SELECT"],
  ]) {
    const result = resolveTarget({ kind: "field", value: name }, document);
    assert.equal(result.status, "found");
    if (result.status === "found" && result.kind === "element")
      assert.equal(result.element.tagName, tag);
  }
});

test("非フォーム要素だけのnameに妨げられずidへフォールバックする", () => {
  const { document } = new JSDOM('<meta name="email"><input id="email">').window;
  const result = resolveTarget({ kind: "field", value: "email" }, document);
  assert.equal(result.status, "found");
  if (result.status === "found" && result.kind === "element")
    assert.equal(result.element.id, "email");
});

test.each([
  ["name", { kind: "field", value: "email" }, 'name="email"'],
  ["id", { kind: "field", value: "email" }, 'id="email"'],
  ["CSSセレクタ", { kind: "selector", value: ".email" }, 'class="email"'],
] as const)("%s指定でhidden入力を除外して一致件数を判定する", (_method, target, attribute) => {
  const { document } = new JSDOM(
    `<input type="hidden" ${attribute}><input type="email" ${attribute}>`,
  ).window;
  const result = resolveTarget(target, document);
  assert.ok(result.status === "found" && result.kind === "element", result.status);
  assert.equal(result.element, document.querySelector('input[type="email"]'));
  result.element.remove();
  assert.equal(resolveTarget(target, document).status, "missing");
});

test("nameがhidden入力にしか一致しない場合はidへフォールバックする", () => {
  const { document } = new JSDOM(
    '<input type="hidden" name="email"><input type="email" id="email">',
  ).window;
  const result = resolveTarget({ kind: "field", value: "email" }, document);
  assert.ok(result.status === "found" && result.kind === "element", result.status);
  assert.equal(result.element, document.getElementById("email"));
});

test("フォーム入力欄同士のnameが重複する場合は引き続きスキップする", () => {
  const { document } = new JSDOM('<meta name="x"><input name="x"><textarea name="x"></textarea>')
    .window;
  assert.equal(resolveTarget({ kind: "field", value: "x" }, document).status, "ambiguous");
});

test("重複したname/id/セレクタと不正なセレクタを拒否する", () => {
  const { document } = new JSDOM(
    '<input name="x"><input name="x" id="x"><input id="dup"><input id="dup">',
  ).window;
  assert.equal(resolveTarget({ kind: "field", value: "x" }, document).status, "ambiguous");
  assert.equal(resolveTarget({ kind: "field", value: "dup" }, document).status, "ambiguous");
  assert.equal(resolveTarget({ kind: "selector", value: "input" }, document).status, "ambiguous");
  assert.equal(
    resolveTarget({ kind: "selector", value: "[" }, document).status,
    "invalid-selector",
  );
});

test("属性名をセレクタへ混入させず，特殊文字のidも特定する", () => {
  const { document } = new JSDOM('<input id="safe"><input>').window;
  const unusual = 'a"], input, [id="b\\\n';
  const input = document.querySelector("input");
  assert.ok(input);
  input.id = unusual;
  const result = resolveTarget({ kind: "field", value: unusual }, document);
  assert.equal(result.status, "found");
  if (result.status === "found" && result.kind === "element") assert.equal(result.element, input);
});

test("文字列入力はネイティブsetterを使い，input/changeを伝播する", () => {
  const { document } = new JSDOM("<form><input><textarea></textarea></form>").window;
  const events: string[] = [];
  for (const type of ["input", "change", "click", "submit"]) {
    document.addEventListener(type, () => events.push(type));
  }
  const input = document.querySelector("input");
  assert.ok(input);
  Object.defineProperty(input, "value", {
    set() {
      throw new Error("custom setter");
    },
  });
  assert.equal(fillElement(input, "hello"), "filled");
  const textarea = document.querySelector("textarea");
  assert.ok(textarea);
  assert.equal(fillElement(textarea, "line1\nline2"), "filled");
  assert.equal(textarea.value, "line1\nline2");
  assert.deepEqual(events, ["input", "change", "input", "change"]);
});

test("対応input型と空文字を設定し，不正な数値・日付では既存値を保持する", () => {
  const { document } = new JSDOM().window;
  for (const [type, value] of [
    ["text", "田中"],
    ["email", "test@example.com"],
    ["search", "abc"],
    ["number", "123"],
    ["date", "2026-10-20"],
  ]) {
    const input = document.createElement("input");
    input.type = type;
    assert.equal(fillElement(input, value), "filled");
    assert.equal(input.value, value);
    if (type === "number" || type === "date") {
      assert.equal(fillElement(input, "invalid"), "invalid-value");
      assert.equal(input.value, value);
    }
    assert.equal(fillElement(input, ""), "filled");
    assert.equal(input.value, "");
  }
});

test("機密欄，未対応要素，disabled/readonlyを変更しない", () => {
  const { document } = new JSDOM(
    `<input type="password"><input type="file"><input type="hidden" value="token"><input type="submit"><input autocomplete="one-time-code"><textarea autocomplete="cc-number"></textarea><fieldset disabled><input></fieldset><input readonly><div contenteditable></div>`,
  ).window;
  for (const element of document.querySelectorAll("input, textarea, div")) {
    assert.notEqual(fillElement(element, "secret"), "filled");
  }
  assert.equal(document.querySelector('input[type="hidden"]')?.getAttribute("value"), "token");
});

test("チェックボックスの真偽値とラジオの値を選択し，無効な値を拒否する", () => {
  const { document } = new JSDOM(
    '<input type="checkbox"><input type="radio" name="choice" value="a" checked><input type="radio" name="choice" value="b">',
  ).window;
  const [checkbox, first, second] = document.querySelectorAll("input");
  for (const value of ["true", "1"]) {
    assert.equal(fillElement(checkbox, value), "filled");
    assert.equal(checkbox.checked, true);
  }
  for (const value of ["false", "0", ""]) {
    assert.equal(fillElement(checkbox, value), "filled");
    assert.equal(checkbox.checked, false);
  }
  assert.equal(fillElement(checkbox, "yes"), "invalid-value");
  assert.equal(fillElement(second, "b"), "filled");
  assert.equal(second.checked, true);
  assert.equal(first.checked, false);
  assert.equal(fillElement(second, "other"), "invalid-value");
  assert.equal(second.checked, true);
  assert.equal(fillElement(second, ""), "filled");
  assert.equal(second.checked, false);
});

test("selectの値を選択し，選択肢の追加待機と空文字による解除に対応する", () => {
  const { document } = new JSDOM(
    '<select multiple><option value="a" selected>A</option><option value="b">B</option><optgroup disabled><option value="blocked">X</option></optgroup></select>',
  ).window;
  const select = document.querySelector("select");
  assert.ok(select);
  assert.equal(fillElement(select, "missing"), "waiting");
  assert.equal(select.value, "a");
  assert.equal(fillElement(select, "blocked"), "disabled");
  assert.equal(fillElement(select, "b"), "filled");
  assert.deepEqual(
    Array.from(select.selectedOptions, (item) => item.value),
    ["b"],
  );
  assert.equal(fillElement(select, ""), "filled");
  assert.equal(select.selectedIndex, -1);
});
