import { vi } from "vitest";
import { registerNotificationNavigation } from "../../../../frontend/src/lib/notificationNavigation";

describe("notificationNavigation", () => {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const workerPostMessage = vi.fn();
  const getRegistration = vi.fn();

  beforeEach(() => {
    addEventListener.mockReset();
    removeEventListener.mockReset();
    workerPostMessage.mockReset();
    getRegistration.mockReset();
    getRegistration.mockResolvedValue({ active: { postMessage: workerPostMessage } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { addEventListener, removeEventListener, getRegistration, controller: null },
    });
  });

  it("navigates the document without acknowledging before it reaches the target", () => {
    const navigate = vi.fn();
    window.history.replaceState(null, "", "/app/projects/9");
    const unregister = registerNotificationNavigation(navigate);
    const listener = addEventListener.mock.calls[0][1] as (event: MessageEvent) => void;

    listener({
      data: {
        type: "AFIRE_NOTIFICATION_NAVIGATE",
        activationId: "activation-17",
        createdAt: 100,
        url: "/app/rooms/4/chat#chat-17",
      },
      source: { postMessage: workerPostMessage },
    } as unknown as MessageEvent);

    expect(navigate).toHaveBeenCalledWith("/app/rooms/4/chat#chat-17");
    expect(workerPostMessage).not.toHaveBeenCalledWith({
      type: "AFIRE_NOTIFICATION_NAVIGATED",
      activationId: "activation-17",
      url: "/app/rooms/4/chat#chat-17",
    });

    unregister();
    expect(removeEventListener).toHaveBeenCalledWith("message", listener);
    expect(removeEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));
  });

  it("waits for a fragment target before acknowledging that the destination resolved", async () => {
    const navigate = vi.fn();
    window.history.replaceState(null, "", "/app/rooms/4/chat#chat-17");
    registerNotificationNavigation(navigate);
    const listener = addEventListener.mock.calls[0][1] as (event: MessageEvent) => void;

    listener({
      data: {
        type: "AFIRE_NOTIFICATION_NAVIGATE",
        activationId: "activation-17",
        createdAt: Date.now() - 25,
        url: "/app/rooms/4/chat#chat-17",
      },
      source: { postMessage: workerPostMessage },
    } as unknown as MessageEvent);

    expect(navigate).not.toHaveBeenCalled();
    expect(workerPostMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "AFIRE_NOTIFICATION_NAVIGATED" }),
    );

    const target = document.createElement("article");
    target.id = "chat-17";
    document.body.appendChild(target);

    await vi.waitFor(() => {
      expect(workerPostMessage).toHaveBeenCalledWith({
        type: "AFIRE_NOTIFICATION_NAVIGATED",
        activationId: "activation-17",
        outcome: "target_found",
        url: "/app/rooms/4/chat#chat-17",
      });
    });
    target.remove();
  });

  it("acknowledges a route without a fragment as soon as the document arrives", () => {
    window.history.replaceState(null, "", "/app/notices");
    registerNotificationNavigation(vi.fn());
    const listener = addEventListener.mock.calls[0][1] as (event: MessageEvent) => void;

    listener({
      data: {
        type: "AFIRE_NOTIFICATION_NAVIGATE",
        activationId: "activation-notices",
        createdAt: 100,
        url: "/app/notices",
      },
      source: { postMessage: workerPostMessage },
    } as unknown as MessageEvent);

    expect(workerPostMessage).toHaveBeenCalledWith({
      type: "AFIRE_NOTIFICATION_NAVIGATED",
      activationId: "activation-notices",
      outcome: "route_reached",
      url: "/app/notices",
    });
  });

  it("reports the activation lifecycle without including notification content", () => {
    const onDiagnostic = vi.fn();
    window.history.replaceState(null, "", "/app/notices");
    registerNotificationNavigation(vi.fn(), { onDiagnostic });
    const listener = addEventListener.mock.calls[0][1] as (event: MessageEvent) => void;

    listener({
      data: {
        type: "AFIRE_NOTIFICATION_NAVIGATE",
        activationId: "activation-diagnostic",
        createdAt: Date.now() - 50,
        url: "/app/notices",
      },
      source: { postMessage: workerPostMessage },
    } as unknown as MessageEvent);

    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      activationId: "activation-diagnostic",
      stage: "received",
      destination: "/app/notices",
      currentLocation: "/app/notices",
      durationMs: expect.any(Number),
    }));
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ stage: "route_reached" }));
  });

  it("clears an unresolved fragment with a diagnostic outcome instead of retrying forever", async () => {
    window.history.replaceState(null, "", "/app/entries/42#reply-missing");
    registerNotificationNavigation(vi.fn(), { targetWaitTimeoutMs: 0 });
    const listener = addEventListener.mock.calls[0][1] as (event: MessageEvent) => void;

    listener({
      data: {
        type: "AFIRE_NOTIFICATION_NAVIGATE",
        activationId: "activation-missing",
        createdAt: 100,
        url: "/app/entries/42#reply-missing",
      },
      source: { postMessage: workerPostMessage },
    } as unknown as MessageEvent);

    await vi.waitFor(() => {
      expect(workerPostMessage).toHaveBeenCalledWith({
        type: "AFIRE_NOTIFICATION_NAVIGATED",
        activationId: "activation-missing",
        outcome: "target_missing",
        url: "/app/entries/42#reply-missing",
      });
    });
  });

  it("ignores navigation targets from another origin", () => {
    const navigate = vi.fn();
    registerNotificationNavigation(navigate);
    const listener = addEventListener.mock.calls[0][1] as (event: MessageEvent) => void;

    listener(new MessageEvent("message", {
      data: {
        type: "AFIRE_NOTIFICATION_NAVIGATE",
        url: "https://example.com/app/rooms/4/chat#chat-17",
      },
    }));

    expect(navigate).not.toHaveBeenCalled();
  });

  it("asks the active service worker for a pending destination", async () => {
    registerNotificationNavigation(vi.fn());

    await vi.waitFor(() => {
      expect(workerPostMessage).toHaveBeenCalledWith({ type: "AFIRE_NOTIFICATION_NAVIGATION_READY" });
    });
  });

  it("contacts the controller immediately even if registration lookup hangs", () => {
    getRegistration.mockReturnValue(new Promise(() => {}));
    Object.defineProperty(navigator.serviceWorker, "controller", { value: { postMessage: workerPostMessage } });
    const unregister = registerNotificationNavigation(vi.fn());
    expect(workerPostMessage).toHaveBeenCalledWith({ type: "AFIRE_NOTIFICATION_NAVIGATION_READY" });
    unregister();
  });

  it("retries the handoff when a starting worker drops its first READY message", async () => {
    vi.useFakeTimers();
    const unregister = registerNotificationNavigation(vi.fn());
    try {
      await vi.advanceTimersByTimeAsync(1);
      workerPostMessage.mockClear();
      await vi.advanceTimersByTimeAsync(3000);
      expect(workerPostMessage).toHaveBeenCalledWith({ type: "AFIRE_NOTIFICATION_NAVIGATION_READY" });
      unregister();
      workerPostMessage.mockClear();
      await vi.advanceTimersByTimeAsync(10000);
      expect(workerPostMessage).not.toHaveBeenCalled();
    } finally { unregister(); vi.useRealTimers(); }
  });

  it("asks again when the app resumes", async () => {
    const unregister = registerNotificationNavigation(vi.fn());
    await vi.waitFor(() => expect(workerPostMessage).toHaveBeenCalled());
    workerPostMessage.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => {
      expect(workerPostMessage).toHaveBeenCalledWith({ type: "AFIRE_NOTIFICATION_NAVIGATION_READY" });
    });
    unregister();
  });
});
