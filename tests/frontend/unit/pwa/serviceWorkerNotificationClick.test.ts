import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { vi } from "vitest";
import { registerNotificationNavigation } from "../../../../frontend/src/lib/notificationNavigation";

type ServiceWorkerListener = (event: {
  data?: Record<string, unknown>;
  source?: { postMessage?: (message: unknown) => void };
  notification?: { data?: { url?: string; eventId?: string }; close: () => void };
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;

function loadServiceWorker(clients: {
  matchAll: ReturnType<typeof vi.fn>;
  openWindow?: ReturnType<typeof vi.fn>;
}, indexedDB: object = {}) {
  const listeners = new Map<string, ServiceWorkerListener[]>();
  const consoleError = vi.fn();
  const self = {
    clients,
    registration: {
      showNotification: vi.fn(),
    },
    location: {
      origin: "https://fire.test",
    },
    addEventListener: (type: string, listener: ServiceWorkerListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };

  vm.runInNewContext(fs.readFileSync(path.resolve(process.cwd(), "public/service-worker.js"), "utf8"), {
    self,
    caches: {
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
      open: vi.fn(),
    },
    console: {
      error: consoleError,
    },
    URL,
    Headers,
    Response,
    fetch: vi.fn(),
    indexedDB,
    setTimeout,
    clearTimeout,
  });

  return { listeners, consoleError };
}

async function dispatchNotificationClick(
  listeners: Map<string, ServiceWorkerListener[]>,
  url?: string,
  eventId = "event-42",
) {
  const promises: Array<Promise<unknown>> = [];
  const close = vi.fn();
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    promises.push(Promise.resolve(promise));
  });

  listeners.get("notificationclick")?.[0]?.({
    notification: { data: url ? { url, eventId } : undefined, close },
    waitUntil,
  });

  return { close, promise: Promise.all(promises), waitUntil };
}

async function dispatchServiceWorkerMessage(
  listeners: Map<string, ServiceWorkerListener[]>,
  data: Record<string, unknown>,
  source: { postMessage: (message: unknown) => void },
) {
  const promises: Array<Promise<unknown>> = [];
  listeners.get("message")?.[0]?.({
    data,
    source,
    waitUntil: (promise) => promises.push(Promise.resolve(promise)),
  });
  await Promise.all(promises);
}

describe("service worker notification clicks", () => {
  it("still opens the destination when IndexedDB never responds", async () => {
    vi.useFakeTimers();
    try {
      const openWindow = vi.fn().mockResolvedValue(undefined);
      const { listeners } = loadServiceWorker({ matchAll: vi.fn().mockResolvedValue([]), openWindow }, {
        open: vi.fn(() => ({})),
      });
      const click = await dispatchNotificationClick(listeners, "/app/entries/318");
      await vi.advanceTimersByTimeAsync(5000);
      expect(openWindow).toHaveBeenCalledWith("/app/entries/318");
      await click.promise;
    } finally { vi.useRealTimers(); }
  });

  it("hands a cold-start window its destination even if openWindow resumes the old route", async () => {
    const client = { focus: vi.fn().mockResolvedValue(undefined), postMessage: vi.fn() };
    const { listeners } = loadServiceWorker({
      matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn().mockResolvedValue(client),
    });
    const click = await dispatchNotificationClick(listeners, "/app/entries/318");
    await click.promise;
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "AFIRE_NOTIFICATION_NAVIGATE", url: "/app/entries/318",
    }));
  });

  it("falls back when browser navigation never settles", async () => {
    vi.useFakeTimers();
    try {
      const client = { navigate: vi.fn(() => new Promise(() => {})), focus: vi.fn(), postMessage: vi.fn() };
      const openWindow = vi.fn().mockResolvedValue(undefined);
      const { listeners } = loadServiceWorker({ matchAll: vi.fn().mockResolvedValue([client]), openWindow });
      const click = await dispatchNotificationClick(listeners, "/app/entries/318");
      await vi.advanceTimersByTimeAsync(5000);
      expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ url: "/app/entries/318" }));
      expect(openWindow).toHaveBeenCalledWith("/app/entries/318");
      await click.promise;
    } finally { vi.useRealTimers(); }
  });

  it("delivers the destination before waiting for focus to settle", async () => {
    vi.useFakeTimers();
    try {
      const client = { navigate: vi.fn(), focus: vi.fn(() => new Promise(() => {})), postMessage: vi.fn() };
      client.navigate.mockResolvedValue(client);
      const { listeners } = loadServiceWorker({ matchAll: vi.fn().mockResolvedValue([client]), openWindow: vi.fn() });
      const click = await dispatchNotificationClick(listeners, "/app/entries/318");
      await vi.advanceTimersByTimeAsync(5000);
      expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ url: "/app/entries/318" }));
      await click.promise;
    } finally { vi.useRealTimers(); }
  });

  it("navigates an existing app window and hands the destination its durable activation", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    const postMessage = vi.fn();
    const windowClient = { focus, navigate, postMessage };
    navigate.mockResolvedValue(windowClient);
    const openWindow = vi.fn();
    const { listeners } = loadServiceWorker({
      matchAll: vi.fn().mockResolvedValue([windowClient]),
      openWindow,
    });

    const click = await dispatchNotificationClick(listeners, "/app/entries/42#reply-7");
    await click.promise;

    expect(click.close).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      type: "AFIRE_NOTIFICATION_NAVIGATE",
      activationId: expect.any(String),
      createdAt: expect.any(Number),
      url: "/app/entries/42#reply-7",
    });
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/app/entries/42#reply-7");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("navigates a resumed window even when its app message listener is unavailable", async () => {
    const client = {
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn(),
      postMessage: vi.fn(), // A suspended/old document drops the handoff.
    };
    client.navigate.mockResolvedValue(client);
    const openWindow = vi.fn();
    const { listeners } = loadServiceWorker({ matchAll: vi.fn().mockResolvedValue([client]), openWindow });
    const click = await dispatchNotificationClick(listeners, "/app/rooms/2/chat#chat-92");
    await click.promise;
    expect(client.navigate).toHaveBeenCalledWith("/app/rooms/2/chat#chat-92");
    expect(client.navigate.mock.invocationCallOrder[0]).toBeLessThan(client.focus.mock.invocationCallOrder[0]);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens the destination if browser navigation rejects", async () => {
    const client = {
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockRejectedValue(new Error("window unavailable")),
      postMessage: vi.fn(),
    };
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const { listeners } = loadServiceWorker({ matchAll: vi.fn().mockResolvedValue([client]), openWindow });
    const click = await dispatchNotificationClick(listeners, "/app/rooms/2/chat#chat-92");
    await click.promise;
    expect(openWindow).toHaveBeenCalledWith("/app/rooms/2/chat#chat-92");
  });

  it("opens the notification target when no app window exists", async () => {
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const { listeners } = loadServiceWorker({
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow,
    });

    const click = await dispatchNotificationClick(listeners, "/app/entries/42");
    await click.promise;

    expect(openWindow).toHaveBeenCalledWith("/app/entries/42");
  });

  it("opens the notification target when an existing app window cannot focus", async () => {
    const focus = vi.fn().mockRejectedValue(new Error("focus failed"));
    const openedClient = { focus: vi.fn().mockResolvedValue(undefined) };
    const openWindow = vi.fn().mockResolvedValue(openedClient);
    const { listeners } = loadServiceWorker({
      matchAll: vi.fn().mockResolvedValue([{ focus, postMessage: vi.fn() }]),
      openWindow,
    });

    const click = await dispatchNotificationClick(listeners, "/app/rooms/4/chat#chat-11");
    await click.promise;

    expect(openWindow).toHaveBeenCalledWith("/app/rooms/4/chat#chat-11");
    expect(openedClient.focus).toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("falls back to notices when a notification has no target URL", async () => {
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const { listeners } = loadServiceWorker({
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow,
    });

    const click = await dispatchNotificationClick(listeners);
    await click.promise;

    expect(openWindow).toHaveBeenCalledWith("/app/notices");
  });

  it("rejects a notification destination outside the app origin", async () => {
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const { listeners } = loadServiceWorker({
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow,
    });

    const click = await dispatchNotificationClick(listeners, "https://example.com/steal-session");
    await click.promise;

    expect(openWindow).toHaveBeenCalledWith("/app/notices");
  });

  it("redelivers a clicked destination until the app acknowledges it", async () => {
    const source = { postMessage: vi.fn() };
    const windowClient = {
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    };
    const { listeners } = loadServiceWorker({
      matchAll: vi.fn().mockResolvedValue([windowClient]),
      openWindow: vi.fn().mockResolvedValue(undefined),
    });

    const click = await dispatchNotificationClick(listeners, "/app/rooms/4/chat#chat-19");
    await click.promise;
    await dispatchServiceWorkerMessage(
      listeners,
      { type: "AFIRE_NOTIFICATION_NAVIGATION_READY" },
      source,
    );

    const activationMessage = expect.objectContaining({
      type: "AFIRE_NOTIFICATION_NAVIGATE",
      activationId: expect.any(String),
      createdAt: expect.any(Number),
      url: "/app/rooms/4/chat#chat-19",
    });
    expect(source.postMessage).toHaveBeenCalledWith(activationMessage);
    const activationId = (source.postMessage.mock.calls.at(-1)?.[0] as { activationId: string }).activationId;

    await dispatchServiceWorkerMessage(
      listeners,
      { type: "AFIRE_NOTIFICATION_NAVIGATED", activationId: "stale-activation", url: "/app/rooms/4/chat#chat-19" },
      source,
    );
    source.postMessage.mockClear();
    await dispatchServiceWorkerMessage(listeners, { type: "AFIRE_NOTIFICATION_NAVIGATION_READY" }, source);
    expect(source.postMessage).toHaveBeenCalledWith(activationMessage);

    await dispatchServiceWorkerMessage(
      listeners,
      { type: "AFIRE_NOTIFICATION_NAVIGATED", activationId, url: "/app/rooms/4/chat#chat-19" },
      source,
    );
    source.postMessage.mockClear();
    await dispatchServiceWorkerMessage(
      listeners,
      { type: "AFIRE_NOTIFICATION_NAVIGATION_READY" },
      source,
    );

    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it("keeps a click pending across app startup until the reloaded document reaches its target", async () => {
    let appMessageListener: ((event: MessageEvent) => void) | null = null;
    const focus = vi.fn().mockResolvedValue(undefined);
    const appClient = {
      focus,
      postMessage: (message: unknown) => {
        const event = new MessageEvent("message", { data: message });
        Object.defineProperty(event, "source", { value: activeWorker });
        appMessageListener?.(event);
      },
    };
    const { listeners } = loadServiceWorker({
      matchAll: vi.fn().mockResolvedValue([appClient]),
      openWindow: vi.fn(),
    });
    const workerSource = {
      postMessage: vi.fn((message: unknown) => {
        const event = new MessageEvent("message", { data: message });
        Object.defineProperty(event, "source", { value: activeWorker });
        appMessageListener?.(event);
      }),
    };
    const activeWorker = {
      postMessage: vi.fn((message: Record<string, unknown>) =>
        dispatchServiceWorkerMessage(listeners, message, workerSource)),
    };
    const addEventListener = vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (type === "message") appMessageListener = listener;
    });
    const removeEventListener = vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (type === "message" && appMessageListener === listener) appMessageListener = null;
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener,
        removeEventListener,
        getRegistration: vi.fn().mockResolvedValue({ active: activeWorker }),
        controller: activeWorker,
      },
    });

    window.history.replaceState(null, "", "/app/projects/9");
    const navigate = vi.fn();
    const unregisterBeforeReload = registerNotificationNavigation(navigate);
    const click = await dispatchNotificationClick(listeners, "/app/rooms/4/chat#chat-19", "event-19");
    await click.promise;

    expect(navigate).toHaveBeenCalledWith("/app/rooms/4/chat#chat-19");
    expect(workerSource.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "AFIRE_NOTIFICATION_NAVIGATED" }),
    );

    unregisterBeforeReload();
    window.history.replaceState(null, "", "/app/rooms/4/chat#chat-19");
    const target = document.createElement("article");
    target.id = "chat-19";
    document.body.appendChild(target);
    workerSource.postMessage.mockClear();
    activeWorker.postMessage.mockClear();
    const unregisterAfterReload = registerNotificationNavigation(vi.fn());

    await vi.waitFor(() => {
      expect(activeWorker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "AFIRE_NOTIFICATION_NAVIGATED",
          activationId: expect.any(String),
          url: "/app/rooms/4/chat#chat-19",
        }),
      );
    });

    workerSource.postMessage.mockClear();
    await dispatchServiceWorkerMessage(listeners, { type: "AFIRE_NOTIFICATION_NAVIGATION_READY" }, workerSource);
    expect(workerSource.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "AFIRE_NOTIFICATION_NAVIGATE" }),
    );
    unregisterAfterReload();
    target.remove();
  });
});
