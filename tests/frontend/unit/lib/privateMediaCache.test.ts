import { vi } from "vitest";
import { clearPrivateMediaCache, configurePrivateMediaCache, registerPrivateMediaCache } from "../../../../frontend/src/lib/privateMediaCache";

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

describe("privateMediaCache", () => {
  const postMessage = vi.fn();
  const cacheDelete = vi.fn();

  beforeEach(() => {
    postMessage.mockReset();
    cacheDelete.mockReset();
    const serviceWorker = {
      controller: null,
      register: vi.fn(async () => ({ active: { postMessage } })),
      ready: Promise.resolve({ active: { postMessage } }),
      addEventListener: vi.fn(),
      getRegistration: vi.fn(async () => ({ active: { postMessage } })),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: {
        keys: vi.fn(async () => ["image-cache-v2-private-old", "other-cache"]),
        delete: cacheDelete,
      },
    });
    window.localStorage.clear();
  });

  it("posts a user-scoped cache context from the access token", async () => {
    await configurePrivateMediaCache(jwt({ sub: "42", jti: "session-9", exp: 123 }));

    expect(postMessage).toHaveBeenCalledWith({
      type: "AFIRE_MEDIA_CACHE_CONTEXT",
      userId: "42",
    });
  });

  it("clears image caches and notifies the worker on auth clear", async () => {
    await clearPrivateMediaCache();

    expect(cacheDelete).toHaveBeenCalledWith("image-cache-v2-private-old");
    expect(cacheDelete).not.toHaveBeenCalledWith("other-cache");
    expect(postMessage).toHaveBeenCalledWith({ type: "AFIRE_CLEAR_MEDIA_CACHES" });
  });

  it("reconfigures the private cache when a replacement worker takes control", async () => {
    window.localStorage.setItem("accessToken", jwt({ sub: "42" }));

    await registerPrivateMediaCache();

    const addEventListener = vi.mocked(navigator.serviceWorker.addEventListener);
    expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));
    const listener = addEventListener.mock.calls[0]?.[1] as EventListener;
    postMessage.mockClear();

    listener(new Event("controllerchange"));

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({
        type: "AFIRE_MEDIA_CACHE_CONTEXT",
        userId: "42",
      });
    });
  });
});
