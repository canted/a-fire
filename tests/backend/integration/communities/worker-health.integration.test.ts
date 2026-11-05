import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { WorkerHealthService } from "@server/queue/worker-health.service"
import { HealthController } from "@server/api/v1/health/health.controller"

it("reports missing/expired workers, allows multiple leases, and withdraws only the stopped process", async () => {
  const prisma = new PrismaService()
  const first = new WorkerHealthService(), second = new WorkerHealthService(), reader = new WorkerHealthService()
  for (const service of [first, second, reader]) Object.assign(service, { prisma })
  const controller = new HealthController(); Object.assign(controller, { workerHealth: reader })
  // This isolated database has no application workers; never consume actual jobs.
  expect(await prisma.queueWorkerHeartbeat.count()).toBe(0)
  try {
    expect(await reader.status()).toBe("missing")
    await expect(controller.workers()).rejects.toMatchObject({ status: 503, response: { status: "degraded", workers: "missing" } })
    expect(await prisma.queueWorkerHeartbeat.count()).toBe(0) // Probes cannot create health.
    await first.start()
    await first.start()
    expect(await prisma.queueWorkerHeartbeat.count()).toBe(1)
    await second.start()
    expect(await controller.workers()).toEqual({ status: "ok", workers: "ok" })
    await first.stop()
    expect(await prisma.queueWorkerHeartbeat.count()).toBe(1)
    expect(await reader.status()).toBe("ok")
    await prisma.$executeRaw`UPDATE queue_worker_heartbeats SET seen_at=(clock_timestamp() AT TIME ZONE 'UTC') - interval '91 seconds'`
    expect(await reader.status()).toBe("missing")
    await expect(first.start()).rejects.toThrow("shutting down")
    await second.stop()
    expect(await prisma.queueWorkerHeartbeat.count()).toBe(0)
  } finally {
    await Promise.all([first.stop(), second.stop(), reader.stop()])
    await prisma.$disconnect()
  }
})

it("serves worker readiness separately from web liveness without starting a worker", async () => {
  const { NestFactory } = await import("@nestjs/core")
  const { HealthModule } = await import("@server/api/v1/health/health.module")
  const app = await NestFactory.create(HealthModule, { logger: false, abortOnError: false })
  const health = app.get(WorkerHealthService)
  try {
    await app.listen(0, "127.0.0.1")
    const url = await app.getUrl()
    const missing = await fetch(`${url}/api/v1/health/workers`)
    expect(missing.status).toBe(503)
    expect(await missing.json()).toEqual({ status: "degraded", workers: "missing" })
    expect((await fetch(`${url}/api/v1/health/live`)).status).toBe(200)
    await health.start() // Synthetic registered-worker lease; no Boss consumers are started.
    const ready = await fetch(`${url}/api/v1/health/workers`)
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: "ok", workers: "ok" })
    await health.stop()
    expect((await fetch(`${url}/api/v1/health/workers`)).status).toBe(503)
  } finally { await health.stop(); await app.close() }
})
