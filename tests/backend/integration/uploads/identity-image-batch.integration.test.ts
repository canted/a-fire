import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { identityImageUrl, identityImageUrls } from "@server/api/v1/uploads/identity-images"

it("batches latest identity images with deterministic ties and matching single-read policy", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback identity fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await tx.user.createManyAndReturn({ data: Array.from({ length: 3 }, () => ({ email: `${crypto.randomUUID()}@identity-batch.test`, username: "Fixture", created_at: now, updated_at: now })) })
      const blobs = await tx.activeStorageBlob.createManyAndReturn({ data: Array.from({ length: 3 }, () => ({ key: crypto.randomUUID(), filename: "avatar.png", content_type: "image/png", byte_size: 1, service_name: "test", created_at: now })) })
      const attachment = { name: "avatar", record_type: "User", record_id: users[0].id, created_at: now }
      await tx.activeStorageAttachment.create({ data: { ...attachment, blob_id: blobs[0].id } })
      await tx.activeStorageAttachment.create({ data: { ...attachment, blob_id: blobs[1].id } })
      await tx.activeStorageAttachment.create({ data: { ...attachment, blob_id: blobs[2].id, created_at: new Date(now.getTime() - 1000) } })
      await tx.activeStorageAttachment.create({ data: { ...attachment, record_id: users[1].id, blob_id: blobs[0].id } })
      await tx.activeStorageAttachment.create({ data: { ...attachment, record_type: "Circle", blob_id: blobs[2].id } })
      await tx.activeStorageAttachment.create({ data: { ...attachment, name: "banner", blob_id: blobs[2].id } })
      let calls = 0
      const query: typeof tx.$queryRaw = (...args) => { calls += 1; return tx.$queryRaw(...args) }
      const map = await identityImageUrls({ $queryRaw: query }, "User", [...users.map(user => user.id), users[0].id])
      expect(calls).toBe(1)
      expect(map.size).toBe(2)
      expect(map.get(users[0].id)).toContain(`/uploads/${blobs[1].id}/variants/avatarStripe40`)
      expect(map.get(users[1].id)).toContain(`/uploads/${blobs[0].id}/variants/avatarStripe40`)
      expect(map.has(users[2].id)).toBe(false)
      expect(map.get(users[0].id)).toBe(await identityImageUrl(tx, "User", users[0].id))
      expect((await identityImageUrls(tx, "Circle", [users[0].id])).get(users[0].id)).toBe(await identityImageUrl(tx, "Circle", users[0].id))
      expect((await identityImageUrls({ $queryRaw: query }, "User", [])).size).toBe(0)
      expect(calls).toBe(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
