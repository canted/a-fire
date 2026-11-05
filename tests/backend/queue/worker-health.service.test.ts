import { afterEach, expect, it, vi } from "vitest"
import { WorkerHealthService } from "@server/queue/worker-health.service"

afterEach(() => vi.useRealTimers())

it("waits for an in-flight renewal before removing the lease and never renews after stop", async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const transaction = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(pending)
  const remove = vi.fn().mockResolvedValue({ count: 1 })
  const service = new WorkerHealthService(); Object.assign(service, { prisma: { $transaction: transaction, queueWorkerHeartbeat: { deleteMany: remove } } })
  await service.start()
  await vi.advanceTimersByTimeAsync(20000)
  expect(transaction).toHaveBeenCalledTimes(2)
  const stopping = service.stop()
  expect(remove).not.toHaveBeenCalled()
  finish(); await stopping
  expect(remove).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(120000)
  expect(transaction).toHaveBeenCalledTimes(2)
})

it("does not schedule renewals after failed startup", async () => {
  vi.useFakeTimers()
  const transaction = vi.fn().mockRejectedValue(new Error("database unavailable"))
  const service = new WorkerHealthService(); Object.assign(service, { prisma: { $transaction: transaction } })
  await expect(service.start()).rejects.toThrow("database unavailable")
  await vi.advanceTimersByTimeAsync(120000)
  expect(transaction).toHaveBeenCalledOnce()
  await service.stop()
})

it("bounds failed and stalled readiness reads without exposing driver errors", async () => {
  vi.useFakeTimers()
  const service = new WorkerHealthService(); const query = vi.fn().mockRejectedValueOnce(new Error("private driver details")).mockReturnValueOnce(new Promise(() => {}))
  Object.assign(service, { prisma: { $queryRaw: query } })
  expect(await service.status()).toBe("error")
  const status = service.status(); await vi.advanceTimersByTimeAsync(1000)
  expect(await status).toBe("error")
})


it("shares a stalled database read across timed-out probes and reads afresh after recovery", async () => {
  vi.useFakeTimers()
  let recover!: (rows: Array<{ healthy: boolean }>) => void
  const pending = new Promise<Array<{ healthy: boolean }>>(resolve => { recover = resolve })
  const query = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce([{ healthy: false }])
  const service = new WorkerHealthService()
  Object.assign(service, { prisma: { $queryRaw: query } })
  for (let wave = 0; wave < 3; wave++) {
    const probes = Promise.all(Array.from({ length: 20 }, () => service.status()))
    await vi.advanceTimersByTimeAsync(1000)
    expect(await probes).toEqual(Array(20).fill("error"))
  }
  expect(query).toHaveBeenCalledOnce()
  const recovering = service.status()
  recover([{ healthy: true }])
  expect(await recovering).toBe("ok")
  expect(await service.status()).toBe("missing")
  expect(query).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})
