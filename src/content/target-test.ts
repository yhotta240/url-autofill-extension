import type { TargetTestRequest, TargetTestResponse } from "../shared/target-test.ts";
import { executeFill } from "./autofill.ts";
import { isEditableElement } from "./editable.ts";
import { resolveTarget } from "./resolver.ts";

export async function testTarget(
  root: Document,
  request: TargetTestRequest,
): Promise<TargetTestResponse> {
  const url = root.defaultView?.location.href ?? "";
  const reply = (result: TargetTestResponse["result"]): TargetTestResponse => ({ url, result });
  try {
    const page = new URL(request.pageUrl);
    if (!["http:", "https:"].includes(page.protocol) || page.href !== url)
      return reply("different-page");
    const target = resolveTarget(request.selector, root);
    if (target.status !== "found") return reply(target.status);
    if (target.kind !== "element" || !isEditableElement(target.element))
      return reply("unsupported");
    return reply(
      await executeFill(target.element, request.value, request.method, {
        clipboardPrepared: true,
        cancelled: () => root.defaultView?.location.href !== url,
      }),
    );
  } catch {
    return reply("error");
  }
}
