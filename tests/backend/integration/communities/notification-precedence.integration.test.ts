import { NotificationDeliveryService } from "@server/notifications/notification-delivery.service"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { MembershipsService } from "@server/api/v1/memberships/memberships.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaClient } from "@prisma/client"
import { NotificationPreferencesService } from "@server/notifications/notification-preferences.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("preserves Entry, Room and Global delivery precedence", async () => {
  const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] }), now = new Date()
  const queries: string[] = []
  prisma.$on("query", event => queries.push(event.query))
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@preferences.test`, username: "Preference", created_at: now, updated_at: now } })
  const service = withTestDependencies(new NotificationPreferencesService(), { prisma })
  const event = {
    entry_id: 110, room_id: 440,
  } as unknown as Parameters<NotificationPreferencesService["resolveForUser"]>[1]
  const scopes = [
    { scope_type: "Post", scope_id: 110, notification_type: "none", delivery_mode: "immediate", push_enabled: false },
    { scope_type: "Circle", scope_id: 440, notification_type: "all", delivery_mode: "immediate", push_enabled: false },
    { scope_type: "Global", scope_id: null, notification_type: "none", delivery_mode: "mute", push_enabled: false },
  ]
  try {
    // Reverse insertion proves physical row order does not determine scope precedence.
    for (const preference of scopes.toReversed()) {
      await prisma.notificationPreference.create({ data: { ...preference, user_id: user.id, created_at: now, updated_at: now } })
    }
    for (const preference of scopes) {
      queries.length = 0
      const effective = await service.resolveForUser(user.id, event)
      expect(queries).toHaveLength(1)
      expect(effective).toEqual({ notificationType: preference.notification_type, deliveryMode: preference.delivery_mode, pushEnabled: preference.push_enabled })
      if (preference.notification_type === "none" || preference.delivery_mode === "mute") {
        expect(service.allowsEvent(effective, "mention")).toBe(false)
      }
      await prisma.notificationPreference.deleteMany({ where: { user_id: user.id, scope_type: preference.scope_type } })
    }
    expect(await service.resolveForUser(user.id, event)).toEqual({ notificationType: "all", deliveryMode: "immediate", pushEnabled: true })
  } finally {
    await prisma.notificationPreference.deleteMany({ where: { user_id: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})

it("serializes first preference saves and rejects removed membership or deleted Rooms", async () => {
  const prisma = new PrismaClient(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@preferences.test`, username: "Preference", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Preferences", owner_id: user.id, created_at: now, updated_at: now } })
  const membership = await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const service = withTestDependencies(new NotificationPreferencesService(), { prisma })
  const profiles = withTestDependencies(new MembershipsService(), { prisma })
  const storage = { put: vi.fn(), delete: vi.fn() }
  const uploads = withTestDependencies(new UploadsService(), { prisma, storage })
  const avatar = { record_type: "CircleMembership", record_id: membership.id, name: "avatar" }
  const file = { buffer: Buffer.from("unvalidated"), mimetype: "image/png", originalname: "avatar.png" } as Express.Multer.File
  try {
    await Promise.all([service.updateForUser(user.id, room.id, "none"), service.updateForUser(user.id, room.id, "posts")])
    const where = { user_id: user.id, scope_type: "Circle", scope_id: room.id }
    expect(await prisma.notificationPreference.count({ where })).toBe(1)
    const retained = await prisma.notificationPreference.findFirstOrThrow({ where })
    const originalFind = prisma.roomMembership.findUnique.bind(prisma.roomMembership)
    const accessCheck = vi.spyOn(prisma.roomMembership, "findUnique").mockImplementationOnce((async (args: Parameters<typeof originalFind>[0]) => {
      const result = await originalFind(args)
      await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      return result
    }) as unknown as typeof originalFind)
    const attachmentDelete = vi.spyOn(prisma.activeStorageAttachment, "deleteMany")
    await expect(uploads.removeAttachment(user.id, avatar)).rejects.toThrow("Forbidden")
    expect(attachmentDelete).not.toHaveBeenCalled()
    accessCheck.mockRestore()
    attachmentDelete.mockRestore()
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })

    expect((await service.listForUser(user.id)).items.map(item => item.room_id)).toEqual([room.id])
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
    await expect(service.updateForUser(user.id, room.id, "all")).rejects.toThrow("Not Found")
    expect(await service.listForUser(user.id)).toEqual({ items: [] })
    await expect(profiles.update(user.id, membership.id, { username_override: "Changed" })).rejects.toThrow("Not Found")
    await expect(uploads.createAttachmentUpload(user.id, file, avatar)).rejects.toThrow("Forbidden")
    await expect(uploads.removeAttachment(user.id, avatar)).rejects.toThrow("Forbidden")
    expect(storage.put).not.toHaveBeenCalled()
    expect(storage.delete).not.toHaveBeenCalled()
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: new Date() } })
    await expect(service.updateForUser(user.id, room.id, "all")).rejects.toThrow("Community not found")
    expect(await service.listForUser(user.id)).toEqual({ items: [] })
    await expect(profiles.update(user.id, membership.id, { username_override: "Changed" })).rejects.toThrow("Not Found")
    await expect(uploads.createAttachmentUpload(user.id, file, avatar)).rejects.toThrow("Forbidden")
    await expect(uploads.removeAttachment(user.id, avatar)).rejects.toThrow("Forbidden")
    expect(storage.put).not.toHaveBeenCalled()
    expect(storage.delete).not.toHaveBeenCalled()
    expect(await prisma.notificationPreference.findFirstOrThrow({ where })).toEqual(retained)
    expect((await profiles.list(user.id)).memberships).toEqual([])
    expect((await prisma.roomMembership.findUniqueOrThrow({ where: { id: membership.id } })).username_override).toBeNull()
  } finally {
    await prisma.notificationPreference.deleteMany({ where: { user_id: user.id } })
    await prisma.roomMembership.delete({ where: { id: membership.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})


it.each([
  { notification_type: "none", delivery_mode: "immediate", push_enabled: true },
  { notification_type: "all", delivery_mode: "mute", push_enabled: true },
  { notification_type: "posts", delivery_mode: "immediate", push_enabled: true },
  { notification_type: "all", delivery_mode: "immediate", push_enabled: false },
])("cancels a scheduled reply push after persisted preferences change to %j", async settings => {
  const prisma = new PrismaClient(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@preferences.test`, username: "Preference", created_at: now, updated_at: now } })
  const preferences = withTestDependencies(new NotificationPreferencesService(), { prisma })
  const event = { id: 123, event_type: "reply_created", room_id: 440, entry_id: null } as unknown as Parameters<NotificationPreferencesService["resolveForUser"]>[1]
  const deliveryState = { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue({ id: 321, user_id: user.id, state: "scheduled", notification_event: event }), update: vi.fn() }
  const countForUser = vi.fn()
  const delivery = withTestDependencies(new NotificationDeliveryService(), {
    prisma: { notificationPushDelivery: deliveryState }, preferences,
    realtime: { isUserActive: () => false }, unseenContent: { countForUser },
  })
  try {
    const before = await preferences.resolveForUser(user.id, event)
    expect(before.pushEnabled && preferences.allowsEvent(before, event.event_type)).toBe(true)
    await prisma.notificationPreference.create({ data: { ...settings, user_id: user.id, scope_type: "Circle", scope_id: 440, created_at: now, updated_at: now } })
    await delivery.handleDelayedPush(321)
    expect(deliveryState.update).toHaveBeenCalledWith({ where: { id: 321 }, data: expect.objectContaining({ state: "cancelled", skip_reason: "preferences_changed" }) })
    expect(countForUser).not.toHaveBeenCalled()
  } finally {
    await prisma.notificationPreference.deleteMany({ where: { user_id: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
