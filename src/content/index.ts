import { watchAutofillSetting } from "./activation.ts";

if (window === window.top) watchAutofillSetting(document);
