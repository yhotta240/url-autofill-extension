import { isEnabled } from "../utils/storage";
import { startAutofill } from "./controller.ts";

/** Popupと同じ有効状態を使い，無効化時は実行中の待機も停止する． */
export function watchAutofillSetting(root: Document): () => void {
  let enabled = false;
  let changed = false;
  let disposed = false;
  let stop = () => {};

  function apply(next: boolean): void {
    if (disposed || enabled === next) return;
    enabled = next;
    stop();
    stop = next ? startAutofill(root) : () => {};
  }

  function handleChange(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
    if (area !== "local" || !changes.enabled) return;
    changed = true;
    apply(changes.enabled.newValue === true);
  }

  async function initialize(): Promise<void> {
    try {
      const initial = await isEnabled();
      // 読み込み中に届いた新しい設定を，古い取得結果で上書きしない．
      if (!changed) apply(initial);
    } catch {
      if (!changed && !disposed) {
        root.defaultView?.console.warn(
          "[URL AutoFill] 有効状態を読み込めないため入力を開始しません",
        );
      }
    }
  }

  chrome.storage.onChanged.addListener(handleChange);
  void initialize();

  return () => {
    disposed = true;
    stop();
    chrome.storage.onChanged.removeListener(handleChange);
  };
}
