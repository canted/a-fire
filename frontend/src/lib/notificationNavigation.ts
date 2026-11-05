type Navigate = (target: string) => unknown;

type NotificationNavigationMessage = {
  type?: unknown;
  activationId?: unknown;
  createdAt?: unknown;
  url?: unknown;
};

export type NotificationNavigationOutcome = "route_reached" | "target_found" | "target_missing";

export type NotificationNavigationDiagnostic = {
  activationId: string | null;
  stage: "received" | "navigation_started" | "destination_reached" | NotificationNavigationOutcome;
  destination: string;
  currentLocation: string;
  durationMs: number | null;
};

type NotificationNavigationOptions = {
  onDiagnostic?: (diagnostic: NotificationNavigationDiagnostic) => void;
  targetWaitTimeoutMs?: number;
};

type NavigationServiceWorkerMessage =
  | { type: "AFIRE_NOTIFICATION_NAVIGATION_READY" }
  | {
      type: "AFIRE_NOTIFICATION_NAVIGATED";
      activationId?: string;
      outcome: NotificationNavigationOutcome;
      url: string;
    };

const DEFAULT_TARGET_WAIT_TIMEOUT_MS = 15_000;

export function registerNotificationNavigation(
  navigate: Navigate,
  options: NotificationNavigationOptions = {},
): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => undefined;
  }

  const pendingTargetWaits = new Map<string, () => void>();
  const readyRetries = new Set<number>();
  let disposed = false;
  let navigationStarted: string | null = null;
  const clearReadyRetries = () => {
    readyRetries.forEach((timer) => window.clearTimeout(timer));
    readyRetries.clear();
  };
  const targetWaitTimeoutMs = options.targetWaitTimeoutMs ?? DEFAULT_TARGET_WAIT_TIMEOUT_MS;
  const currentLocation = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const report = (
    stage: NotificationNavigationDiagnostic["stage"],
    activationId: string | null,
    destination: string,
    createdAt: number | null,
  ) => {
    try {
      options.onDiagnostic?.({
        activationId,
        stage,
        destination,
        currentLocation: currentLocation(),
        durationMs: createdAt === null ? null : Math.max(0, Date.now() - createdAt),
      });
    } catch {
      // Diagnostics must never prevent a notification from opening.
    }
  };
  const acknowledgeNavigation = (
    source: MessageEventSource | null,
    activationId: string | null,
    url: string,
    outcome: NotificationNavigationOutcome,
  ) => {
    postMessageToWorker(source, {
      type: "AFIRE_NOTIFICATION_NAVIGATED",
      ...(activationId ? { activationId } : {}),
      outcome,
      url,
    });
  };

  const finishAtDestination = (
    event: MessageEvent<NotificationNavigationMessage>,
    activationId: string | null,
    notificationUrl: string,
    destination: string,
    target: URL,
    createdAt: number | null,
  ) => {
    report("destination_reached", activationId, destination, createdAt);
    const targetId = decodedHashTarget(target.hash);
    if (!targetId) {
      report("route_reached", activationId, destination, createdAt);
      acknowledgeNavigation(event.source, activationId, notificationUrl, "route_reached");
      return;
    }

    const waitKey = activationId ?? notificationUrl;
    if (pendingTargetWaits.has(waitKey)) return;
    const resolveTarget = (outcome: "target_found" | "target_missing") => {
      pendingTargetWaits.get(waitKey)?.();
      report(outcome, activationId, destination, createdAt);
      acknowledgeNavigation(event.source, activationId, notificationUrl, outcome);
    };
    if (document.getElementById(targetId)) {
      resolveTarget("target_found");
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.getElementById(targetId)) resolveTarget("target_found");
    });
    const timeout = window.setTimeout(() => resolveTarget("target_missing"), targetWaitTimeoutMs);
    const cleanup = () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      pendingTargetWaits.delete(waitKey);
    };
    pendingTargetWaits.set(waitKey, cleanup);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  const handleMessage = (event: MessageEvent<NotificationNavigationMessage>) => {
    if (event.data?.type !== "AFIRE_NOTIFICATION_NAVIGATE" || typeof event.data.url !== "string") return;

    const notificationUrl = event.data.url;
    const activationId = typeof event.data.activationId === "string" ? event.data.activationId : null;
    const createdAt = typeof event.data.createdAt === "number" ? event.data.createdAt : null;
    let target: URL;
    try { target = new URL(notificationUrl, window.location.origin); } catch { return; }
    if (target.origin !== window.location.origin) return;
    if (target.pathname !== "/app" && !target.pathname.startsWith("/app/")) return;
    clearReadyRetries();

    const destination = `${target.pathname}${target.search}${target.hash}`;
    report("received", activationId, destination, createdAt);
    if (currentLocation() !== destination) {
      const navigationKey = activationId ?? destination;
      if (navigationStarted === navigationKey) return;
      navigationStarted = navigationKey;
      report("navigation_started", activationId, destination, createdAt);
      void navigate(destination);
      return;
    }

    finishAtDestination(event, activationId, notificationUrl, destination, target, createdAt);
  };

  const sendReady = () => {
    if (disposed) return;
    // A live controller is usable even while getRegistration remains pending.
    const controller = navigator.serviceWorker.controller;
    postMessageToWorker(controller, { type: "AFIRE_NOTIFICATION_NAVIGATION_READY" });
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (disposed) return;
        const worker = registration?.active;
        if (worker !== controller) postMessageToWorker(worker, { type: "AFIRE_NOTIFICATION_NAVIGATION_READY" });
      })
      .catch(() => undefined);
  };
  const requestPendingNavigation = () => {
    clearReadyRetries();
    sendReady();
    // A cold worker can miss the first message while the app is starting.
    for (const delay of [250, 1000, 3000]) {
      readyRetries.add(window.setTimeout(sendReady, delay));
    }
  };
  const requestWhenVisible = () => {
    if (document.visibilityState === "visible") requestPendingNavigation();
  };

  navigator.serviceWorker.addEventListener("message", handleMessage);
  navigator.serviceWorker.addEventListener("controllerchange", requestPendingNavigation);
  document.addEventListener("visibilitychange", requestWhenVisible);
  window.addEventListener("pageshow", requestPendingNavigation);
  window.addEventListener("focus", requestPendingNavigation);
  requestPendingNavigation();
  return () => {
    disposed = true;
    clearReadyRetries();
    pendingTargetWaits.forEach((cleanup) => cleanup());
    pendingTargetWaits.clear();
    navigator.serviceWorker.removeEventListener("message", handleMessage);
    navigator.serviceWorker.removeEventListener("controllerchange", requestPendingNavigation);
    document.removeEventListener("visibilitychange", requestWhenVisible);
    window.removeEventListener("pageshow", requestPendingNavigation);
    window.removeEventListener("focus", requestPendingNavigation);
  };
}

function decodedHashTarget(hash: string): string | null {
  if (!hash) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

function postMessageToWorker(
  worker: MessageEventSource | ServiceWorker | null | undefined,
  message: NavigationServiceWorkerMessage,
) {
  if (!worker || !("postMessage" in worker)) return;
  worker.postMessage(message);
}
