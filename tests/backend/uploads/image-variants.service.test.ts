import { withTestDependencies } from "@tests/backend/helpers/service";
// @vitest-environment node
import sharp from "sharp"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { imageVariantKey } from "@server/uploads/images/image-variants"

async function setup() {
  const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: "red" } }).jpeg().toBuffer()
  const objects = new Map([["uploads/test", original]])
  const records: { variation_digest: string }[] = []
  let blob: any = { id: 1, key: "uploads/test", content_type: "image/jpeg" }
  const tx = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    activeStorageBlob: { findUnique: vi.fn(async () => blob), update: vi.fn(), delete: vi.fn(async () => { blob = null }) },
    activeStorageAttachment: { count: vi.fn(async () => 0) },
    activeStorageVariantRecord: {
      findFirst: vi.fn(async ({ where }) => records.find(record => record.variation_digest === where.variation_digest)),
      create: vi.fn(async ({ data }) => records.push(data)), findMany: vi.fn(async () => records), deleteMany: vi.fn(),
    },
  }
  // Shared transaction serialization models the advisory lock across two service instances.
  let pending = Promise.resolve()
  const prisma = { $transaction: vi.fn(operation => { const work = pending.then(() => operation(tx)); pending = work.catch(() => {}); return work }) }
  const storage = {
    getBuffer: vi.fn(async key => objects.get(key)), exists: vi.fn(async key => objects.has(key)),
    put: vi.fn(async (key, buffer) => { objects.set(key, buffer) }),
    deleteMany: vi.fn(async (keys: string[]) => { keys.forEach(key => objects.delete(key)) }), delete: vi.fn(async key => { objects.delete(key) }),
  }
  const service = () => withTestDependencies(new ImageVariantsService(), { prisma, storage })
  return { service, storage, prisma, tx, objects, records }
}

describe("canonical image materialization and deletion", () => {
  it("deduplicates concurrent API and worker generation, reads the source once per batch, and persists actual outputs", async () => {
    const { service, storage, records, objects, tx } = await setup()
    const api = service(), worker = service()
    await Promise.all([api.ensure(1, ["w320", "w600"]), api.ensure(1, ["w320", "w600"]), worker.ensure(1, ["w600"])])
    expect(storage.getBuffer).toHaveBeenCalledTimes(1)
    expect(storage.put).toHaveBeenCalledTimes(2)
    expect(records.map(record => record.variation_digest).sort()).toEqual(["v2/w320", "v2/w600"])
    expect((await sharp(objects.get(imageVariantKey("uploads/test", "w320"))).metadata()).width).toBe(320)
    expect(tx.$queryRaw).toHaveBeenCalledWith(expect.any(Array), 1)
    expect(tx.activeStorageBlob.update).toHaveBeenCalledWith(expect.objectContaining({ data: { metadata: JSON.stringify({ contentType: "image/jpeg", width: 800, height: 400, frames: 1 }), content_type: "image/jpeg" } }))
  })

  it("does not record failed writes and can retry after a storage failure", async () => {
    const { service, storage, records } = await setup()
    const images = service()
    storage.put.mockRejectedValueOnce(new Error("S3 unavailable"))
    await expect(images.ensure(1, ["w320"])).rejects.toThrow("S3 unavailable")
    expect(records).toEqual([])
    await images.ensure(1, ["w320"])
    expect(records).toHaveLength(1)
  })

  it("purges legacy/untracked variants and coordinates with generation queued on another instance", async () => {
    const { service, objects, storage, tx } = await setup()
    objects.set("variants/uploads/test/icon96.webp", Buffer.from("legacy"))
    objects.set("variants/uploads/test/v2/icon160.webp", Buffer.from("untracked"))
    const api = service(), worker = service()
    let started!: () => void, release!: () => void
    const reading = new Promise<void>(resolve => { started = resolve })
    const proceed = new Promise<void>(resolve => { release = resolve })
    storage.getBuffer.mockImplementationOnce(async key => { started(); await proceed; return objects.get(key) })
    const generation = worker.ensure(1, ["w320"])
    await reading
    const purge = api.purgeOrphan(1)
    release()
    await Promise.all([generation, purge])
    expect(objects.size).toBe(0)
    expect(storage.deleteMany).toHaveBeenCalledWith(expect.arrayContaining(["variants/uploads/test/icon96.webp", "variants/uploads/test/v2/icon160.webp"]))
    await expect(worker.ensure(1, ["w600"])).rejects.toThrow("Not Found")
    expect(tx.activeStorageBlob.delete).toHaveBeenCalledTimes(1)
  })

  it("repairs validated metadata without rewriting source bytes and ignores unsafe legacy cleanup keys", async () => {
    const { service, tx, storage, records } = await setup()
    await service().repairMetadata(1)
    expect(tx.activeStorageBlob.update).toHaveBeenCalledWith(expect.objectContaining({ data: { content_type: "image/jpeg", metadata: JSON.stringify({ contentType: "image/jpeg", width: 800, height: 400, frames: 1 }) } }))
    expect(storage.put).not.toHaveBeenCalled()
    records.push({ variation_digest: "../../../../other-file" })
    await service().purgeOrphan(1)
    expect(storage.deleteMany.mock.calls.flat(2).join(" ")).not.toContain("..")
  })

  it("retains shared blobs and never generates arbitrary presets", async () => {
    const { service, tx, storage } = await setup()
    tx.activeStorageAttachment.count.mockResolvedValue(1)
    await service().purgeOrphan(1)
    await service().ensure(1, ["w999", "../../outside"])
    expect(storage.delete).not.toHaveBeenCalled()
    expect(storage.put).not.toHaveBeenCalled()
  })
})
