import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { NavigationService } from "@server/api/v1/navigation/navigation.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("keeps Board-free Room navigation usable through retained-history deletion", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback navigation fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@navigation.test`, username: "Fixture", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", owner_id: user.id, porosity: "closed", created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const blobs = await tx.activeStorageBlob.createManyAndReturn({ data: Array.from({ length: 2 }, () => ({ key: crypto.randomUUID(), filename: "icon", byte_size: 1, service_name: "test", created_at: now })) })
      for (const blob of blobs) await tx.activeStorageAttachment.create({ data: { blob_id: blob.id, record_type: "Circle", record_id: room.id, name: "avatar", created_at: now } })
      const service = withTestDependencies(new NavigationService(), { prisma: tx })
      const menu = await service.slideMenu(user.id, room.id)
      expect(menu.rooms).toHaveLength(1)
      expect(menu.currentRoom?.avatar_url).toBe(`/api/v1/uploads/${blobs[1].id}/variants/icon160`)
      expect(menu.rooms[0].avatar_url).toBe(menu.currentRoom?.avatar_url)
      await tx.room.update({ where: { id: room.id }, data: { deleted_at: now } })
      expect(await service.slideMenu(user.id, room.id)).toEqual({ rooms: [], currentRoom: null })
      expect(await tx.roomMembership.count({ where: { room_id: room.id } })).toBe(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
