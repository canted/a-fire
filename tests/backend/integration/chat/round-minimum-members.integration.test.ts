import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it.each(["create", "start"])("rechecks minimum membership when a member leaves before Round %s commits", async operation => {
  const prisma = new PrismaService(), now = new Date(), users: number[] = []
  for (let index = 0; index < 3; index++) users.push((await prisma.user.create({ data: { email: `${crypto.randomUUID()}@round-minimum.test`, username: "Member", created_at: now, updated_at: now } })).id)
  const room = await prisma.room.create({ data: { name: "Room", owner_id: users[0], created_at: now, updated_at: now } })
  const dates = { submit_by: new Date(now.getTime() + 86400000), feedback_due_at: new Date(now.getTime() + 172800000) }
  const round = operation === "create" ? null : await prisma.round.create({ data: { room_id: room.id, host_id: users[0], name: "Original", template_key: "art_before_chorus", status: "draft", ...dates, created_at: now, updated_at: now } })
  const access = new RoomAccessService(); Object.assign(access, { prisma })
  const notifications = { scheduleActivityNotifications: vi.fn() }
  const service = new RoundsService()
  const transact = prisma.$transaction.bind(prisma)
  const changedTransaction = async (callback: Parameters<PrismaService["$transaction"]>[0]) => {
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: users[2] }, data: { disabled: true } })
    return transact(callback)
  }
  const database = new Proxy(prisma, { get: (target, key) => key === "$transaction" ? changedTransaction : Reflect.get(target, key, target) })
  Object.assign(service, { prisma: database, circleAccess: access, rounds: { syncChat: async () => {} }, notifications, activityLifecycle: { reconcileCircle: vi.fn(), reconcileActivity: vi.fn().mockResolvedValue(false) } })
  const run = () => operation === "create" ? service.createForRoom(room.id, users[0], { name: "New", template_key: "art_before_chorus", status: "active", submit_by: dates.submit_by.toISOString(), feedback_due_at: dates.feedback_due_at.toISOString() }) : service.start(round!.id, users[0])
  try {
    await prisma.roomMembership.createMany({ data: users.map(user_id => ({ room_id: room.id, user_id, created_at: now, updated_at: now })) })
    await expect(run()).rejects.toThrow("needs at least 3 participants")
    if (round) expect(await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).toEqual(round)
    else expect(await prisma.round.count({ where: { room_id: room.id } })).toBe(0)
    expect(notifications.scheduleActivityNotifications).not.toHaveBeenCalled()
    // Retry succeeds once eligibility is restored; no draft or failed allocation survives.
    await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: false } })
    Object.assign(service, { prisma })
    await expect(run()).resolves.toMatchObject({ status: "active" })
    expect(await prisma.round.count({ where: { room_id: room.id, status: "active" } })).toBe(1)
  } finally {
    await prisma.round.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  }
})
