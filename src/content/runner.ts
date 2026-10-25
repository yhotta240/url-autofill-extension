import { fillElement, fillRadioGroup } from "./autofill.ts";
import type { FillEntry } from "./parser.ts";
import { resolveTarget } from "./resolver.ts";

export const DOM_WAIT_MS = 10_000;
const BATCH_SIZE = 20;

/** 未検出の項目だけを最大10秒待つ．完了・中断時には監視とタイマーを解放する． */
export function startFilling(entries: FillEntry[], root: Document): () => void {
  const view = root.defaultView;
  if (!view || entries.length === 0) return () => {};

  const initialUrl = view.location.href;
  const deadline = Date.now() + DOM_WAIT_MS;
  const pending = new Set(entries);
  let queue: FillEntry[] = [];
  let stopped = false;
  let rescan = false;
  let frame: number | undefined;
  let fallback: number | undefined;
  let filled = 0;
  let skipped = 0;

  function clearScheduled(): void {
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    if (fallback !== undefined) view?.clearTimeout(fallback);
    frame = undefined;
    fallback = undefined;
  }

  function stop(): void {
    stopped = true;
    observer.disconnect();
    view?.clearTimeout(timeout);
    clearScheduled();
    pending.clear();
    queue = [];
  }

  function finish(): void {
    if (pending.size > 0) {
      view?.console.warn(`[URL AutoFill] 入力対象または選択肢の待機終了: ${pending.size}件`);
    }
    view?.console.info(`[URL AutoFill] 入力完了: ${filled}件，スキップ: ${skipped}件`);
    stop();
  }

  function schedule(): void {
    if (stopped || frame !== undefined) return;
    frame = view?.requestAnimationFrame(flush);
    // 背景タブでも処理を進め，rAFと二重実行しない．
    fallback = view?.setTimeout(flush, 100);
  }

  function flush(): void {
    clearScheduled();
    if (stopped) return;
    if (view?.location.href !== initialUrl) {
      stop();
      return;
    }
    if (Date.now() >= deadline) {
      finish();
      return;
    }
    if (queue.length === 0) {
      queue = [...pending];
      rescan = false;
    }

    for (const entry of queue.splice(0, BATCH_SIZE)) {
      // input/change のハンドラーによる遷移・中断にも対応する．
      if (stopped || view?.location.href !== initialUrl) {
        stop();
        return;
      }
      if (!pending.has(entry)) continue;
      const resolution = resolveTarget(entry.selector, root);
      if (resolution.status === "missing") continue;

      pending.delete(entry);
      let result: string = resolution.status;
      if (resolution.status === "found") {
        try {
          result =
            resolution.kind === "radio-group"
              ? fillRadioGroup(resolution.elements, entry.value)
              : fillElement(resolution.element, entry.value);
        } catch {
          result = "error";
        }
      }
      if (result === "waiting") {
        pending.add(entry);
      } else if (result === "filled") {
        filled += 1;
      } else {
        skipped += 1;
        // 対象名・セレクタ・入力値はログへ出さない．
        view?.console.warn(`[URL AutoFill] 入力をスキップ: ${result}`);
      }
    }

    if (pending.size === 0) {
      finish();
      return;
    }
    if (queue.length > 0 || rescan) schedule();
  }

  const observer = new view.MutationObserver(() => {
    rescan = true;
    schedule();
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  const timeout = view.setTimeout(finish, DOM_WAIT_MS);
  schedule();
  return stop;
}
