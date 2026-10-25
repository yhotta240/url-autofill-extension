import type { Resolution } from "../content/resolver.ts";

export const TARGET_CHECK_TYPE = "url-autofill:check-target";

export type TargetCheckRequest = { type: typeof TARGET_CHECK_TYPE; selector: string };
export type ValueInputOption = { label: string; value: string; disabled: boolean };
export type RadioInfo =
  | { mode: "direct"; group?: string; value: string }
  | { mode: "group"; group: string; options: ValueInputOption[] };
export type ValueInputInfo = { kind: "select"; options: ValueInputOption[] } | { kind: "checkbox" };
export type TargetCheckResponse = {
  url: string;
  status: Resolution["status"];
  radio?: RadioInfo;
  valueInput?: ValueInputInfo;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isTargetCheckRequest(value: unknown): value is TargetCheckRequest {
  return isRecord(value) && value.type === TARGET_CHECK_TYPE && typeof value.selector === "string";
}

export function isTargetCheckResponse(value: unknown): value is TargetCheckResponse {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    (value.status === "found" ||
      value.status === "missing" ||
      value.status === "ambiguous" ||
      value.status === "invalid-selector" ||
      value.status === "invalid-radio-group") &&
    (value.radio === undefined || (value.status === "found" && isRadioInfo(value.radio))) &&
    (value.valueInput === undefined ||
      (value.status === "found" && isValueInputInfo(value.valueInput)))
  );
}

function isRadioInfo(value: unknown): value is RadioInfo {
  if (!isRecord(value)) return false;
  if (value.mode === "direct") {
    return (
      typeof value.value === "string" &&
      (value.group === undefined || typeof value.group === "string")
    );
  }
  return (
    value.mode === "group" &&
    typeof value.group === "string" &&
    Array.isArray(value.options) &&
    value.options.length > 0 &&
    value.options.every(isOption)
  );
}

function isOption(value: unknown): value is ValueInputOption {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.value === "string" &&
    typeof value.disabled === "boolean"
  );
}

function isValueInputInfo(value: unknown): value is ValueInputInfo {
  return (
    isRecord(value) &&
    (value.kind === "checkbox" ||
      (value.kind === "select" && Array.isArray(value.options) && value.options.every(isOption)))
  );
}
