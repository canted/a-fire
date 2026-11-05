import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { NotificationPreferencesService } from "@server/notifications/notification-preferences.service"

it("resolves Entry, Room and global notification preferences in order", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@scope-preservation.test`, username: "Recipient", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", created_at: now, updated_at: now } })
  const service = new NotificationPreferencesService()
  Object.assign(service, { prisma })
  const eventIds: number[] = []
  const event = async (postId: number | null) => {
    const result = await prisma.notificationEvent.create({ data: { actor_id: user.id, room_id: room.id, entry_id: postId, event_type: "post_created", created_at: now, updated_at: now }, include: { actor: true, room: true } })
    eventIds.push(result.id)
    return result
  }
  const preference = (scope_type: string, scope_id: number | null, notification_type: string, delivery_mode: string, push_enabled: boolean) => prisma.notificationPreference.create({ data: { user_id: user.id, scope_type, scope_id, notification_type, delivery_mode, push_enabled, created_at: now, updated_at: now } })
  try {
    const entryEvent = await event(post.id)
    const roomOnly = await event(null)
    // Insert in reverse policy order so database row order cannot determine precedence.
    await preference("Global", null, "all", "immediate", true)
    const circlePreference = await preference("Circle", room.id, "posts", "immediate", false)
    const postPreference = await preference("Post", post.id, "all", "immediate", false)
    expect(await service.resolveForUser(user.id, entryEvent)).toEqual({ notificationType: "all", deliveryMode: "immediate", pushEnabled: false })
    expect(await service.resolveForUser(user.id, roomOnly)).toEqual({ notificationType: "posts", deliveryMode: "immediate", pushEnabled: false })
    await prisma.notificationPreference.delete({ where: { id: postPreference.id } })
    expect(await service.resolveForUser(user.id, entryEvent)).toEqual({ notificationType: "posts", deliveryMode: "immediate", pushEnabled: false })
    await prisma.notificationPreference.delete({ where: { id: circlePreference.id } })
    expect(await service.resolveForUser(user.id, entryEvent)).toEqual({ notificationType: "all", deliveryMode: "immediate", pushEnabled: true })
  } finally {
    await prisma.notificationPreference.deleteMany({ where: { user_id: user.id } })
    await prisma.notificationEvent.deleteMany({ where: { id: { in: eventIds } } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
