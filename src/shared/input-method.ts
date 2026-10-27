export type InputMethod = "paste-event" | "insert-text" | "clipboard-paste";
export const DEFAULT_INPUT_METHOD: InputMethod = "clipboard-paste";

export function isInputMethod(value: unknown): value is InputMethod {
  return value === "paste-event" || value === "insert-text" || value === "clipboard-paste";
}
