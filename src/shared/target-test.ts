import type { FillResult } from "../content/autofill.ts";
import { MAX_URL_LENGTH } from "../content/parser.ts";
import { type InputMethod, isInputMethod } from "./input-method.ts";

export const TARGET_TEST_TYPE = "url-autofill:test-target";
export type TargetTestRequest = {
  type: typeof TARGET_TEST_TYPE;
  pageUrl: string;
  selector: string;
  value: string;
  method: InputMethod;
};
export type TargetTestResult =
  | FillResult
  | "missing"
  | "ambiguous"
  | "invalid-selector"
  | "invalid-radio-group"
  | "different-page"
  | "error";
export type TargetTestResponse = { url: string; result: TargetTestResult };

export function isTargetTestRequest(value: unknown): value is TargetTestRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TargetTestRequest>;
  return (
    item.type === TARGET_TEST_TYPE &&
    typeof item.pageUrl === "string" &&
    item.pageUrl.length <= MAX_URL_LENGTH &&
    typeof item.selector === "string" &&
    item.selector.trim().length > 0 &&
    item.selector.length <= MAX_URL_LENGTH &&
    typeof item.value === "string" &&
    item.value.length <= MAX_URL_LENGTH &&
    isInputMethod(item.method)
  );
}

export function isTargetTestResponse(value: unknown): value is TargetTestResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TargetTestResponse>;
  return (
    typeof item.url === "string" &&
    [
      "filled",
      "paste-dispatched",
      "command-dispatched",
      "command-failed",
      "clipboard-unavailable",
      "clipboard-failed",
      "cancelled",
      "waiting",
      "unsupported",
      "disabled",
      "readonly",
      "invalid-value",
      "missing",
      "ambiguous",
      "invalid-selector",
      "invalid-radio-group",
      "different-page",
      "error",
    ].includes(item.result ?? "")
  );
}
