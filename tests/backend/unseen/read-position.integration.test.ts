import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it, vi } from "vitest"
import { UnseenContentService } from "@server/api/v1/unseen/unseen-content.service"

it("merges delayed read positions without regressing either cursor", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback read positions"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`
      const user = await tx.user.create({ data: { username: "Reader", email: `${crypto.randomUUID()}@read-position.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Read positions", created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { user_id: user.id, room_id: room.id, created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", created_at: now, updated_at: now } })
      const at = new Date("2026-01-02T00:00:00Z")
      const replies = []
      for (let i = 0; i < 3; i++) replies.push(await tx.reply.create({ data: { entry_id: post.id, user_id: user.id, status: "published", published_at: i === 0 ? new Date("2026-01-01T00:00:00Z") : at, created_at: now, updated_at: now } }))
      const service = new UnseenContentService()
      Object.assign(service, { prisma: tx })
      vi.spyOn(service, "countForUser").mockResolvedValue({ total: 0, entries: 0, replies: 0 })
      const where = { user_id_entry_id: { user_id: user.id, entry_id: post.id } }
      // Delay the older request immediately before its database mutation. The
      // newer request creates the row first, exercising the insert-conflict path.
      let release!: () => void, reached!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const ready = new Promise<void>(resolve => { reached = resolve })
      const delayed = new UnseenContentService()
      Object.assign(delayed, { prisma: { entry: tx.entry, roomMembership: tx.roomMembership, reply: tx.reply,
        $executeRaw: async (query: Parameters<typeof tx.$executeRaw>[0]) => { reached(); await gate; return tx.$executeRaw(query) },
      } })
      vi.spyOn(delayed, "countForUser").mockResolvedValue({ total: 0, entries: 0, replies: 0 })
      const oldRequest = delayed.markPostSeen(user.id, post.id, { postVisible: true, replyIds: [replies[0].id] })
      await ready
      const newest = await (async () => {
        try {
          await service.markPostSeen(user.id, post.id, { postVisible: true, replyIds: [replies[2].id] })
          return await tx.entryViewState.findUniqueOrThrow({ where })
        } finally { release() }
      })()
      await oldRequest
      expect(await tx.entryViewState.findUniqueOrThrow({ where })).toMatchObject({
        entry_seen_at: newest.entry_seen_at, reply_seen_through_at: at, reply_seen_through_id: replies[2].id,
      })
      // Equal timestamps use the reply ID as the tie-breaker; post-only writes
      // and older reply-only writes must preserve the other dimension.
      await service.markPostSeen(user.id, post.id, { replyIds: [replies[1].id] })
      await service.markPostSeen(user.id, post.id, { postVisible: true })
      expect(await tx.entryViewState.findUniqueOrThrow({ where })).toMatchObject({ reply_seen_through_at: at, reply_seen_through_id: replies[2].id })
      expect(await tx.entryViewState.count({ where: { user_id: user.id, entry_id: post.id } })).toBe(1)
      throw rollback
    }, { timeout: 10000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("marks eligible content with UTC timestamps and preserves later read positions", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback mark all"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`
      const user = await tx.user.create({ data: { username: "Reader", email: `${crypto.randomUUID()}@mark-all.test`, created_at: now, updated_at: now } })
      const peer = await tx.user.create({ data: { username: "Peer", email: `${crypto.randomUUID()}@mark-all.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Read all", created_at: now, updated_at: now } })
      const start = new Date("2026-01-01T00:00:00Z"), published = new Date("2026-01-02T00:00:00Z")
      await tx.roomMembership.create({ data: { user_id: user.id, room_id: room.id, unseen_started_at: start, created_at: now, updated_at: now } })
      const posts = []
      for (const variant of ["eligible", "draft", "before-membership", "no-room"]) posts.push(await tx.entry.create({ data: {
        user_id: peer.id, room_id: variant === "no-room" ? null : room.id,
        status: variant === "draft" ? "draft" : "published", published_at: variant === "before-membership" ? start : published,
        created_at: now, updated_at: now,
      } }))
      const replies = []
      for (let i = 0; i < 2; i++) replies.push(await tx.reply.create({ data: { entry_id: posts[0].id, user_id: peer.id, status: "published", published_at: published, created_at: now, updated_at: now } }))
      const service = new UnseenContentService()
      Object.assign(service, { prisma: tx })
      vi.spyOn(service, "countForUser").mockResolvedValue({ total: 0, entries: 0, replies: 0 })
      const event = await tx.notificationEvent.create({ data: { event_type: "post_created", entry_id: posts[0].id, actor_id: peer.id, room_id: room.id, created_at: now, updated_at: now } })
      const item = await tx.notificationInboxItem.create({ data: { notification_event_id: event.id, user_id: user.id, created_at: now, updated_at: now } })
      // A fixture-specific database rejection forces the inbox write to fail.
      // Rolling back to this savepoint must leave no partial read-state write.
      await tx.$executeRaw`SAVEPOINT before_mark_all`
      await tx.$executeRawUnsafe(`ALTER TABLE notification_inbox_items ADD CONSTRAINT test_reject_mark_all CHECK (id <> ${item.id} OR seen_at IS NULL) NOT VALID`)
      await expect(service.markAllSeen(user.id)).rejects.toThrow()
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT before_mark_all`
      expect(await tx.entryViewState.count({ where: { user_id: user.id } })).toBe(0)
      expect((await tx.notificationInboxItem.findUniqueOrThrow({ where: { id: item.id } })).seen_at).toBeNull()
      const before = new Date()
      await service.markAllSeen(user.id)
      const after = new Date()
      expect((await tx.notificationInboxItem.findUniqueOrThrow({ where: { id: item.id } })).seen_at?.getTime()).toBeGreaterThanOrEqual(before.getTime())
      const rows = await tx.entryViewState.findMany({ where: { user_id: user.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ entry_id: posts[0].id, reply_seen_through_at: published, reply_seen_through_id: replies[1].id })
      for (const at of [rows[0].entry_seen_at!, rows[0].created_at, rows[0].updated_at]) {
        expect(at.getTime()).toBeGreaterThanOrEqual(before.getTime())
        expect(at.getTime()).toBeLessThanOrEqual(after.getTime())
      }
      const future = new Date(after.getTime() + 60_000)
      await tx.entryViewState.update({ where: { id: rows[0].id }, data: { entry_seen_at: future, reply_seen_through_at: future, reply_seen_through_id: replies[1].id, updated_at: future } })
      await service.markAllSeen(user.id)
      expect(await tx.entryViewState.findUniqueOrThrow({ where: { id: rows[0].id } })).toMatchObject({ entry_seen_at: future, reply_seen_through_at: future, updated_at: future })
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
