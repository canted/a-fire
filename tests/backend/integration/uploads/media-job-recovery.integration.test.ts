import "reflect-metadata"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import PgBoss from "pg-boss"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossWorkers } from "@server/queue/boss.workers"
import { StorageService } from "@server/storage/storage.service"
import { AudioProcessor } from "@server/uploads/audio/audio.processor"
import { VideoProcessor } from "@server/uploads/video/video.processor"
import { withTestDependencies } from "@tests/backend/helpers/service"

const exec = promisify(execFile)

it.each([
  { kind: "audio", persistent: false, passThrough: false },
  { kind: "video", persistent: false, passThrough: false },
  { kind: "audio", persistent: true, passThrough: false },
  { kind: "video", persistent: true, passThrough: false },
  { kind: "audio", persistent: false, passThrough: true },
  { kind: "audio", persistent: true, passThrough: true },
] as const)("handles $kind storage failure through the real queue (persistent: $persistent, pass-through: $passThrough)", async ({ kind, persistent, passThrough }) => {
  const prisma = new PrismaService()
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL })
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-media-recovery-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const queue = `test.media.${crypto.randomUUID()}`
  const now = new Date()
  let userId: number | undefined
  let blobId: number | undefined
  let fault: ReturnType<typeof vi.spyOn> | undefined
  try {
    const filename = kind === "audio" ? (passThrough ? "sample.m4a" : "sample.wav") : "sample.mov"
    const input = path.join(root, filename)
    await exec("ffmpeg", kind === "audio"
      ? ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.1", input]
      : ["-y", "-f", "lavfi", "-i", "color=c=red:s=32x32:d=0.1", "-c:v", "libx264", "-pix_fmt", "yuv420p", input])
    const bytes = await readFile(input)
    const user = await prisma.user.create({ data: { email: `${queue}@example.com`, username: "Recovery", created_at: now, updated_at: now } })
    userId = user.id
    const blob = await prisma.activeStorageBlob.create({ data: { key: queue, filename, content_type: kind === "audio" ? (passThrough ? "audio/mp4" : "audio/wav") : "video/quicktime", byte_size: bytes.length, service_name: "test", created_at: now } })
    blobId = blob.id
    await storage.put(blob.key, bytes)
    const data = { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Recovery", original_filename: filename, original_mime_type: blob.content_type, processing_status: "pending", created_at: now, updated_at: now }
    const asset = kind === "audio" ? await prisma.audioAsset.create({ data }) : await prisma.videoAsset.create({ data })
    const audioProcessor = withTestDependencies(new AudioProcessor(), { prisma, storage })
    const videoProcessor = withTestDependencies(new VideoProcessor(), { prisma, storage })
    const workers = withTestDependencies(new BossWorkers(), { audioProcessor, videoProcessor })
    // Fail only the external storage boundary; use real database writes,
    // ffmpeg processing, worker dispatch and Boss acknowledgement/retry.
    fault = kind === "audio" ? vi.spyOn(storage, "getBuffer") : vi.spyOn(storage, "getStream")
    const failure = new Error("storage outage")
    if (persistent) fault.mockRejectedValue(failure)
    else fault.mockRejectedValueOnce(failure)
    await boss.start()
    await boss.createQueue(queue)
    const jobId = await boss.send(queue, { assetId: asset.id })
    await boss.work<{ assetId: number }>(queue, async jobs => {
      for (const job of jobs) {
        if (kind === "audio") await workers.handleUploadAudio({ audioAssetId: job.data.assetId })
        else await workers.handleUploadVideo({ videoAssetId: job.data.assetId })
      }
    })
    await vi.waitFor(async () => {
      const [job] = await prisma.$queryRaw<Array<{ state: string; retry_count: number }>>`
        SELECT state::text, retry_count FROM pgboss.job WHERE id = ${jobId}::uuid AND name = ${queue}`
      expect(job).toMatchObject({ state: persistent ? "failed" : "completed", retry_count: persistent ? 2 : 1 })
    }, { timeout: 20_000, interval: 100 })
    const saved = kind === "audio" ? await prisma.audioAsset.findUniqueOrThrow({ where: { id: asset.id } }) : await prisma.videoAsset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(fault).toHaveBeenCalledTimes(persistent ? 3 : 2)
    fault.mockRestore()
    if (persistent) {
      expect(saved.processing_status).toBe("failed")
      expect(saved.error_message).toBe("storage outage")
      expect(await storage.getBuffer(blob.key)).toEqual(bytes)
    } else {
      expect(saved.processing_status).toBe("ready")
      expect(saved.error_message).toBeNull()
      expect(saved.duration_ms).toBeGreaterThan(0)
      expect((await storage.getBuffer(blob.key)).length).toBeGreaterThan(0)
      {
        const playback = await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })
        expect(await storage.getBuffer(blob.key)).toEqual(bytes)
        expect(playback.media_source_key).toBe(blob.key)
        if (!passThrough) expect(playback.key).not.toBe(blob.key)
        expect((await storage.getBuffer(playback.key)).length).toBeGreaterThan(0)
      }
    }
  } finally {
    fault?.mockRestore()
    await boss.stop()
    // This test owns its queue and records; never truncate shared tables.
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = ${queue}`
    await prisma.$executeRaw`DELETE FROM pgboss.queue WHERE name = ${queue}`
    if (blobId) await prisma.activeStorageBlob.delete({ where: { id: blobId } })
    if (userId) await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
