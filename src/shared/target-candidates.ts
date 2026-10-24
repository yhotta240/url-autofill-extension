import type { FillTarget } from "../content/parser.ts";

export const TARGET_CANDIDATES_TYPE = "url-autofill:target-candidates";

export type TargetCandidatesRequest = {
  type: typeof TARGET_CANDIDATES_TYPE;
  kind: FillTarget["kind"];
};
export type TargetCandidatesResponse = { url: string; candidates: string[] };

export function isTargetCandidatesRequest(value: unknown): value is TargetCandidatesRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<TargetCandidatesRequest>;
  return (
    request.type === TARGET_CANDIDATES_TYPE &&
    (request.kind === "field" || request.kind === "selector")
  );
}

export function isTargetCandidatesResponse(value: unknown): value is TargetCandidatesResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Partial<TargetCandidatesResponse>;
  return (
    typeof response.url === "string" &&
    Array.isArray(response.candidates) &&
    response.candidates.every((candidate) => typeof candidate === "string")
  );
}
