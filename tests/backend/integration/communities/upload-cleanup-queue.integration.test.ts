import { execFile } from "node:child_process"
import { promisify } from "node:util"
import "reflect-metadata"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { BossWorkers } from "@server/queue/boss.workers"
import { CHAT_EXPIRE_QUEUE, UPLOAD_ORPHAN_PURGE_QUEUE } from "@server/queue/queue-names"
import { StorageService } from "@server/storage/storage.service"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("delivers queued orphan cleanup through Boss while preserving referenced storage", async () => {
  const prisma = new PrismaService(), boss = new BossService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-cleanup-queue-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const imageStorage = withTestDependencies(new ImageVariantsService(), { prisma, storage })
  const worker = withTestDependencies(new BossWorkers(), { imageStorage })
  const blobs: Array<{ id: number; key: string }> = [], jobs: string[] = []
  try {
    for (const filename of ["orphan.png", "retained.png"]) {
      const key = crypto.randomUUID()
      await storage.put(key, Buffer.from("fixture"), "image/png")
      blobs.push(await prisma.activeStorageBlob.create({ data: { key, filename, byte_size: 7, content_type: "image/png", service_name: "local", created_at: new Date() } }))
    }
    await prisma.activeStorageAttachment.create({ data: { record_type: "User", record_id: 2147483647, name: "avatar", blob_id: blobs[1].id, created_at: new Date() } })
    await boss.work<{ blobId: number }>(UPLOAD_ORPHAN_PURGE_QUEUE, data => worker.handleOrphanPurge(data))
    for (const blob of blobs) {
      const jobId = await boss.enqueue(UPLOAD_ORPHAN_PURGE_QUEUE, { blobId: blob.id })
      expect(jobId).not.toBeNull()
      jobs.push(jobId!)
    }
    await expect.poll(async () => {
      const rows = await prisma.$queryRaw<Array<{ state: string }>>`SELECT state::text FROM pgboss.job WHERE id IN (${jobs[0]}::uuid, ${jobs[1]}::uuid)`
      return rows.length === 2 && rows.every(row => row.state === "completed")
    }, { timeout: 15_000 }).toBe(true)
    expect(await prisma.activeStorageBlob.findUnique({ where: { id: blobs[0].id } })).toBeNull()
    expect(await storage.exists(blobs[0].key)).toBe(false)
    expect(await prisma.activeStorageBlob.findUnique({ where: { id: blobs[1].id } })).not.toBeNull()
    expect(await storage.exists(blobs[1].key)).toBe(true)
    // Test-only override: make the invalid fixture terminal without waiting
    // through production retry defaults. No stored object uses this ID.
    const failedJob = await boss.enqueue(UPLOAD_ORPHAN_PURGE_QUEUE, { blobId: -1 }, { retryLimit: 0 })
    expect(failedJob).not.toBeNull()
    jobs.push(failedJob!)
    await expect.poll(async () => {
      const rows = await prisma.$queryRaw<Array<{ state: string }>>`SELECT state::text FROM pgboss.job WHERE id = ${failedJob}::uuid`
      return rows[0]?.state
    }, { timeout: 15_000 }).toBe("failed")
    // No Chat worker is registered here: these jobs remain queued for inspection.
    const overdue = await boss.enqueue(CHAT_EXPIRE_QUEUE, { messageId: 2147483647 })
    const future = await boss.enqueueAfter(CHAT_EXPIRE_QUEUE, { messageId: 2147483647 }, new Date(Date.now() + 86400000))
    expect(overdue).not.toBeNull(); expect(future).not.toBeNull()
    jobs.push(overdue!, future!)
    await prisma.$executeRaw`UPDATE pgboss.job SET start_after=now()-interval '1 hour' WHERE id=${overdue}::uuid`
    await prisma.$executeRaw`UPDATE pgboss.job SET created_on=now()-interval '10 days' WHERE id=${future}::uuid`
    const { stdout } = await promisify(execFile)(process.execPath, ["bin/queue-status.mjs"], {
      env: { ...process.env, QUEUE_STATUS_DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL },
    })
    const report = JSON.parse(stdout)
    expect(report.read_only).toBe(true)
    expect(report.queues).toContainEqual(expect.objectContaining({ queue: UPLOAD_ORPHAN_PURGE_QUEUE, state: "completed", jobs: "2", ready_jobs: "0" }))
    expect(report.queues).toContainEqual(expect.objectContaining({ queue: UPLOAD_ORPHAN_PURGE_QUEUE, state: "failed", jobs: "1", ready_jobs: "0" }))
    const backlog = report.queues.find((queue: { queue: string; state: string }) => queue.queue === CHAT_EXPIRE_QUEUE && queue.state === "created")
    expect(backlog).toMatchObject({ jobs: "2", ready_jobs: "1" })
    expect(backlog.oldest_ready_age_seconds).toBeGreaterThanOrEqual(3590)
    expect(backlog.oldest_ready_age_seconds).toBeLessThan(3630)
    expect(Date.parse(backlog.oldest_ready_at)).toBeGreaterThan(Date.parse(backlog.oldest_created_at))
    for (const queue of report.queues.filter((queue: { ready_jobs: string }) => queue.ready_jobs === "0")) {
      expect(queue.oldest_ready_at).toBeNull()
      expect(queue.oldest_ready_age_seconds).toBeNull()
    }
    expect(stdout).not.toContain("Invalid orphan blob ID")
    for (const blob of blobs) expect(stdout).not.toContain(blob.key)

  } finally {
    await boss.onModuleDestroy()
    for (const jobId of jobs) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${jobId}::uuid`
    await prisma.activeStorageAttachment.deleteMany({ where: { blob_id: { in: blobs.map(blob => blob.id) } } })
    await prisma.activeStorageBlob.deleteMany({ where: { id: { in: blobs.map(blob => blob.id) } } })
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
