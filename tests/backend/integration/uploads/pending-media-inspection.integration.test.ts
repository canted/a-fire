import "reflect-metadata"
import { it, expect } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { inspectPendingMedia, parsePendingMediaInspectionArgs } from "@server/runtime/inspectPendingMedia"

it.each(["audio", "video"] as const)("inspects unattempted pending %s with bounded read-only pages", async kind => {
  const prisma = new PrismaService(), rollback = new Error("rollback pending fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date(), old = new Date("1800-01-01T00:00:00Z")
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@pending.test`, username: "Fixture", created_at: now, updated_at: now } })
      const blobs = await tx.activeStorageBlob.createManyAndReturn({ data: Array.from({ length: 6 }, () => ({ key: crypto.randomUUID(), filename: "source", byte_size: 1, service_name: "test", created_at: now, media_generation: 1 })) })
      const assets = []
      for (let index = 0; index < blobs.length; index++) {
        const data = { blob_id: blobs[index].id, owner_id: user.id, source_type: "User", source_id: user.id, title: "Private title must not appear", original_filename: "private", processing_status: index === 3 ? "ready" : index === 4 ? "processing" : "pending", created_at: old, updated_at: index === 5 ? now : old }
        assets.push(kind === "audio" ? await tx.audioAsset.create({ data }) : await tx.videoAsset.create({ data }))
      }
      await tx.mediaProcessingAttempt.create({ data: { id: crypto.randomUUID(), blob_id: blobs[2].id, generation: 1, kind, output_key: crypto.randomUUID() } })
      // A historical attempt does not cover the current generation.
      await tx.mediaProcessingAttempt.create({ data: { id: crypto.randomUUID(), blob_id: blobs[1].id, generation: 0, kind, output_key: crypto.randomUUID(), state: "superseded" } })
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Los_Angeles'")
      const options = { kind, before: new Date(old.getTime() + 1), limit: 1, afterId: 0 }
      const first = await inspectPendingMedia(tx, options)
      expect(first.assets).toHaveLength(1)
      expect(first.nextAfterId).toBe(assets[0].id)
      const second = await inspectPendingMedia(tx, { ...options, afterId: first.nextAfterId! })
      expect(second.assets.map(row => row.id)).toEqual([assets[1].id])
      expect(second.nextAfterId).toBeNull()
      for (const row of [...first.assets, ...second.assets]) {
        expect(row).toMatchObject({ writer_status: "unknown", queue_status: "unchecked", media_generation: 1 })
        expect(Object.keys(row).sort()).toEqual(["id", "blob_id", "updated_at", "media_generation", "writer_status", "queue_status"].sort())
      }
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("runs inspection in a database-enforced read-only transaction", async () => {
  const prisma = new PrismaService()
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      const result = await inspectPendingMedia(tx, parsePendingMediaInspectionArgs(["--kind", "video", "--limit", "1"]))
      expect(result.assets.length).toBeLessThanOrEqual(1)
    })
  } finally { await prisma.$disconnect() }
})

it.each([["--kind", "image"], ["--limit", "0"], ["--limit", "1001"], ["--after-id", "-1"], ["--before", "bad"], ["--execute"]])("rejects invalid pending inspection arguments %j", (...args) => {
  expect(() => parsePendingMediaInspectionArgs(args)).toThrow()
})
