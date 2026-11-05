import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { NotificationDeliveryService } from "@server/notifications/notification-delivery.service"

it("allocates one push delivery under worker races and preserves completed delivery state on replay", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@push-race.test`, username: "Recipient", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const event = await prisma.notificationEvent.create({ data: { event_type: "post_created", actor_id: user.id, room_id: room.id, created_at: now, updated_at: now } })
  const inbox = await prisma.notificationInboxItem.create({ data: { user_id: user.id, notification_event_id: event.id, created_at: now, updated_at: now } })
  const service = new NotificationDeliveryService(); Object.assign(service, { prisma })
  const allocate = (dueAt = now) => (service as any).findOrCreatePushDelivery(user.id, event.id, inbox.id, dueAt, new Date())
  try {
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => allocate()))
    expect(attempts.every(attempt => attempt.status === "fulfilled")).toBe(true)
    const deliveries = attempts.map(attempt => { if (attempt.status === "rejected") throw attempt.reason; return attempt.value })
    expect(new Set(deliveries.map(row => row.id)).size).toBe(1)
    expect(await prisma.notificationPushDelivery.count({ where: { notification_inbox_item_id: inbox.id } })).toBe(1)
    const sent = await prisma.notificationPushDelivery.update({ where: { id: deliveries[0].id }, data: { state: "sent", sent_at: now, scheduled_job_id: crypto.randomUUID(), last_error: "Retained diagnostic", updated_at: now } })
    expect(await allocate(new Date(now.getTime() + 60000))).toEqual(sent)
    expect(await prisma.notificationPushDelivery.findUniqueOrThrow({ where: { id: sent.id } })).toEqual(sent)
  } finally {
    await prisma.notificationPushDelivery.deleteMany({ where: { notification_inbox_item_id: inbox.id } })
    await prisma.notificationInboxItem.delete({ where: { id: inbox.id } })
    await prisma.notificationEvent.delete({ where: { id: event.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
