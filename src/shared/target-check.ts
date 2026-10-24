import type { FillTarget } from "../content/parser.ts";
import type { Resolution } from "../content/resolver.ts";

export const TARGET_CHECK_TYPE = "url-autofill:check-target";

export type TargetCheckRequest = { type: typeof TARGET_CHECK_TYPE; target: FillTarget };
export type TargetCheckResponse = { url: string; status: Resolution["status"] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isTargetCheckRequest(value: unknown): value is TargetCheckRequest {
  if (!isRecord(value) || value.type !== TARGET_CHECK_TYPE || !isRecord(value.target)) return false;
  return (
    (value.target.kind === "field" || value.target.kind === "selector") &&
    typeof value.target.value === "string"
  );
}

export function isTargetCheckResponse(value: unknown): value is TargetCheckResponse {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    (value.status === "found" ||
      value.status === "missing" ||
      value.status === "ambiguous" ||
      value.status === "invalid-selector")
  );
}
