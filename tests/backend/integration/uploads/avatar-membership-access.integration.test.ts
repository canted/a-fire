import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("bounds avatar membership candidates and denies a deleted shared Room", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback fixture")
  try {
    await prisma.$transaction(async tx => {
      const users = await tx.user.createManyAndReturn({ data: ["owner", "viewer"].map(name => ({ email: `${crypto.randomUUID()}@avatar-scope.test`, username: name, created_at: now, updated_at: now })) })
      const [owner, viewer] = users
      const rooms = await tx.room.createManyAndReturn({ data: Array.from({ length: 1001 }, () => ({ name: "Membership history", created_at: now, updated_at: now })) })
      await tx.roomMembership.createMany({ data: rooms.map(room => ({ room_id: room.id, user_id: owner.id, created_at: now, updated_at: now })) })
      const shared = rooms[rooms.length - 1]
      const membership = await tx.roomMembership.create({ data: { room_id: shared.id, user_id: viewer.id, created_at: now, updated_at: now } })
      const blob = await tx.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "avatar.png", content_type: "image/png", service_name: "test", byte_size: 1, created_at: now } })
      await tx.activeStorageAttachment.create({ data: { blob_id: blob.id, record_type: "User", record_id: owner.id, name: "avatar", created_at: now } })
      const image = { type: "image", attrs: { src: `/api/v1/uploads/${blob.id}` } }
      const access = new RoomAccessService(); Object.assign(access, { prisma: tx })
      const service = new UploadsService(); Object.assign(service, { prisma: tx, circleAccess: access })
      const candidates = vi.spyOn(tx.roomMembership, "findMany"), resolve = vi.spyOn(access, "resolve")
      try {
        await expect(service.assertContentMediaAccess(viewer.id, image, null)).resolves.toBeUndefined()
        expect(candidates).toHaveBeenCalledOnce()
        expect(candidates).toHaveBeenCalledWith(expect.objectContaining({ take: 100, orderBy: { id: "asc" } }))
        expect(resolve).toHaveBeenCalledOnce()
        expect(resolve).toHaveBeenCalledWith(shared.id, viewer.id, expect.any(Date))
        // Unapproved leases are candidates, never grants. More than one page
        // must still reach the genuinely shared Room without loading all memberships.
        await tx.roomVisit.createMany({ data: rooms.slice(0, 100).map(room => ({ room_id: room.id, user_id: viewer.id, source: "knock", last_activity_at: now, expires_at: new Date(now.getTime() + 86400000) })) })
        candidates.mockClear(); resolve.mockClear()
        await expect(service.assertContentMediaAccess(viewer.id, image, null)).resolves.toBeUndefined()
        expect(candidates).toHaveBeenCalledTimes(2)
        expect(resolve).toHaveBeenCalledTimes(101)
        await tx.roomVisit.deleteMany({ where: { user_id: viewer.id } })
        resolve.mockClear()
        await tx.room.update({ where: { id: shared.id }, data: { deleted_at: now } })
        await expect(service.assertContentMediaAccess(viewer.id, image, null)).rejects.toThrow("Not Found")
        expect(resolve).not.toHaveBeenCalled()
        await tx.room.update({ where: { id: shared.id }, data: { deleted_at: null } })
        await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
        await expect(service.assertContentMediaAccess(viewer.id, image, null)).rejects.toThrow("Not Found")
        await expect(service.assertContentMediaAccess(owner.id, image, null)).resolves.toBeUndefined()
      } finally { candidates.mockRestore(); resolve.mockRestore() }
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
