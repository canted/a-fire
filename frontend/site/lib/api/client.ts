import { withBrowserSessionLock } from "../../../src/lib/browserSessionLock.web";
import { env } from "../env";
import { resetAnalytics } from "../analytics";
import { clearPrivateMediaCache, configurePrivateMediaCache } from "../../../src/lib/privateMediaCache";
import { assignBrowserLocation } from "../browserNavigation";
import { SessionTransport, sessionSubject, type SessionStorage } from "../../../src/lib/api/transport";
export type { ApiRequestOptions, HttpMethod } from "../../../src/lib/api/transport";

function readBrowserSession() {
    if (typeof window === "undefined") return null;
    const accessToken = window.localStorage.getItem("accessToken") ?? "";
    const refreshToken = window.localStorage.getItem("refreshToken") ?? "";
    return accessToken || refreshToken ? { accessToken, refreshToken } : null;
}

const browserStorage: SessionStorage = {
  withLock: operation => withBrowserSessionLock("legacy", operation),
  subscribe(listener) {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || (event.key !== null && !["accessToken", "refreshToken"].includes(event.key))) return;
      const next = readBrowserSession();
      // The access-token event carries the actual prior identity, including after a local sign-in.
      if (event.key === "refreshToken") return;
      const subject = sessionSubject(event.oldValue ? { accessToken: event.oldValue, refreshToken: "" } : null);
      listener(next, !next || !subject || subject !== sessionSubject(next));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
  async read() { return readBrowserSession(); },
  async write(tokens) {
    if (typeof window === "undefined") return;
    if (tokens) {
      window.localStorage.setItem("accessToken", tokens.accessToken);
      window.localStorage.setItem("refreshToken", tokens.refreshToken);
    } else {
      window.localStorage.removeItem("accessToken");
      window.localStorage.removeItem("refreshToken");
    }
  },
};

export class ApiClient extends SessionTransport {
  constructor(baseUrl: string = env.apiBaseUrl) {
    super(baseUrl, browserStorage, tokens => {
      if (tokens) void configurePrivateMediaCache(tokens.accessToken);
      else {
        void clearPrivateMediaCache();
        resetAnalytics();
        assignBrowserLocation("/");
      }
    });
  }
  async refreshMediaAuthCookie(): Promise<void> {
    if (!await browserStorage.read()) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try { await this.post<void>("/v1/auth/media", undefined, { signal: controller.signal }); }
    catch { /* Normal API auth handles invalid sessions; media sync must not block boot. */ }
    finally { clearTimeout(timeout); }
  }
}
export const apiClient = new ApiClient();
apiClient.observeExternalSession();
