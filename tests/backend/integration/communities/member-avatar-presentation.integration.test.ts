import { BoardsDetailService } from "@server/api/v1/boards/boards.detail.service"
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { MentionsService } from "@server/api/v1/mentions/mentions.service"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("uses the latest canonical avatar in Board-free member lists despite retained image history", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback member avatar fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await tx.user.createManyAndReturn({ data: Array.from({ length: 2 }, () => ({ email: `${crypto.randomUUID()}@member-avatar.test`, username: "Fixture", created_at: now, updated_at: now })) })
      const room = await tx.room.create({ data: { name: "Fixture", owner_id: users[0].id, created_at: now, updated_at: now } })
      await tx.roomMembership.createMany({ data: users.map(user => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
      const blobs = await tx.activeStorageBlob.createManyAndReturn({ data: Array.from({ length: 2 }, () => ({ key: crypto.randomUUID(), filename: "avatar", byte_size: 1, service_name: "test", created_at: now })) })
      await tx.activeStorageAttachment.createMany({ data: Array.from({ length: 1000 }, () => ({ blob_id: blobs[0].id, record_type: "User", record_id: users[0].id, name: "avatar", created_at: now })) })
      await tx.activeStorageAttachment.create({ data: { blob_id: blobs[1].id, record_type: "User", record_id: users[0].id, name: "avatar", created_at: now } })
      const circleAccess = withTestDependencies(new RoomAccessService(), { prisma: tx })
      const service = withTestDependencies(new RoomsService(), { prisma: tx, circleAccess })
      const result = await service.listMembers(room.id, users[0].id)
      expect(result.members).toHaveLength(2)
      expect(result.members.find(member => member.user_id === users[0].id)).toMatchObject({ display_avatar_url: `/api/v1/uploads/${blobs[1].id}/variants/avatarStripe40`, avatar_url: `/api/v1/uploads/${blobs[1].id}/variants/avatarStripe40` })
      expect(result.members.find(member => member.user_id === users[1].id)).toMatchObject({ display_avatar_url: null, avatar_url: null })
      expect(await tx.activeStorageAttachment.count({ where: { record_type: "User", record_id: users[0].id } })).toBe(1001)
      const activityLifecycle = withTestDependencies(new RoundLifecycleService(), { prisma: tx })
      const roomHome = withTestDependencies(new BoardsDetailService(), { prisma: tx, circleAccess, activityLifecycle })
      const attachmentRead = vi.spyOn(tx.activeStorageAttachment, "findMany").mockRejectedValue(new Error("Room home must not load avatar history"))
      const home = await roomHome.fetchRoomHome(room.id, users[0].id)
      expect(home.members.find(member => member.userId === String(users[0].id))?.avatarUrl).toBe(`/api/v1/uploads/${blobs[1].id}/variants/avatarStripe40`)
      expect(home.members.find(member => member.userId === String(users[1].id))?.avatarUrl).toBeNull()
      expect(attachmentRead).not.toHaveBeenCalled()
      attachmentRead.mockRestore()
      const round = await tx.round.create({ data: { room_id: room.id, host_id: users[0].id, name: "Room Round", status: "active", created_at: now, updated_at: now } })
      const mentions = withTestDependencies(new MentionsService(), { prisma: tx, circleAccess })
      const targets = await mentions.listTargets(room.id, users[0].id)
      expect(targets.targets.find(target => target.target_type === "user" && target.target_id === String(users[0].id))?.avatar_url).toBe(`/api/v1/uploads/${blobs[1].id}/variants/avatarStripe40`)
      expect(targets.targets.find(target => target.target_type === "user" && target.target_id === String(users[1].id))?.avatar_url).toBeNull()
      expect(targets.targets.find(target => target.target_type === "user" && target.target_id === String(users[0].id))?.href).toBe(`/app/rooms/${room.id}/members/${users[0].id}`)
      expect(targets.targets.find(target => target.target_type === "round" && target.target_id === String(round.id))).toMatchObject({ href: `/app/rounds/${round.id}`, subtitle: "Round" })
      await tx.roomMembership.updateMany({ where: { room_id: room.id, user_id: users[0].id }, data: { disabled: true } })
      await expect(mentions.listTargets(room.id, users[0].id)).rejects.toThrow()
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
