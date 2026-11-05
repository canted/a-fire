import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HealthService, resolveHealthDbTimeoutMs } from "@server/api/v1/health/health.service"

const prismaOk = {
  $queryRaw: vi.fn().mockResolvedValue(1),
}

const prismaFail = {
  $queryRaw: vi.fn().mockRejectedValue(new Error("db down")),
}

describe("HealthService", () => {
  beforeEach(() => {
    for (const key of ["VITE_VAPID_PUBLIC_KEY", "VITE_VAPID_PRIVATE_KEY", "VITE_VAPID_SUBJECT", "VAPID_SUBJECT", "BREVO_SENDER", "HEALTH_DB_TIMEOUT_MS"]) {
      vi.stubEnv(key, undefined)
    }
    vi.stubEnv("VAPID_PUBLIC_KEY", "test-public")
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private")
    vi.stubEnv("VAPID_SUBJECT", "mailto:health@example.com")
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("returns liveness without querying the db", () => {
    const service = new HealthService()
    ;(service as any).prisma = prismaOk
    const result = service.live()
    expect(result).toEqual({ status: "ok" })
    expect(prismaOk.$queryRaw).not.toHaveBeenCalled()
  })

  it("returns ok when the db responds", async () => {
    const service = new HealthService()
    ;(service as any).prisma = prismaOk
    const result = await service.check()
    expect(result).toEqual({ status: "ok", db: "ok", vapid: "ok" })
  })

  it("reports missing VAPID configuration independently of database readiness", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", undefined)
    const service = new HealthService()
    ;(service as any).prisma = prismaOk
    await expect(service.check()).resolves.toEqual({ status: "ok", db: "ok", vapid: "missing" })
  })

  it("returns degraded when the db errors", async () => {
    const service = new HealthService()
    ;(service as any).prisma = prismaFail
    const result = await service.check()
    expect(result).toEqual({ status: "degraded", db: "error", vapid: "ok" })
  })

  it("returns degraded when the db check stalls", async () => {
    vi.stubEnv("HEALTH_DB_TIMEOUT_MS", "25")
    vi.useFakeTimers()
    const service = new HealthService()
    ;(service as any).prisma = { $queryRaw: vi.fn(() => new Promise(() => {})) }

    const resultPromise = service.check()
    await vi.advanceTimersByTimeAsync(25)

    await expect(resultPromise).resolves.toEqual({ status: "degraded", db: "error", vapid: "ok" })
  })

  it("uses the default timeout for invalid env values", () => {
    vi.stubEnv("HEALTH_DB_TIMEOUT_MS", "nope")
    expect(resolveHealthDbTimeoutMs()).toBe(1_000)
  })
})
