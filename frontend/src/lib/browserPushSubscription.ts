import type { SessionTransport } from "./api/transport";

export type NotificationPermissionResult = NotificationPermission | "unsupported" | "missing-key";
export type PushStatus = { permission: NotificationPermission | "unsupported"; subscribed: boolean };

/** Shared browser subscription lifecycle; React adapters own query/mutation state. */
export function createBrowserPushSubscription(apiClient: Pick<SessionTransport, "post">, publicKey?: string, onChange?: (enabled: boolean) => void) {
  const getRegistration = (async () => {
    if (!("serviceWorker" in navigator)) return null;
    return navigator.serviceWorker.getRegistration();
  });

  const getStatus = (async (): Promise<PushStatus> => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      return { permission: "unsupported", subscribed: false };
    }

    const registration = await getRegistration();
    if (!registration) {
      return { permission: Notification.permission, subscribed: false };
    }
    const subscription = await registration.pushManager.getSubscription();
    return { permission: Notification.permission, subscribed: Boolean(subscription) };
  });

  const saveSubscription = (
    async (subscription: PushSubscription) => {
      const endpoint = subscription.endpoint;
      const p256dh = encodeKey(subscription.getKey("p256dh"));
      const auth = encodeKey(subscription.getKey("auth"));

      if (!p256dh || !auth) {
        throw new Error("Invalid subscription keys");
      }

      await apiClient.post("/v2/push-subscriptions", { endpoint, p256dh, auth });
      onChange?.(true);
    }
  );

  const unsubscribe = (async () => {
    const registration = await getRegistration();
    if (!registration) {
      await apiClient.post("/v2/push-subscriptions/unsubscribe");
      return;
    }
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await apiClient.post("/v2/push-subscriptions/unsubscribe", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    } else {
      await apiClient.post("/v2/push-subscriptions/unsubscribe");
    }
    onChange?.(false);
  });

  const ensureServiceWorkerRegistration = (async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service workers are not supported");
    }

    const registration = await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;
    return registration;
  });

  const subscribeAndSave = (async () => {

    if (!publicKey) throw new Error("Missing push notification key");
    const registration = await ensureServiceWorkerRegistration();
    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription =
      existingSubscription ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    await saveSubscription(subscription);
  });

  const reconcileSubscription = (async (): Promise<NotificationPermissionResult> => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
    if (!hasUsableVapidKey(publicKey)) return "missing-key";
    if (Notification.permission !== "granted") return Notification.permission;

    await subscribeAndSave();
    return "granted";
  });

  const requestPermissionAndSubscribe = (async (): Promise<NotificationPermissionResult> => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
    if (!hasUsableVapidKey(publicKey)) return "missing-key";

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return permission;

    await subscribeAndSave();
    return permission;
  });

  return {
    requestPermissionAndSubscribe,
    reconcileSubscription,
    ensureServiceWorkerRegistration,
    getStatus,
    unsubscribe,
  };
}

function hasUsableVapidKey(publicKey: string | undefined) {
  return Boolean(
    publicKey &&
    !publicKey.includes("%") &&
    !publicKey.toLowerCase().includes("vapid_public_key"),
  );
}

function encodeKey(key: ArrayBuffer | null): string | null {
  if (!key) return null;
  return btoa(String.fromCharCode(...new Uint8Array(key)));
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray as Uint8Array<ArrayBuffer>;
}
