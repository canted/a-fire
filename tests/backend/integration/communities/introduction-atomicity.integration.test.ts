import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { IntroductionsService } from "@server/api/v1/introductions/introductions.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

import { BossWorkers } from "@server/queue/boss.workers"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { NotificationDeliveryService } from "@server/notifications/notification-delivery.service"
import { NotificationInboxSerializer } from "@server/notifications/notification-inbox.serializer"

it("rolls back partial introduction jobs and serializes concurrent retries", async () => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date()
  await boss.start()
  const users = await prisma.user.createManyAndReturn({ data: Array.from({ length: 3 }, () => ({ email: `${crypto.randomUUID()}@intro-atomic.test`, username: "Fixture", created_at: now, updated_at: now })) })
  const room = await prisma.room.create({ data: { name: "Introduction Room", owner_id: users[0].id, created_at: now, updated_at: now } })
  const jobs: string[] = []
  const persist = boss.enqueueInTransaction.bind(boss)
  let fail = true, attempts = 0
  const enqueue = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
    const id = await persist(...args)
    jobs.push(id)
    if (fail && ++attempts === 2) throw new Error("after second job insertion")
    return id
  })
  try {
    await prisma.roomMembership.createMany({ data: users.map(user => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
    const service = withTestDependencies(new IntroductionsService(), { prisma, boss })
    const input = { room_id: room.id, recipient_user_ids: users.slice(1).map(user => user.id), note: "Shared interests" }
    await expect(service.create(users[0].id, input)).rejects.toThrow("after second job insertion")
    expect(await prisma.introduction.count({ where: { room_id: room.id } })).toBe(0)
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(0)
    for (const id of jobs) expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${id}::uuid`).toEqual([])
    fail = false
    enqueue.mockClear()
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => service.create(users[0].id, { ...input, recipient_user_ids: index % 2 ? [...input.recipient_user_ids].reverse() : input.recipient_user_ids })))
    expect(new Set(results.map(result => result.introduction.id)).size).toBe(1)
    expect(await prisma.introduction.count({ where: { room_id: room.id } })).toBe(1)
    expect(await prisma.introductionRecipient.count({ where: { introduction: { room_id: room.id } } })).toBe(2)
    const events = await prisma.notificationEvent.findMany({ where: { room_id: room.id } })
    expect(events.map(event => event.target_user_id).sort()).toEqual(input.recipient_user_ids.sort())
    expect(enqueue).toHaveBeenCalledTimes(2)
    for (const id of jobs.slice(-2)) expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${id}::uuid`).toHaveLength(1)
    const circleAccess = withTestDependencies(new RoomAccessService(), { prisma })
    const inboxSerializer = withTestDependencies(new NotificationInboxSerializer(), { prisma, circleAccess })
    const delivery = withTestDependencies(new NotificationDeliveryService(), { prisma, circleAccess, inboxSerializer,
      unseenContent: { countForUser: async () => ({ total: 0 }) },
      realtime: { emit: vi.fn(), notificationRoom: (id: number) => `notification:${id}` },
    })
    const workers = withTestDependencies(new BossWorkers(), { prisma, boss, notificationDelivery: delivery,
      notificationPreferences: { resolveForUser: async () => ({ notificationType: "all", deliveryMode: "immediate", pushEnabled: false }), allowsEvent: () => true },
    })
    for (const event of events) {
      await workers.handleNotificationFanout({ eventId: event.id })
      await workers.handleNotificationFanout({ eventId: event.id })
    }
    expect(await prisma.notificationInboxItem.count({ where: { notification_event: { room_id: room.id } } })).toBe(2)
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: users[0].id }, data: { disabled: true } })
    await expect(service.create(users[0].id, input)).rejects.toThrow("Not authorized")
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(2)
  } finally {
    enqueue.mockRestore()
    for (const id of jobs) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.notificationInboxItem.deleteMany({ where: { notification_event: { room_id: room.id } } })
    await prisma.notificationEvent.deleteMany({ where: { room_id: room.id } })
    await prisma.introduction.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await boss.onModuleDestroy()
    await prisma.$disconnect()
  }
})
