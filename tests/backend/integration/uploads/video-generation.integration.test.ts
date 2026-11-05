import { videoPosterStorageKey } from "@server/uploads/video/video-poster"
import "reflect-metadata"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it, expect, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { StorageService } from "@server/storage/storage.service"
import { VideoProcessor } from "@server/uploads/video/video.processor"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each([false, true])("prevents a superseded video processor from replacing newer playback (failure: %s)", async failure => {
  const prisma = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-video-generation-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const now = new Date(), key = crypto.randomUUID()
  const user = await prisma.user.create({ data: { email: `${key}@generation.test`, username: "Author", created_at: now, updated_at: now } })
  const blob = await prisma.activeStorageBlob.create({ data: { key, filename: "source.mov", content_type: "video/quicktime", byte_size: 8, service_name: "test", created_at: now } })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const processing = new Promise<void>(resolve => { started = resolve })
  let oldWork: Promise<void> | undefined
  try {
    await storage.put(key, Buffer.from("original"))
    const data = { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Copy", original_filename: "source.mov", original_mime_type: "video/quicktime", processing_status: "pending", created_at: now, updated_at: now }
    const first = await prisma.videoAsset.create({ data }), second = await prisma.videoAsset.create({ data })
    const older = withTestDependencies(new VideoProcessor(), { prisma, storage })
    const newer = withTestDependencies(new VideoProcessor(), { prisma, storage })
    vi.spyOn(older as any, "processVideoFile").mockImplementation(async (...args: unknown[]) => {
      const [input, output] = args as string[]
      expect((await readFile(input)).toString()).toBe("original")
      started()
      await held
      if (failure) throw new Error("late video failure")
      await writeFile(output, "obsolete")
      return { byteSize: 8, posterBuffer: Buffer.from("old poster"), durationMs: 100, width: 10, height: 10 }
    })
    vi.spyOn(newer as any, "processVideoFile").mockImplementation(async (...args: unknown[]) => {
      const [input, output] = args as string[]
      expect((await readFile(input)).toString()).toBe("original")
      await writeFile(output, "current")
      return { byteSize: 7, posterBuffer: Buffer.from("new poster"), durationMs: 200, width: 20, height: 20 }
    })
    oldWork = older.process({ videoAssetId: first.id })
    await processing
    await newer.process({ videoAssetId: second.id })
    const published = await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })
    release()
    await oldWork
    expect(await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).toEqual(published)
    expect(await storage.getBuffer(published.key)).toEqual(Buffer.from("current"))
    expect(await storage.getBuffer(videoPosterStorageKey(published.key))).toEqual(Buffer.from("new poster"))
    expect(await storage.getBuffer(key)).toEqual(Buffer.from("original"))
    const copies = await prisma.videoAsset.findMany({ where: { blob_id: blob.id } })
    for (const copy of copies) expect(copy).toMatchObject({ processing_status: "ready", duration_ms: 200, width: 20, height: 20, error_message: null })
    expect(await prisma.mediaProcessingAttempt.count({ where: { blob_id: blob.id, finished_at: null } })).toBe(0)
  } finally {
    release()
    await oldWork
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
})
