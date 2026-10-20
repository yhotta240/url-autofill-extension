import { startAutofill } from "./controller.ts";

if (window === window.top) startAutofill(document);
