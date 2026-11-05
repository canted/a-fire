import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { vi } from "vitest"

type ServiceWorkerListener = (event: {
  data?: unknown
  request?: { method: string; destination: string; url: string }
  waitUntil?: (promise: Promise<unknown>) => void
  respondWith?: (promise: Promise<Response>) => void
}) => void

function createIndexedDb() {
  const values = new Map<string, unknown>()
  const store = {
    get: (key: string) => {
      const request: Record<string, unknown> = {}
      queueMicrotask(() => {
        request.result = values.get(key)
        ;(request.onsuccess as (() => void) | undefined)?.()
      })
      return request
    },
    put: (value: { key: string }) => {
      const request: Record<string, unknown> = {}
      queueMicrotask(() => {
        values.set(value.key, value)
        ;(request.onsuccess as (() => void) | undefined)?.()
      })
      return request
    },
    delete: (key: string) => {
      const request: Record<string, unknown> = {}
      queueMicrotask(() => {
        values.delete(key)
        ;(request.onsuccess as (() => void) | undefined)?.()
      })
      return request
    },
  }
  const db = {
    transaction: () => ({ objectStore: () => store }),
  }
  return {
    values,
    open: vi.fn(() => {
      const request: Record<string, unknown> = {}
      queueMicrotask(() => {
        ;(request.onsuccess as ((event: { target: { result: typeof db } }) => void) | undefined)?.({
          target: { result: db },
        })
      })
      return request
    }),
  }
}

function loadServiceWorker(
  cache: Cache,
  fetchMock: ReturnType<typeof vi.fn>,
  cacheNames: string[] = [],
  indexedDb = createIndexedDb(),
) {
  const listeners = new Map<string, ServiceWorkerListener[]>()
  const cacheDelete = vi.fn().mockResolvedValue(true)
  const cacheOpen = vi.fn().mockResolvedValue(cache)
  const self = {
    registration: {
      showNotification: vi.fn(),
    },
    location: {
      origin: "https://fire.test",
    },
    addEventListener: (type: string, listener: ServiceWorkerListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
  }

  vm.runInNewContext(fs.readFileSync(path.resolve(process.cwd(), "public/service-worker.js"), "utf8"), {
    self,
    caches: {
      keys: vi.fn().mockResolvedValue(cacheNames),
      delete: cacheDelete,
      open: cacheOpen,
    },
    console: {
      error: vi.fn(),
    },
    Date,
    URL,
    Headers,
    Response,
    fetch: fetchMock,
    indexedDB: indexedDb,
  })

  return { listeners, cacheDelete, cacheOpen, indexedDb }
}

async function dispatchMessage(listeners: Map<string, ServiceWorkerListener[]>, payload: Record<string, unknown>) {
  const promises: Array<Promise<unknown>> = []
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    promises.push(Promise.resolve(promise))
  })

  listeners.get("message")?.[0]?.({
    data: payload,
    waitUntil,
  })

  await Promise.all(promises)
}

function dispatchFetch(
  listeners: Map<string, ServiceWorkerListener[]>,
  request: { method: string; destination: string; url: string },
) {
  return dispatchFetchWithLifetime(listeners, request).responsePromise
}

function dispatchFetchWithLifetime(
  listeners: Map<string, ServiceWorkerListener[]>,
  request: { method: string; destination: string; url: string },
) {
  let responsePromise: Promise<Response> | undefined
  const lifetimePromises: Array<Promise<unknown>> = []
  listeners.get("fetch")?.[0]?.({
    request,
    waitUntil: (promise: Promise<unknown>) => {
      lifetimePromises.push(Promise.resolve(promise))
    },
    respondWith: (promise: Promise<Response>) => {
      responsePromise = promise
    },
  })
  return { responsePromise, lifetimePromises }
}

describe("service worker image cache policy", () => {
  const request = (path = "/icons/icon-192.png") => ({ method: "GET", destination: "image", url: `https://fire.test${path}` })
  const response = () => new Response("image", { headers: { "Content-Type": "image/png", "Content-Length": "5" } })
  const cache = () => ({ match: vi.fn(), delete: vi.fn(), put: vi.fn(), keys: vi.fn().mockResolvedValue([]) }) as unknown as Cache

  it.each(["/api/v1/uploads/140", "/api/v1/uploads/140/variants/w1200", "/api/v1/video-assets/2/poster", "/api/future/private-image", "/rails/active_storage/blobs/proxy/old/file.png"])("always revalidates %s without Cache Storage", async path => {
    const stored = cache()
    vi.mocked(stored.match).mockResolvedValue(response())
    const fetchMock = vi.fn().mockResolvedValue(response())
    const worker = loadServiceWorker(stored, fetchMock)
    await dispatchFetch(worker.listeners, request(path))
    expect(fetchMock).toHaveBeenCalledWith(request(path), { credentials: "include", cache: "no-cache" })
    expect(worker.cacheOpen).not.toHaveBeenCalled()
    expect(stored.put).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404])("returns authorization/deletion failures (%i), never stale private bytes", async status => {
    const stored = cache()
    vi.mocked(stored.match).mockResolvedValue(response())
    const network = new Response(null, { status })
    const worker = loadServiceWorker(stored, vi.fn().mockResolvedValue(network))
    expect(await dispatchFetch(worker.listeners, request("/api/v1/uploads/1"))).toBe(network)
    expect(stored.match).not.toHaveBeenCalled()
  })

  it("does not provide offline private images after account changes or worker restarts", async () => {
    const db = createIndexedDb()
    const first = loadServiceWorker(cache(), vi.fn(), ["image-cache-v2-private-7", "image-cache-v2-public", "image-cache-v3-public"], db)
    db.values.set("mediaCacheScope", { userId: 7 })
    await dispatchMessage(first.listeners, { type: "AFIRE_MEDIA_CACHE_CONTEXT", userId: 8 })
    expect(first.cacheDelete.mock.calls).toEqual([["image-cache-v2-private-7"], ["image-cache-v2-public"]])
    expect(db.values.has("mediaCacheScope")).toBe(false)
    const second = loadServiceWorker(cache(), vi.fn().mockRejectedValue(new Error("offline")), [], db)
    await expect(dispatchFetch(second.listeners, request("/api/v1/uploads/1"))).rejects.toThrow("offline")
    expect(second.cacheOpen).not.toHaveBeenCalled()
  })

  it.each(["open", "match", "delete"] as const)("falls through to network when cache %s fails", async operation => {
    const stored = cache()
    vi.mocked(stored.match).mockResolvedValue(new Response("expired"))
    const network = response()
    const worker = loadServiceWorker(stored, vi.fn().mockResolvedValue(network))
    if (operation === "open") worker.cacheOpen.mockRejectedValue(new Error("unavailable"))
    else vi.mocked(stored[operation]).mockRejectedValue(new Error("unavailable"))
    const pending = dispatchFetchWithLifetime(worker.listeners, request())
    expect(await pending.responsePromise).toBe(network)
    await Promise.all(pending.lifetimePromises)
  })

  it("reuses only fresh static public images", async () => {
    const stored = cache()
    const cached = response()
    cached.headers.set("sw-cache-time", String(Date.now()))
    vi.mocked(stored.match).mockResolvedValue(cached)
    const fetchMock = vi.fn()
    const worker = loadServiceWorker(stored, fetchMock)
    expect(await dispatchFetch(worker.listeners, request())).toBe(cached)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(worker.cacheOpen).toHaveBeenCalledWith("image-cache-v3-public")
  })

  it("bounds static caching to 64 entries and 512 KiB each", async () => {
    const stored = cache()
    vi.mocked(stored.keys).mockResolvedValue(Array.from({ length: 64 }, (_, i) => new Request(`https://fire.test/icons/${i}.png`)))
    const worker = loadServiceWorker(stored, vi.fn().mockResolvedValue(response()))
    const pending = dispatchFetchWithLifetime(worker.listeners, request())
    await pending.responsePromise
    await Promise.all(pending.lifetimePromises)
    expect(stored.delete).toHaveBeenCalledWith(expect.objectContaining({ url: "https://fire.test/icons/0.png" }))
    expect(stored.put).toHaveBeenCalledTimes(1)
  })

  it.each(["private", "no-store", "no-cache", "oversized", "underreported", "missing-length"])("does not store %s responses", async mode => {
    const stored = cache()
    const network = mode === "underreported" ? new Response(new Uint8Array(512 * 1024 + 1), { headers: { "Content-Type": "image/png", "Content-Length": "1" } }) : response()
    if (mode === "oversized") network.headers.set("Content-Length", String(512 * 1024 + 1))
    else if (mode === "missing-length") network.headers.delete("Content-Length")
    else if (mode !== "underreported") network.headers.set("Cache-Control", mode)
    const worker = loadServiceWorker(stored, vi.fn().mockResolvedValue(network))
    const pending = dispatchFetchWithLifetime(worker.listeners, request())
    expect(await pending.responsePromise).toBe(network)
    await Promise.all(pending.lifetimePromises)
    expect(stored.put).not.toHaveBeenCalled()
  })

  it("delivers network images without waiting for cache writes, including quota errors", async () => {
    let fail!: (error: Error) => void
    const stored = cache()
    vi.mocked(stored.put).mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    const network = response()
    const worker = loadServiceWorker(stored, vi.fn().mockResolvedValue(network))
    const pending = dispatchFetchWithLifetime(worker.listeners, request())
    expect(await pending.responsePromise).toBe(network)
    await vi.waitFor(() => expect(stored.put).toHaveBeenCalled())
    fail(new Error("quota exceeded"))
    await Promise.all(pending.lifetimePromises)
  })
})
