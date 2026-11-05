import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("creates and manages Room-owned Rounds without a Board and denies removed membership", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@room-round-list.test`, username: "Member", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room without Board", owner_id: user.id, porosity: "closed", created_at: now, updated_at: now } })
  const access = new RoomAccessService(); Object.assign(access, { prisma })
  const database = prisma
  const lifecycle = new RoundLifecycleService(); Object.assign(lifecycle, { prisma: database })
  const service = new RoundsService(); Object.assign(service, { prisma: database, circleAccess: access, activityLifecycle: lifecycle, notifications: { scheduleActivityNotifications: async () => {} }, rounds: { syncChat: async () => {} } })
  try {
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
    expect(await service.listForRoom(room.id, user.id)).toMatchObject({ currentRounds: [], recentRounds: [], activeRound: null, nextRound: null, viewerAccess: { kind: "member" } })
    const created = await service.createForRoom(room.id, user.id, { name: "Room owned", status: "draft" })
    expect(created).not.toHaveProperty("boardId")
    const id = Number(created.id)
    expect((await service.update(id, user.id, { name: "Edited" })).name).toBe("Edited")
    await service.start(id, user.id)
    expect((await service.listForRoom(room.id, user.id)).currentRounds.map(item => item.id)).toEqual([created.id])
    await service.archive(id, user.id)
    expect(await prisma.roundResult.count({ where: { round_id: id } })).toBe(1)
    await expect(prisma.round.create({ data: { room_id: null, host_id: user.id, name: "Unscoped", created_at: now, updated_at: now } })).rejects.toThrow()
    await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: true } })
    await expect(service.listForRoom(room.id, user.id)).rejects.toThrow("Forbidden")
  } finally {
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.roundResult.deleteMany({ where: { room_id: room.id } })
    await prisma.round.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
