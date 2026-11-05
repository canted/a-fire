import { withTestDependencies } from "@tests/backend/helpers/service";
// @vitest-environment node
import { PrismaService } from "@server/prisma/prisma.service"
import { StorageService } from "@server/storage/storage.service"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { loadEnv } from "@server/runtime/loadEnv"
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"

it("coordinates real PostgreSQL image locks across API/worker connections and purge", async () => {
  loadEnv(); loadTestEnvironment({ requireDatabase: true })
  const first = new PrismaService(), second = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-image-lock-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const api = withTestDependencies(new ImageVariantsService(), { prisma: first, storage })
  const worker = withTestDependencies(new ImageVariantsService(), { prisma: second, storage })
  let blobId: number | undefined
  try {
    const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: "red" } }).png().toBuffer()
    const key = `image-integration-${crypto.randomUUID()}`
    const blob = await first.activeStorageBlob.create({ data: { key, filename: "test.png", content_type: "image/png", byte_size: original.length, service_name: "test", created_at: new Date() } })
    blobId = blob.id
    await api.withBlobLock(blob.id, async () => {
      await second.$transaction(async tx => {
        const rows = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(71423, ${blob.id}::integer) AS acquired`
        expect(rows[0].acquired).toBe(false)
      })
    })
    await storage.put(key, original)
    const get = vi.spyOn(storage, "getBuffer"), put = vi.spyOn(storage, "put")
    await Promise.all([api.ensure(blob.id, ["w320", "w600"]), worker.ensure(blob.id, ["w320", "w600"])])
    expect(get).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(2)
    expect(await first.activeStorageVariantRecord.count({ where: { blob_id: blob.id } })).toBe(2)
    let started!: () => void
    const processing = new Promise<void>(resolve => { started = resolve })
    const getBuffer = StorageService.prototype.getBuffer.bind(storage)
    get.mockImplementationOnce(async key => { started(); return getBuffer(key) })
    const generation = worker.ensure(blob.id, ["w1200"])
    await processing
    await Promise.all([generation, api.purgeOrphan(blob.id)])
    expect(await first.activeStorageBlob.findUnique({ where: { id: blob.id } })).toBeNull()
    expect(await storage.exists(key)).toBe(false)
    await expect(worker.ensure(blob.id, ["w600"])).rejects.toThrow("Not Found")
  } finally {
    if (blobId) {
      await first.activeStorageVariantRecord.deleteMany({ where: { blob_id: blobId } })
      await first.activeStorageBlob.deleteMany({ where: { id: blobId } })
    }
    await Promise.all([first.$disconnect(), second.$disconnect(), rm(root, { recursive: true, force: true })])
  }
}, 30_000)

it("recovers a stored image variant when its database transaction fails after the write", async () => {
  const prisma = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-image-retry-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: "blue" } }).png().toBuffer()
  const key = `image-retry-${crypto.randomUUID()}`
  const blob = await prisma.activeStorageBlob.create({ data: { key, filename: "test.png", content_type: "image/png", byte_size: original.length, service_name: "test", created_at: new Date() } })
  let fail = true
  const database = prisma.$extends({ query: { activeStorageVariantRecord: { async create({ args, query }) {
    const result = await query(args)
    if (fail) throw new Error("Database interrupted after storage write")
    return result
  } } } })
  const images = withTestDependencies(new ImageVariantsService(), { prisma: database, storage })
  try {
    await storage.put(key, original)
    await expect(images.ensure(blob.id, ["w320"])).rejects.toThrow("Database interrupted")
    expect(await prisma.activeStorageVariantRecord.count({ where: { blob_id: blob.id } })).toBe(0)
    const { imageVariantKey } = await import("@server/uploads/images/image-variants")
    const outputKey = imageVariantKey(key, "w320")
    expect(await storage.exists(outputKey)).toBe(true)
    // An uncommitted object can also be incomplete; existence alone is not proof.
    await storage.put(outputKey, Buffer.from("interrupted bytes"))
    fail = false
    await images.ensure(blob.id, ["w320"])
    expect(await prisma.activeStorageVariantRecord.count({ where: { blob_id: blob.id } })).toBe(1)
    expect((await sharp(await storage.getBuffer(outputKey)).metadata()).width).toBe(320)
    expect(JSON.parse((await prisma.activeStorageBlob.findUniqueOrThrow({ where: { id: blob.id } })).metadata!)).toMatchObject({ width: 800, height: 400 })
    const put = vi.spyOn(storage, "put")
    await images.ensure(blob.id, ["w320"])
    expect(put).not.toHaveBeenCalled()
    expect(await storage.getBuffer(key)).toEqual(original)
  } finally {
    await prisma.activeStorageVariantRecord.deleteMany({ where: { blob_id: blob.id } })
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } })
    await prisma.$disconnect()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
