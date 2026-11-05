import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it, vi } from "vitest"
import { replyCreatedNotificationData } from "@server/api/v1/replies/reply-notification"
import { EntryNotificationsService } from "@server/api/v1/entries/entry-notifications.service"

it("scopes publication effects to the Entry Room and suppresses unscoped events", async () => {
  const prisma = new PrismaClient(), now = new Date(), rollback = new Error("Rollback notification scope")
  try {
    await prisma.$transaction(async tx => {
      const author = await tx.user.create({ data: { email: `${crypto.randomUUID()}@publication-scope.test`, username: "Author", created_at: now, updated_at: now } })
      const reader = await tx.user.create({ data: { email: `${crypto.randomUUID()}@publication-scope.test`, username: "Reader", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: reader.id, created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { user_id: author.id, room_id: room.id, status: "published", published_at: now, created_at: now, updated_at: now } })
      const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: `user:${reader.id}` } }] }] }
      const enqueue = vi.fn().mockResolvedValue("job")
      const service = new EntryNotificationsService()
      Object.assign(service, { prisma: tx, boss: { enqueueInTransaction: enqueue } })
      expect(await service.createPostNotification(post, content, tx)).toMatchObject({ room_id: room.id, entry_id: post.id })
      expect(await service.createMentionNotifications(post, content, tx)).toEqual([expect.objectContaining({ room_id: room.id, target_user_id: reader.id })])
      const messageId = await service.createDirectChatAnnouncement(post, content, now, tx)
      expect(await tx.chatMessage.findUnique({ where: { id: messageId! } })).toMatchObject({ room_id: room.id, entry_id: post.id })
      expect(enqueue).toHaveBeenCalledOnce()
      expect(await service.createChatPreservationNotification(post, messageId!, content, now, tx)).toMatchObject({ room_id: room.id })
      const reply = await tx.reply.create({ data: { entry_id: post.id, user_id: reader.id, status: "published", created_at: now, updated_at: now } })
      const replyData = replyCreatedNotificationData(reply.id, reader.id, post, content)
      expect(replyData).toMatchObject({ room_id: room.id, entry_id: post.id, target_path: `/app/entries/${post.id}#reply-${reply.id}` })
      expect(replyData).not.toHaveProperty("board_id")
      expect(replyData).not.toHaveProperty("square_id")
      await tx.notificationEvent.create({ data: replyData! })
      const retained = await tx.notificationEvent.findMany({ where: { entry_id: post.id }, orderBy: { id: "asc" } })
      expect(retained.every(event => event.room_id === room.id)).toBe(true)
      const unscoped = { ...post, room_id: null }
      expect(await service.createPostNotification(unscoped, content, tx)).toBeNull()
      expect(await service.createMentionNotifications(unscoped, content, tx)).toEqual([])
      expect(await service.createDirectChatAnnouncement(unscoped, content, now, tx)).toBeNull()
      expect(await service.createChatPreservationNotification(unscoped, messageId!, content, now, tx)).toBeNull()
      expect(await tx.notificationEvent.findMany({ where: { entry_id: post.id }, orderBy: { id: "asc" } })).toEqual(retained)
      expect(enqueue).toHaveBeenCalledOnce()
      await tx.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: true } })
      expect(await service.createMentionNotifications(post, content, tx)).toEqual([])
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
