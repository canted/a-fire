import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { vi } from "vitest";

type ServiceWorkerListener = (event: {
  data?: { text: () => string };
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;

function loadServiceWorker(badgeMethods: Record<string, unknown>) {
  const listeners = new Map<string, ServiceWorkerListener[]>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const consoleError = vi.fn();
  const self = {
    navigator: {},
    registration: {
      ...badgeMethods,
      showNotification,
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
    indexedDB: {},
  });

  return { listeners, showNotification };
}

async function dispatchPush(listeners: Map<string, ServiceWorkerListener[]>, payload: Record<string, unknown>) {
  const promises: Array<Promise<unknown>> = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    promises.push(Promise.resolve(promise));
  });

  listeners.get("push")?.[0]?.({
    data: { text: () => JSON.stringify(payload) },
    waitUntil,
  });

  await Promise.all(promises);
  return waitUntil;
}

async function dispatchMessage(listeners: Map<string, ServiceWorkerListener[]>, payload: Record<string, unknown>) {
  const promises: Array<Promise<unknown>> = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    promises.push(Promise.resolve(promise));
  });

  listeners.get("message")?.[0]?.({
    data: payload as any,
    waitUntil,
  });

  await Promise.all(promises);
  return waitUntil;
}

describe("service worker app badge", () => {
  it.each([
    ["/app/entries/322", "/app/entries/322"],
    ["/app/rooms/2/chat#chat-92", "/app/rooms/2/chat#chat-92"],
    [undefined, "/app/notices"],
    ["https://other.test/app/entries/322", "/app/notices"],
    ["/auth/login", "/app/notices"],
  ])("retains the validated click destination for %s without bypassing activation recovery", async (url, expectedPath) => {
    const { listeners, showNotification } = loadServiceWorker({});
    await dispatchPush(listeners, { title: "A Fire", url, data: { event_id: "622" } });
    expect(showNotification).toHaveBeenCalledWith("A Fire", expect.objectContaining({
      data: { url: expectedPath, eventId: "622" },
    }));
    expect(showNotification.mock.calls[0][1]).not.toHaveProperty("navigate");
  });

  it("sets the app badge from push badgeCount payloads", async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const { listeners, showNotification } = loadServiceWorker({ setAppBadge });

    await dispatchPush(listeners, { title: "New reply", badgeCount: 5 });

    expect(showNotification).toHaveBeenCalled();
    expect(setAppBadge).toHaveBeenCalledWith(5);
  });

  it("shows each push as a distinct alert that can notify again", async () => {
    const { listeners, showNotification } = loadServiceWorker({});

    await dispatchPush(listeners, {
      title: "Ember posted in Proto",
      badgeCount: 1,
      data: { event_id: "523" },
    });

    expect(showNotification).toHaveBeenCalledWith(
      "Ember posted in Proto",
      expect.objectContaining({
        tag: "a-fire-notification-523",
        renotify: true,
      }),
    );
  });

  it("clears the app badge when the push badgeCount is zero", async () => {
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const { listeners } = loadServiceWorker({ clearAppBadge, setAppBadge });

    await dispatchPush(listeners, { title: "All read", badgeCount: 0 });

    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it("updates the app badge from client messages", async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    const { listeners } = loadServiceWorker({ setAppBadge, clearAppBadge });

    await dispatchMessage(listeners, { type: "AFIRE_APP_BADGE_COUNT", count: 0 });
    expect(clearAppBadge).toHaveBeenCalled();

    await dispatchMessage(listeners, { type: "AFIRE_APP_BADGE_COUNT", count: 8 });
    expect(setAppBadge).toHaveBeenCalledWith(8);
  });
});
