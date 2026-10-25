import { type FillEntry, type FillTarget, MAX_FIELDS } from "../content/parser.ts";

export const FORM_CAPTURE_TYPE = "url-autofill:form-capture";
export type FormOption = { selector: string; label: string };
export type FormCaptureRequest =
  | { type: typeof FORM_CAPTURE_TYPE; action: "forms" }
  | {
      type: typeof FORM_CAPTURE_TYPE;
      action: "capture";
      scope: string | null;
      existing: FillTarget[];
    };
export type FormsResponse = { url: string; forms: FormOption[] };
export type CaptureResponse = {
  url: string;
  entries: FillEntry[];
  duplicates: number;
  skipped: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTarget(value: unknown): value is FillTarget {
  return (
    isRecord(value) &&
    (value.kind === "field" || value.kind === "selector") &&
    typeof value.value === "string"
  );
}

export function isFormCaptureRequest(value: unknown): value is FormCaptureRequest {
  if (!isRecord(value) || value.type !== FORM_CAPTURE_TYPE) return false;
  if (value.action === "forms") return true;
  return (
    value.action === "capture" &&
    (value.scope === null || typeof value.scope === "string") &&
    Array.isArray(value.existing) &&
    value.existing.length <= MAX_FIELDS &&
    value.existing.every(isTarget)
  );
}

export function isFormsResponse(value: unknown): value is FormsResponse {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    Array.isArray(value.forms) &&
    value.forms.every(
      (form) =>
        isRecord(form) && typeof form.selector === "string" && typeof form.label === "string",
    )
  );
}

export function isCaptureResponse(value: unknown): value is CaptureResponse {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    Array.isArray(value.entries) &&
    value.entries.length <= MAX_FIELDS &&
    value.entries.every(
      (entry) =>
        isRecord(entry) &&
        isTarget(entry.target) &&
        entry.target.kind === "selector" &&
        typeof entry.value === "string",
    ) &&
    Number.isInteger(value.duplicates) &&
    Number(value.duplicates) >= 0 &&
    Number.isInteger(value.skipped) &&
    Number(value.skipped) >= 0
  );
}

export function captureError(value: unknown): string | undefined {
  return isRecord(value) && typeof value.error === "string" ? value.error : undefined;
}
