import "reflect-metadata"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it, expect, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { StorageService } from "@server/storage/storage.service"
import { AudioProcessor } from "@server/uploads/audio/audio.processor"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each([false, true])("prevents a superseded audio processor from replacing newer playback (failure: %s)", async failure => {
  const prisma = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-audio-generation-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const now = new Date(), key = crypto.randomUUID()
  const user = await prisma.user.create({ data: { email: `${key}@generation.test`, username: "Author", created_at: now, updated_at: now } })
  const blob = await prisma.activeStorageBlob.create({ data: { key, filename: "source.wav", content_type: "audio/wav", byte_size: 8, service_name: "test", created_at: now } })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const processing = new Promise<void>(resolve => { started = resolve })
  let oldWork: Promise<void> | undefined
  try {
    await storage.put(key, Buffer.from("original"))
    const data = { blob_id: blob.id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Copy", original_filename: "source.wav", original_mime_type: "audio/wav", processing_status: "pending", created_at: now, updated_at: now }
    const first = await prisma.audioAsset.create({ data }), second = await prisma.audioAsset.create({ data })
    const older = withTestDependencies(new AudioProcessor(), { prisma, storage })
    const newer = withTestDependencies(new AudioProcessor(), { prisma, storage })
    vi.spyOn(older, "transcodeAudioBuffer").mockImplementation(async bytes => {
      expect(bytes.toString()).toBe("original")
      started()
      await held
      if (failure) throw new Error("late transcode failure")
      return { buffer: Buffer.from("obsolete"), durationMs: 100, spectrum: { version: 3 as const, status: "ready" as const, peaks: [0.1], bands: [[1, 0, 0] as [number, number, number]] } }
    })
    vi.spyOn(newer, "transcodeAudioBuffer").mockImplementation(async bytes => {
      expect(bytes.toString()).toBe("original")
      return { buffer: Buffer.from("current"), durationMs: 200, spectrum: { version: 3 as const, status: "ready" as const, peaks: [0.2], bands: [[1, 0, 0] as [number, number, number]] } }
    })
    oldWork = older.process({ audioAssetId: first.id })
    await processing
    await newer.process({ audioAssetId: second.id })
    const published = await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })
    expect(JSON.parse(published.metadata!)).toMatchObject({ spectrum: { version: 3, status: "ready", peaks: [0.2], bands: [[1, 0, 0]] } })
    release()
    await oldWork
    expect(await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).toEqual(published)
    expect(await storage.getBuffer(published.key)).toEqual(Buffer.from("current"))
    expect(await storage.getBuffer(key)).toEqual(Buffer.from("original"))
    const copies = await prisma.audioAsset.findMany({ where: { blob_id: blob.id } })
    for (const copy of copies) expect(copy).toMatchObject({ processing_status: "ready", duration_ms: 200, error_message: null, waveform_peaks: [] })
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
