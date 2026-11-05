import "reflect-metadata"
import sharp from "sharp"
import { expect, it, vi } from "vitest"
import { PrismaClient } from "@prisma/client"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each([false, true])("retains the old avatar and recovers rejected uploads (storage failure: %s)", async failCleanup => {
  const prisma = new PrismaClient(), now = new Date(), token = crypto.randomUUID()
  const user = await prisma.user.create({ data: { email: `${token}@avatar.test`, username: "Avatar", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Avatar", created_at: now, updated_at: now } })
  const member = await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const old = await prisma.activeStorageBlob.create({ data: { key: token, filename: "old.png", content_type: "image/png", byte_size: 1, service_name: "test", created_at: now } })
  const target = { record_type: "CircleMembership", record_id: member.id, name: "avatar" }
  const attachment = await prisma.activeStorageAttachment.create({ data: { ...target, blob_id: old.id, created_at: now } })
  const storage = {
    put: vi.fn(async () => { await prisma.roomMembership.update({ where: { id: member.id }, data: { disabled: true } }) }),
    delete: vi.fn(), deleteMany: vi.fn(),
  }
  const images = withTestDependencies(new ImageVariantsService(), { prisma, storage })
  const boss = { enqueue: vi.fn().mockResolvedValue("cleanup-job") }
  const uploads = withTestDependencies(new UploadsService(), { prisma, storage, images, boss })
  const filename = `${token}.png`
  if (failCleanup) storage.delete.mockRejectedValueOnce(new Error("Storage unavailable"))
  try {
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer()
    await expect(uploads.createAttachmentUpload(user.id, { buffer, size: buffer.length, mimetype: "image/png", originalname: filename } as Express.Multer.File, target)).rejects.toThrow("Forbidden")
    expect(storage.put).toHaveBeenCalledTimes(1)
    expect(storage.delete).toHaveBeenCalledTimes(1)
    expect(storage.delete).not.toHaveBeenCalledWith(old.key)
    expect(await prisma.activeStorageAttachment.findUnique({ where: { id: attachment.id } })).toEqual(attachment)
    expect(await prisma.activeStorageBlob.findUnique({ where: { id: old.id } })).not.toBeNull()
    if (failCleanup) {
      expect(boss.enqueue).toHaveBeenCalledWith("uploads.purge-orphan", { blobId: expect.any(Number) })
      const pending = await prisma.activeStorageBlob.findFirstOrThrow({ where: { filename } })
      // Recovery must recheck references: a blob may have been attached since
      // the failed cleanup (including an uncertain successful commit).
      const recovered = await prisma.activeStorageAttachment.create({ data: { ...target, name: "recovery-test", blob_id: pending.id, created_at: now } })
      storage.delete.mockClear()
      await images.purgeOrphan(pending.id)
      expect(storage.delete).not.toHaveBeenCalled()
      expect(await prisma.activeStorageBlob.findUnique({ where: { id: pending.id } })).not.toBeNull()
      await prisma.activeStorageAttachment.delete({ where: { id: recovered.id } })
      await images.purgeOrphan(pending.id)
      await images.purgeOrphan(pending.id)
      expect(storage.delete).toHaveBeenCalledTimes(1)
      expect(storage.delete).toHaveBeenCalledWith(pending.key)
    }
    expect(await prisma.activeStorageBlob.count({ where: { filename } })).toBe(0)
  } finally {
    await prisma.activeStorageAttachment.deleteMany({ where: { record_type: "CircleMembership", record_id: member.id } })
    await prisma.activeStorageBlob.deleteMany({ where: { OR: [{ id: old.id }, { filename }] } })
    await prisma.roomMembership.delete({ where: { id: member.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
