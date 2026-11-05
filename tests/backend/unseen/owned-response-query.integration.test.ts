import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it, vi } from "vitest"
import { UnseenContentService } from "@server/api/v1/unseen/unseen-content.service"

it("filters response candidates by owned published Entries inside the database", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback response query fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const owner = await tx.user.create({ data: { email: `${crypto.randomUUID()}@response-query.test`, username: "Owner", created_at: now, updated_at: now } })
      const peer = await tx.user.create({ data: { email: `${crypto.randomUUID()}@response-query.test`, username: "Peer", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      const otherRoom = await tx.room.create({ data: { name: "Other", created_at: now, updated_at: now } })
      const accepted: number[] = []
      for (const variant of ["owned", "other-author", "deleted", "other-room", "seen", "other-recipient", "wrong-event-room"]) {
        const post = await tx.entry.create({ data: { user_id: variant === "other-author" ? peer.id : owner.id,
          room_id: variant === "other-room" ? otherRoom.id : room.id, status: variant === "deleted" ? "deleted" : "published", created_at: now, updated_at: now } })
        const event = await tx.notificationEvent.create({ data: { event_type: "reply_created", actor_id: peer.id, room_id: variant === "wrong-event-room" ? otherRoom.id : room.id, entry_id: post.id, created_at: now, updated_at: now } })
        const item = await tx.notificationInboxItem.create({ data: { user_id: variant === "other-recipient" ? peer.id : owner.id, notification_event_id: event.id,
          seen_at: variant === "seen" ? now : null, created_at: now, updated_at: now } })
        if (variant === "owned") accepted.push(item.id)
      }
      const serialize = vi.fn(async (items: Array<{ id: number }>) => {
        expect(items.map(item => item.id)).toEqual(accepted)
        return [{ contentSeen: false, notificationEvent: { eventType: "reply_created", entryId: "1", replyId: "2" } }]
      })
      const service = new UnseenContentService()
      Object.assign(service, { prisma: tx, inboxSerializer: { serialize } })
      expect(await service.countResponsesToOwnPosts(owner.id, [room.id])).toBe(1)
      expect(serialize).toHaveBeenCalledTimes(1)
      expect(await service.countResponsesToOwnPosts(owner.id, [])).toBe(0)
      expect(serialize).toHaveBeenCalledTimes(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("continues unread scanning when the preceding batch anchor is removed", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback cursor fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@cursor-query.test`, username: "Reader", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      const events = await tx.notificationEvent.createManyAndReturn({ data: Array.from({ length: 251 }, () => ({ event_type: "post_created", actor_id: user.id, room_id: room.id, created_at: now, updated_at: now })) })
      await tx.notificationInboxItem.createMany({ data: events.map(event => ({ user_id: user.id, notification_event_id: event.id, created_at: now, updated_at: now })) })
      let batches = 0
      const serialize = vi.fn(async (items: Array<{ id: number }>) => {
        if (++batches === 1) await tx.notificationInboxItem.delete({ where: { id: items.at(-1)!.id } })
        return items.map(item => ({ id: String(item.id), contentSeen: false, notificationEvent: { eventType: "post_created" } }))
      })
      const service = new UnseenContentService()
      Object.assign(service, { prisma: tx, inboxSerializer: { serialize } })
      // This is a live scan, not snapshot isolation: already-observed rows count.
      expect(await service.countForUser(user.id)).toEqual({ total: 251, entries: 251, replies: 0 })
      expect(serialize.mock.calls.map(([items]) => items.length)).toEqual([250, 1])
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
