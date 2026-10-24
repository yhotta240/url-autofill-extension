import { watchAutofillSetting } from "./activation.ts";
import { listenForTargetChecks } from "./target-check.ts";

if (window === window.top) {
  listenForTargetChecks(document);
  watchAutofillSetting(document);
}
