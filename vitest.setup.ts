import "@testing-library/jest-dom/vitest"
import { loadTestEnvironment } from "./server/runtime/test-environment.mjs"

loadTestEnvironment()

// Polyfill ResizeObserver for jsdom-based tests.
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-ignore
  window.ResizeObserver = ResizeObserver;
}

if (typeof document !== "undefined" && typeof document.elementFromPoint !== "function") {
  // jsdom doesn't implement elementFromPoint; mock a safe fallback for UI libraries that read it.
  // @ts-ignore
  document.elementFromPoint = () => null;
}

if (typeof window !== "undefined" && (!("localStorage" in window) || !window.localStorage?.setItem)) {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  // @ts-ignore
  window.localStorage = localStorageMock;
  // @ts-ignore
  globalThis.localStorage = localStorageMock;
}
