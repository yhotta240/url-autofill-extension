// @vitest-environment jsdom
import { afterEach, beforeEach, expect, type Mock, test, vi } from "vitest";
import { PopupManager } from "../src/popup/manager.ts";
import { LOG_STORAGE_KEY, type LogEntry } from "../src/utils/logger.ts";

vi.mock("../src/popup/components/document.ts", () => ({ setupDocumentTab() {} }));
vi.mock("../src/popup/components/info.ts", () => ({ setupInfoTab() {} }));
vi.mock("../src/popup/components/version.ts", () => ({ setupVersionTab() {} }));

type ChangeListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
type StorageCallback = (data: Record<string, unknown>) => void;
let listener: ChangeListener;
let storedLogs: LogEntry[];
let readEnabled: Mock<(callback: StorageCallback) => void>;

beforeEach(() => {
  storedLogs = [];
  readEnabled = vi.fn((callback) => callback({ enabled: false }));
  document.body.innerHTML = `
    <input type="checkbox" id="enabled">
    <div id="header"></div><div id="tab-menu"></div>
    <button id="maximize-button"></button><button id="minimize-button"></button>
    <button id="close-button"></button><button id="panel-button"></button>
    <button id="clear-button"></button><div id="resizer"></div>
    <div id="panel"><div id="messagePanel"><div id="message"></div></div></div>`;
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ name: "URL AutoFill", short_name: "URL AutoFill" }) },
    storage: {
      local: {
        get: (key: string, callback: StorageCallback) => {
          if (key === "enabled") {
            readEnabled(callback);
            return;
          }
          callback({ [LOG_STORAGE_KEY]: storedLogs, settings: {}, enabled: false });
        },
        set: vi.fn(),
      },
      onChanged: {
        addListener: vi.fn((callback: ChangeListener) => {
          listener = callback;
        }),
      },
    },
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function entry(message: string, hidden = false): LogEntry {
  return { message, hidden, timestamp: "2026-10-24 12:00:00", level: "info", source: "popup" };
}

function messages(): string[] {
  return [...document.querySelectorAll("#message > p > .text-break")].map(
    (element) => element.textContent ?? "",
  );
}

async function setup(): Promise<void> {
  new PopupManager();
  await vi.waitFor(() => expect(chrome.storage.onChanged.addListener).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(readEnabled).toHaveBeenCalledOnce());
}

test("200件到達後も新規ログを表示し，古いログを取り除く", async () => {
  storedLogs = Array.from({ length: 200 }, (_, index) => entry(`ログ${index}`));
  await setup();
  expect(messages()).toHaveLength(200);

  for (let index = 200; index < 203; index += 1) {
    storedLogs = [...storedLogs.slice(1), entry(`ログ${index}`)];
    listener({ [LOG_STORAGE_KEY]: { newValue: storedLogs } }, "local");
    expect(messages()).toEqual(storedLogs.map((log) => log.message));
  }
});

test("非表示ログを除外し，別設定では表示を変えず，ログ削除を反映する", async () => {
  storedLogs = [entry("既存ログ")];
  await setup();
  const updated = [entry("非表示ログ", true), entry("新規ログ")];
  listener({ [LOG_STORAGE_KEY]: { newValue: updated } }, "sync");
  listener({ enabled: { newValue: true } }, "local");
  expect(messages()).toEqual(["既存ログ"]);

  listener({ [LOG_STORAGE_KEY]: { newValue: updated } }, "local");
  expect(messages()).toEqual(["新規ログ"]);
  listener({ [LOG_STORAGE_KEY]: { oldValue: updated } }, "local");
  expect(messages()).toEqual([]);
});

test("別画面での有効・無効の変更と削除を反映し，保存やログ追加は行わない", async () => {
  await setup();
  const checkbox = document.getElementById("enabled") as HTMLInputElement;

  listener({ enabled: { newValue: true } }, "sync");
  expect(checkbox.checked).toBe(false);
  listener({ enabled: { newValue: true } }, "local");
  expect(checkbox.checked).toBe(true);
  listener({ enabled: { newValue: false } }, "local");
  expect(checkbox.checked).toBe(false);
  listener({ enabled: { newValue: true } }, "local");
  listener({ enabled: { oldValue: true } }, "local");
  expect(checkbox.checked).toBe(false);
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
  expect(messages()).toEqual([]);
});

test.each([true, false])("初期読み込み中に届いた変更（%s）を優先する", async (enabled) => {
  let finishRead!: StorageCallback;
  readEnabled.mockImplementation((callback) => {
    finishRead = callback;
  });
  await setup();

  listener({ enabled: { newValue: enabled } }, "local");
  finishRead({ enabled: !enabled });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((document.getElementById("enabled") as HTMLInputElement).checked).toBe(enabled);
});
