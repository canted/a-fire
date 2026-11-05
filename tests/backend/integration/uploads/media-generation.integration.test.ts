import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { StorageService } from "@server/storage/storage.service"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { videoPosterStorageKey } from "@server/uploads/video/video-poster"
import { withTestDependencies } from "@tests/backend/helpers/service"
import "reflect-metadata"
import { it, expect } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { beginMediaProcessing, publishMediaProcessing, failMediaProcessing } from "@server/uploads/media-processing"

it.each(["audio", "video"] as const)("fences stale %s generations across assets sharing a blob", async kind => {
  const prisma = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-generation-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const images = withTestDependencies(new ImageVariantsService(), { prisma, storage })
  const now = new Date()
  const key = `generation/${crypto.randomUUID()}`
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@generation.test`, username: "Author", created_at: now, updated_at: now } })
  const blob = await prisma.activeStorageBlob.create({ data: { key, filename: "source.bin", byte_size: 10, service_name: "test", created_at: now } })
  try {
    await storage.put(key, Buffer.from("original"))
    const data = { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Copy", original_filename: "source.bin", processing_status: "pending", created_at: now, updated_at: now }
    for (let i = 0; i < 2; i++) {
      if (kind === "audio") await prisma.audioAsset.create({ data })
      else await prisma.videoAsset.create({ data })
    }
    const attempts = await Promise.all([beginMediaProcessing(prisma, blob.id, kind), beginMediaProcessing(prisma, blob.id, kind)])
    attempts.sort((a, b) => a.generation - b.generation)
    const [old, current] = attempts
    expect(attempts.map(a => a.generation)).toEqual([1, 2])
    expect(attempts.map(a => a.sourceKey)).toEqual([key, key])
    expect(old.output_key).not.toBe(current.output_key)
    for (const attempt of attempts) {
      await storage.put(attempt.output_key, Buffer.from("output"))
      if (kind === "video") await storage.put(videoPosterStorageKey(attempt.output_key), Buffer.from("poster"))
    }
    await images.purgeOrphan(blob.id)
    expect(await storage.exists(key)).toBe(true)
    expect(await prisma.activeStorageBlob.findUnique({ where: { id: blob.id } })).not.toBeNull()
    const output = { filename: "playback.mp4", contentType: `${kind}/mp4`, byteSize: 20, metadata: "{}", durationMs: 2000, width: 20, height: 20 }
    const failing = prisma.$extends({ query: { $allModels: { async updateMany({ args, query }) {
      if ("processing_status" in args.data && args.data.processing_status === "ready") throw new Error("Asset publication failed")
      return query(args)
    } } } })
    await expect(publishMediaProcessing(failing as unknown as PrismaService, current.id, output)).rejects.toThrow("Asset publication failed")
    expect((await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).key).toBe(key)
    expect((await prisma.mediaProcessingAttempt.findUniqueOrThrow({ where: { id: current.id } })).state).toBe("processing")
    expect(await publishMediaProcessing(prisma, current.id, output)).toBe(true)
    const committed = await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })
    expect(committed).toMatchObject({ key: current.output_key, media_source_key: key, media_generation: 2 })
    await images.purgeOrphan(blob.id)
    expect(await storage.exists(old.output_key)).toBe(true)
    expect((await prisma.mediaProcessingAttempt.findUniqueOrThrow({ where: { id: old.id } })).finished_at).toBeNull()
    expect(await publishMediaProcessing(prisma, old.id, { ...output, byteSize: 999 })).toBe(false)
    expect(await failMediaProcessing(prisma, old.id, new Error("late failure"))).toBe(false)
    expect(await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).toEqual(committed)
    const assets = kind === "audio" ? await prisma.audioAsset.findMany({ where: { blob_id: blob.id } }) : await prisma.videoAsset.findMany({ where: { blob_id: blob.id } })
    expect(assets).toHaveLength(2)
    for (const asset of assets) expect(asset).toMatchObject({ processing_status: "ready", duration_ms: 2000, error_message: null })
    expect(await publishMediaProcessing(prisma, current.id, output)).toBe(true)
    const next = await beginMediaProcessing(prisma, blob.id, kind)
    expect(next.sourceKey).toBe(key)
    await storage.put(next.output_key, Buffer.from("partial output"))
    expect(await failMediaProcessing(prisma, next.id, new Error("current failure"))).toBe(true)
    expect((await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).key).toBe(current.output_key)
    expect(await prisma.mediaProcessingAttempt.count({ where: { blob_id: blob.id } })).toBe(3)
    await images.purgeOrphan(blob.id)
    for (const objectKey of [key, ...attempts.map(a => a.output_key), next.output_key]) expect(await storage.exists(objectKey)).toBe(false)
    if (kind === "video") for (const attempt of attempts) expect(await storage.exists(videoPosterStorageKey(attempt.output_key))).toBe(false)
    expect(await prisma.activeStorageBlob.findUnique({ where: { id: blob.id } })).toBeNull()
    expect(await prisma.mediaProcessingAttempt.count({ where: { blob_id: blob.id } })).toBe(0)
  } finally {
    await prisma.activeStorageBlob.deleteMany({ where: { id: blob.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
})
