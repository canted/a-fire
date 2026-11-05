type MediaCacheMessage =
  | { type: "AFIRE_MEDIA_CACHE_CONTEXT"; userId: string }
  | { type: "AFIRE_CLEAR_MEDIA_CACHES" }

type JwtPayload = {
  sub?: string
}

const watchedServiceWorkerContainers = new WeakSet<object>()

export async function registerPrivateMediaCache(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return

  try {
    watchForServiceWorkerReplacement()
    const registration = await navigator.serviceWorker.register("/service-worker.js")
    if (navigator.serviceWorker.controller || registration.active) {
      await configurePrivateMediaCache()
      return
    }

    void navigator.serviceWorker.ready.then(() => configurePrivateMediaCache()).catch(() => undefined)
  } catch {
    // Media caching is an optimization; rendering must not depend on it.
  }
}

function watchForServiceWorkerReplacement(): void {
  const container = navigator.serviceWorker
  if (watchedServiceWorkerContainers.has(container)) return
  watchedServiceWorkerContainers.add(container)
  container.addEventListener("controllerchange", () => {
    void configurePrivateMediaCache()
  })
}

export async function configurePrivateMediaCache(accessToken?: string | null): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return

  const token = accessToken ?? (typeof window !== "undefined" ? window.localStorage.getItem("accessToken") : null)
  const payload = token ? decodeJwtPayload(token) : null
  if (!payload?.sub) {
    await clearPrivateMediaCache()
    return
  }

  await postServiceWorkerMessage({
    type: "AFIRE_MEDIA_CACHE_CONTEXT",
    userId: payload.sub,
  })
}

export async function clearPrivateMediaCache(): Promise<void> {
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const names = await window.caches.keys()
      await Promise.all(names.filter((name) => name.startsWith("image-cache-")).map((name) => window.caches.delete(name)))
    } catch { /* Still notify the worker if Cache Storage is unavailable. */ }
  }
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  await postServiceWorkerMessage({ type: "AFIRE_CLEAR_MEDIA_CACHES" })
}

async function postServiceWorkerMessage(message: MediaCacheMessage): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const worker = registration?.active ?? navigator.serviceWorker.controller
    worker?.postMessage(message)
  } catch { /* Media-cache housekeeping must not break login or logout. */ }
}

function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const decoded = atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "="))
    return JSON.parse(decoded) as JwtPayload
  } catch {
    return null
  }
}
