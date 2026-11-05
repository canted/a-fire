// In your service worker (public/service-worker.js)

// Browser APIs may stay pending while a Home Screen app is resuming.
// A stalled optional operation must not swallow a notification click.
function withDeadline(promise, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Notification operation timed out")), timeoutMs);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

// Helper functions to use IndexedDB for storing the last notification timestamp.
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("notificationDB", 1);
    request.onupgradeneeded = (event) => {
      event.target.result.createObjectStore("store", { keyPath: "key" });
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

function getLastNotificationTime() {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("store", "readonly");
      const store = tx.objectStore("store");
      const req = store.get("lastNotificationTime");
      req.onsuccess = () => resolve(req.result ? req.result.value : 0);
      req.onerror = () => reject(req.error);
    });
  });
}

function setLastNotificationTime(time) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("store", "readwrite");
      const store = tx.objectStore("store");
      const req = store.put({ key: "lastNotificationTime", value: time });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

function getStoredValue(key, fallback = null) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("store", "readonly");
      const store = tx.objectStore("store");
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  });
}

function setStoredValue(key, value, stillCurrent = () => true) {
  return openDB().then((db) => {
    // A delayed open must not persist a click that has already been acknowledged.
    if (!stillCurrent()) { db.close(); return; }
    return new Promise((resolve, reject) => {
      const tx = db.transaction("store", "readwrite");
      const store = tx.objectStore("store");
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

function deleteStoredValue(key, stillCurrent = () => true) {
  return openDB().then((db) => {
    if (!stillCurrent()) { db.close(); return; }
    return new Promise((resolve, reject) => {
      const tx = db.transaction("store", "readwrite");
      const store = tx.objectStore("store");
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

const IMAGE_CACHE_PREFIX = "image-cache-v3";
const PUBLIC_IMAGE_CACHE_NAME = `${IMAGE_CACHE_PREFIX}-public`;
const PUBLIC_IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Private media always revalidates through HTTP; never persist it in Cache Storage.
const PUBLIC_IMAGE_PATH_PATTERN = /^\/(?:icons\/|assets\/|frontend\/assets\/|site\/assets\/)/;
const PUBLIC_IMAGE_MAX_ENTRIES = 64;
const PUBLIC_IMAGE_MAX_BYTES = 512 * 1024;
const MEDIA_CACHE_SCOPE_KEY = "mediaCacheScope";
const PENDING_NOTIFICATION_ACTIVATION_KEY = "pendingNotificationActivation";
const LEGACY_PENDING_NOTIFICATION_NAVIGATION_KEY = "pendingNotificationNavigation";
const PENDING_NOTIFICATION_ACTIVATION_TTL_MS = 5 * 60 * 1000;

let publicCacheWrites = Promise.resolve();
let pendingNotificationActivation = null;
let notificationActivationSequence = 0;
let notificationActivationRevision = 0;

function createNotificationActivation(url, notificationData = {}) {
  notificationActivationSequence += 1;
  const createdAt = Date.now();
  const eventId = typeof notificationData.eventId === "string" ? notificationData.eventId : "unknown";
  return {
    id: `${eventId}:${createdAt}:${notificationActivationSequence}`,
    url,
    createdAt,
  };
}

async function storePendingNotificationActivation(url, notificationData) {
  const activation = createNotificationActivation(url, notificationData);
  pendingNotificationActivation = activation;
  notificationActivationRevision += 1;
  await withDeadline(Promise.all([
    setStoredValue(PENDING_NOTIFICATION_ACTIVATION_KEY, activation, () => pendingNotificationActivation?.id === activation.id),
    deleteStoredValue(LEGACY_PENDING_NOTIFICATION_NAVIGATION_KEY),
  ]), 1000).catch(() => undefined);
  return activation;
}

function normalizeNotificationActivation(value) {
  if (!value || typeof value.url !== "string" || typeof value.createdAt !== "number") return null;
  return {
    id: typeof value.id === "string" ? value.id : `legacy:${value.createdAt}:${value.url}`,
    url: value.url,
    createdAt: value.createdAt,
  };
}

async function readPendingNotificationActivation() {
  const revision = notificationActivationRevision;
  const stored =
    pendingNotificationActivation ??
    (await withDeadline(getStoredValue(PENDING_NOTIFICATION_ACTIVATION_KEY), 1000).catch(() => null)) ??
    (await withDeadline(getStoredValue(LEGACY_PENDING_NOTIFICATION_NAVIGATION_KEY), 1000).catch(() => null));
  // READY can begin reading before the click arrives. Never let that stale
  // read erase a new click (or resurrect one acknowledged during the read).
  if (revision !== notificationActivationRevision) return pendingNotificationActivation;
  const activation = normalizeNotificationActivation(stored);
  if (
    !activation ||
    Date.now() - activation.createdAt > PENDING_NOTIFICATION_ACTIVATION_TTL_MS
  ) {
    pendingNotificationActivation = null;
    const clearedRevision = ++notificationActivationRevision;
    await Promise.all([
      deleteStoredValue(PENDING_NOTIFICATION_ACTIVATION_KEY, () => notificationActivationRevision === clearedRevision).catch(() => undefined),
      deleteStoredValue(LEGACY_PENDING_NOTIFICATION_NAVIGATION_KEY, () => notificationActivationRevision === clearedRevision).catch(() => undefined),
    ]);
    return null;
  }

  pendingNotificationActivation = activation;
  return activation;
}

async function clearPendingNotificationActivation(id, url) {
  const pending = await readPendingNotificationActivation();
  if (!pending || pending.url !== url) return;
  if (typeof id === "string" && pending.id !== id) return;
  if (pendingNotificationActivation?.id !== pending.id) return;
  pendingNotificationActivation = null;
  const clearedRevision = ++notificationActivationRevision;
  await Promise.all([
    deleteStoredValue(PENDING_NOTIFICATION_ACTIVATION_KEY, () => notificationActivationRevision === clearedRevision).catch(() => undefined),
    deleteStoredValue(LEGACY_PENDING_NOTIFICATION_NAVIGATION_KEY, () => notificationActivationRevision === clearedRevision).catch(() => undefined),
  ]);
}

function notificationActivationMessage(activation) {
  return {
    type: "AFIRE_NOTIFICATION_NAVIGATE",
    activationId: activation.id,
    url: activation.url,
    createdAt: activation.createdAt,
  };
}

function safeNotificationTarget(value) {
  try {
    const target = new URL(typeof value === "string" ? value : "/app/notices", self.location.origin);
    if (target.origin !== self.location.origin) return "/app/notices";
    if (target.pathname !== "/app" && !target.pathname.startsWith("/app/")) return "/app/notices";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/app/notices";
  }
}

async function clearLegacyImageCaches() {
  try {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("image-cache-") && name !== PUBLIC_IMAGE_CACHE_NAME).map(name => caches.delete(name)));
  } catch { /* Cache Storage availability must never affect authorization or rendering. */ }
  await deleteStoredValue(MEDIA_CACHE_SCOPE_KEY).catch(() => undefined);
}

async function clearPrivateMediaCacheContext() {
  await clearLegacyImageCaches();
}

function normalizeBadgeCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

async function updateAppBadge(value) {
  const count = normalizeBadgeCount(value);
  if (count === null || !self.registration) return;

  try {
    if (count > 0) {
      if ("setAppBadge" in self.registration) {
        await self.registration.setAppBadge(count);
      }
      return;
    }

    if ("clearAppBadge" in self.registration) {
      await self.registration.clearAppBadge();
    } else if ("setAppBadge" in self.registration) {
      await self.registration.setAppBadge(0);
    }
  } catch (error) {
    console.error("Failed to update app badge:", error);
  }
}

self.addEventListener("push", (event) => {
  try {
    const data = JSON.parse(event.data.text());
    const title = data.title || "New post on A Fire";
    const body = data.body || title;
    const icon = "/icons/icon-192.png";
    const url = safeNotificationTarget(data.url);
    const eventId = typeof data.data?.event_id === "string" ? data.data.event_id : undefined;
    const tag = eventId ? `a-fire-notification-${eventId}` : `a-fire-notification-${Date.now()}`;

    event.waitUntil(
      self.registration.showNotification(title, {
        title,
        body,
        icon,
        tag,
        renotify: true,
        // Keep activation in notificationclick: browser-managed navigation can
        // focus an existing standalone window without changing its route, and
        // skips our persisted destination/retry handshake entirely.
        data: { url, eventId },
      }),
    );

    event.waitUntil(updateAppBadge(data.badgeCount));
  } catch (error) {
    console.error("Error parsing JSON:", error);
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "AFIRE_NOTIFICATION_NAVIGATION_READY") {
    const deliver = readPendingNotificationActivation().then((activation) => {
      if (!activation || !event.source || !("postMessage" in event.source)) return;
      event.source.postMessage(notificationActivationMessage(activation));
    });
    if (event.waitUntil) event.waitUntil(deliver);
    else void deliver;
    return;
  }

  if (data.type === "AFIRE_NOTIFICATION_NAVIGATED" && typeof data.url === "string") {
    const clear = clearPendingNotificationActivation(data.activationId, data.url);
    if (event.waitUntil) event.waitUntil(clear);
    else void clear;
    return;
  }

  if (data.type === "AFIRE_APP_BADGE_COUNT") {
    if (event.waitUntil) {
      event.waitUntil(updateAppBadge(data.count));
    } else {
      void updateAppBadge(data.count);
    }
    return;
  }

  if (data.type === "AFIRE_MEDIA_CACHE_CONTEXT" && data.userId) {
    const update = clearLegacyImageCaches();
    if (event.waitUntil) event.waitUntil(update);
    else void update;
    return;
  }

  if (data.type === "AFIRE_CLEAR_MEDIA_CACHES") {
    const clear = clearPrivateMediaCacheContext();
    if (event.waitUntil) event.waitUntil(clear);
    else void clear;
  }
});

async function readPublicImage(cache, request) {
  const response = await cache.match(request);
  if (!response) return null;
  const age = Date.now() - Number(response.headers.get("sw-cache-time") || 0);
  if (age >= 0 && age < PUBLIC_IMAGE_CACHE_TTL_MS) return response;
  await cache.delete(request);
  return null;
}

async function storePublicImage(cache, request, response) {
  const length = Number(response.headers.get("Content-Length"));
  if (!length || length > PUBLIC_IMAGE_MAX_BYTES || response.status !== 200 ||
      !response.headers.get("Content-Type")?.startsWith("image/") ||
      /private|no-store|no-cache/i.test(response.headers.get("Cache-Control") || "")) return;
  // Bound actual bytes too; do not trust Content-Length from a response intermediary.
  const reader = response.body?.getReader();
  if (!reader) return;
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > PUBLIC_IMAGE_MAX_BYTES) { void reader.cancel().catch(() => undefined); return; }
    chunks.push(value);
  }
  const headers = new Headers(response.headers);
  headers.set("sw-cache-time", String(Date.now()));
  // Fetch bodies are decoded; omit transport encoding headers when reconstructing.
  headers.delete("Content-Encoding");
  headers.set("Content-Length", String(bytes));
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  await cache.delete(request);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - PUBLIC_IMAGE_MAX_ENTRIES + 1))) await cache.delete(key);
  await cache.put(request, new Response(body, { headers }));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.destination !== "image") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (!PUBLIC_IMAGE_PATH_PATTERN.test(url.pathname)) {
    // Includes uploads, video posters, legacy media, and future authenticated routes.
    // no-cache also overrides previously stored five-year HTTP freshness.
    event.respondWith(fetch(request, { credentials: "include", cache: "no-cache" }));
    return;
  }

  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(PUBLIC_IMAGE_CACHE_NAME);
      const cached = await readPublicImage(cache, request);
      if (cached) return cached;
    } catch { /* Network delivery works when opening, reading, or deleting caches fails. */ }
    const response = await fetch(request);
    if (cache && response.ok) {
      const copy = response.clone();
      publicCacheWrites = publicCacheWrites.then(() => storePublicImage(cache, request, copy)).catch(() => undefined);
      event.waitUntil(publicCacheWrites);
    }
    return response;
  })());
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      clearLegacyImageCaches(),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  const notificationData = event.notification?.data || {};
  const targetUrl = safeNotificationTarget(notificationData.url);
  event.notification.close();

  event.waitUntil(
    storePendingNotificationActivation(targetUrl, notificationData)
      .then(async (activation) => {
        const clientList = await withDeadline(self.clients.matchAll({ type: "window", includeUncontrolled: true })).catch(() => []);
        const client =
          clientList.find((candidate) => candidate.visibilityState === "visible" && "focus" in candidate) ??
          clientList.find((candidate) => candidate.focused && "focus" in candidate) ??
          clientList.find((candidate) => "focus" in candidate);
        if (client) {
          try {
            // A suspended window may never handle an app-level message.
            // Let the browser navigate before focusing it, so a focus/READY
            // message cannot start a competing navigation in the old document.
            if ("navigate" in client) {
              const navigatedClient = await withDeadline(client.navigate(targetUrl));
              if (navigatedClient) {
                navigatedClient.postMessage(notificationActivationMessage(activation));
                await withDeadline(navigatedClient.focus());
                return;
              }
            } else if ("postMessage" in client) {
              client.postMessage(notificationActivationMessage(activation));
              await withDeadline(client.focus());
              return;
            }
          } catch (error) {
            // The document can still be alive when the browser's navigation or
            // focus promise stalls. Give its listener an independent way out.
            try { client.postMessage(notificationActivationMessage(activation)); } catch { /* Window closed. */ }
            console.error("notification navigation failed:", error);
          }
        }
        const openedClient = await self.clients.openWindow(targetUrl);
        if (openedClient) {
          // Some resumed windows retain their previous route despite openWindow.
          // READY replay covers a document whose listener has not mounted yet.
          if ("postMessage" in openedClient) openedClient.postMessage(notificationActivationMessage(activation));
          if ("focus" in openedClient) await withDeadline(openedClient.focus());
        }
      })
      .catch((err) => console.error("notificationclick failed:", err)),
  );
});

// function updateBadgeCount() {

// }

// function showNotification(count=1){
//   const title = 'New Posts';
//   const options = {
//     body: `You have ${count} unseen post${count > 1 ? 's' : ''}.`,
//     // icon: '/icon.png'
//   };

//   return self.registration.showNotification(title, options);
// }

// function sendToControllers(data){
//   self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
//     clients.forEach(client => {
//       client.postMessage({
//         type: 'NEW_POSTS',
//         count: data.count,
//         title,
//         options
//       });
//     });
//   });
// }
