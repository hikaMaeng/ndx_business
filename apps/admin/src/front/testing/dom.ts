import { JSDOM } from "jsdom";

/**
 * A document for React to render into, plus the browser globals the app reads
 * at import time.
 *
 * Installed before any component is imported: `main.tsx` and the i18n helpers
 * touch `localStorage` and `document` while their modules evaluate, so a later
 * setup is too late.
 */
export function installDom(url = "http://localhost/"): void {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url,
    pretendToBeVisual: true,
  });
  const window = dom.window as unknown as Window & typeof globalThis;

  // `navigator` is getter-only on the Node global, so it cannot be assigned
  // the way the rest can. Defining the property replaces it outright.
  Object.defineProperty(globalThis, "navigator", {
    value: window.navigator, configurable: true, writable: true,
  });

  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  });

  // React 19 reads this to decide whether it may use `act`-only APIs.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}
