import { Window } from "happy-dom";

// Testing Library binds screen to document at import time. Share one document
// across interaction test files when Bun runs them in the same process.
export const window = new Window({ url: "http://localhost:3000" });
Object.assign(globalThis, { window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver });
