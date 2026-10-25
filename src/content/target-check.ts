import {
  isTargetCandidatesRequest,
  type TargetCandidatesResponse,
} from "../shared/target-candidates.ts";
import { isTargetCheckRequest, type TargetCheckResponse } from "../shared/target-check.ts";
import { getRadioInfo } from "./radio.ts";
import { resolveTarget } from "./resolver.ts";
import { getTargetCandidates } from "./target-candidates.ts";

/** 自動入力の有効状態に関係なく，検索結果だけを返す． */
export function listenForTargetChecks(root: Document): () => void {
  const view = root.defaultView;
  if (!view) return () => {};

  const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
    _sender,
    sendResponse,
  ) => {
    if (isTargetCandidatesRequest(message)) {
      sendResponse({
        url: view.location.href,
        candidates: getTargetCandidates(root, message.kind),
      } satisfies TargetCandidatesResponse);
      return;
    }
    if (!isTargetCheckRequest(message)) return;
    const result = resolveTarget(message.target, root);
    const radio = getRadioInfo(result);
    sendResponse({
      url: view.location.href,
      status: result.status,
      ...(radio ? { radio } : {}),
    } satisfies TargetCheckResponse);
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
