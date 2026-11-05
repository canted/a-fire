import { withBrowserSessionLock } from "./browserSessionLock.web";
import {
  clearPrivateMediaCache,
  configurePrivateMediaCache,
} from "./privateMediaCache";
import { sessionSubject, type SessionStorage, type Tokens } from "./api/transport";
const key = "afire.preview.session";
function parse(value: string | null): Tokens | null {
  try { return value ? JSON.parse(value) as Tokens : null; }
  catch { return null; }
}
export const sessionStorage: SessionStorage = {
  withLock: operation => withBrowserSessionLock(key, operation),
  subscribe(listener) {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || (event.key !== key && event.key !== null)) return;
      const previous = parse(event.oldValue);
      const next = parse(event.newValue);
      const previousSubject = sessionSubject(previous);
      // Identity is used only for cache invalidation, never authorization.
      const reset = !next || !previousSubject || previousSubject !== sessionSubject(next);
      if (next) void configurePrivateMediaCache(next.accessToken);
      else void clearPrivateMediaCache();
      listener(next, reset);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  },
  async read() {
    const value =
      typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as Tokens) : null;
  },
  async write(tokens) {
    if (tokens) window.localStorage.setItem(key, JSON.stringify(tokens));
    else window.localStorage.removeItem(key);
    // Shared browser housekeeping never stores credentials in the worker.
    if (tokens) void configurePrivateMediaCache(tokens.accessToken);
    else void clearPrivateMediaCache();
  },
};
