import { isFormCaptureRequest } from "../shared/form-capture.ts";
import {
  isTargetCandidatesRequest,
  type TargetCandidatesResponse,
} from "../shared/target-candidates.ts";
import {
  isTargetCheckRequest,
  type TargetCheckResponse,
  type ValueInputInfo,
} from "../shared/target-check.ts";
import { getFillBlockReason } from "./autofill.ts";
import { captureForm, getCaptureForms } from "./form-capture.ts";
import { getRadioInfo } from "./radio.ts";
import { resolveTarget } from "./resolver.ts";
import { getTargetCandidates } from "./target-candidates.ts";

function getValueInputInfo(element: Element): ValueInputInfo | undefined {
  const view = element.ownerDocument.defaultView;
  if (!view) return;
  const isSelect = element instanceof view.HTMLSelectElement;
  const isCheckbox = element instanceof view.HTMLInputElement && element.type === "checkbox";
  if ((!isSelect && !isCheckbox) || getFillBlockReason(element)) return;
  if (isSelect) {
    const seen = new Set<string>();
    const options = [];
    for (const option of element.options) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      options.push({
        label: option.label,
        value: option.value,
        disabled: option.disabled || option.closest("optgroup[disabled]") !== null,
      });
    }
    return { kind: "select", options };
  }
  return { kind: "checkbox" };
}

/** 自動入力の有効状態に関係なく，検索結果だけを返す． */
export function listenForTargetChecks(root: Document): () => void {
  const view = root.defaultView;
  if (!view) return () => {};

  const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
    _sender,
    sendResponse,
  ) => {
    if (isFormCaptureRequest(message)) {
      try {
        sendResponse({
          url: view.location.href,
          ...(message.action === "forms"
            ? { forms: getCaptureForms(root) }
            : captureForm(root, message.scope, message.existing)),
        });
      } catch (error) {
        sendResponse({
          url: view.location.href,
          error: error instanceof Error ? error.message : "入力内容を取得できませんでした．",
        });
      }
      return;
    }
    if (isTargetCandidatesRequest(message)) {
      sendResponse({
        url: view.location.href,
        candidates: getTargetCandidates(root),
      } satisfies TargetCandidatesResponse);
      return;
    }
    if (!isTargetCheckRequest(message)) return;
    const result = resolveTarget(message.selector, root);
    const radio = getRadioInfo(result);
    const valueInput =
      result.status === "found" && result.kind === "element"
        ? getValueInputInfo(result.element)
        : undefined;
    sendResponse({
      url: view.location.href,
      status: result.status,
      ...(radio ? { radio } : {}),
      ...(valueInput ? { valueInput } : {}),
    } satisfies TargetCheckResponse);
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
