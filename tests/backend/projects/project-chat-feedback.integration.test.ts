import { Prisma, PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { loadProjectActivity } from "@server/api/v1/projects/project-activity"
import { availableChatAttachmentSql, findAvailableChatAttachment } from "@server/api/v2/rooms/chat-visibility"

it("Project feedback follows Chat attachment visibility without expiring independent Room copies", async () => {
  const database = new PrismaClient(), rollback = new Error("Rollback Project Chat feedback")
  const now = new Date(), day = 86400000, before = new Date(+now - day)
  try {
    await database.$transaction(async tx => {
      // Stored timestamps are UTC even when the connection uses another zone.
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@project-chat.test`, username: "Owner", created_at: before, updated_at: before } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Project", created_at: before, updated_at: before } })
      const room = await tx.room.create({ data: { name: "Room", created_at: before, updated_at: before } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, unseen_started_at: before, created_at: before, updated_at: before } })
      const source = await tx.entry.create({ data: { project_id: project.id, user_id: user.id, creation_origin: "project_material", status: "published", created_at: before, updated_at: before } })
      const post = await tx.entry.create({ data: { source_entry_id: source.id, room_id: room.id, user_id: user.id, creation_origin: "chat_attachment", status: "published", created_at: now, published_at: now, updated_at: now } })
      const reply = await tx.reply.create({ data: { entry_id: post.id, status: "published", published_at: now, created_at: now, updated_at: now } })
      const message = await tx.chatMessage.create({ data: { entry_id: post.id, room_id: room.id, author_id: user.id, body: "", masked_alias: "", content: { type: "image" }, created_at: now, updated_at: now, fire_at: now, expires_at: new Date(+now + day) } })
      const defaults = { content: { type: "image" }, created_at: now, expires_at: new Date(+now + day), status: "published", timeline_kind: "message", pinned_at: null }
      const cases: Array<{ label: string; change: Prisma.ChatMessageUpdateInput; visible: boolean }> = [
        { label: "available image", change: {}, visible: true },
        { label: "inside lifetime", change: { created_at: new Date(+now - 13 * day) }, visible: true },
        { label: "expired", change: { expires_at: now }, visible: false },
        { label: "fourteen days despite pin", change: { created_at: new Date(+now - 14 * day), pinned_at: now }, visible: false },
        { label: "deleted", change: { status: "deleted" }, visible: false },
        { label: "system event", change: { timeline_kind: "system" }, visible: false },
        { label: "text only", change: { content: { type: "doc", content: [{ type: "text", text: "image" }] } }, visible: false },
        { label: "attachment in attributes is not content", change: { content: { type: "doc", attrs: { content: { type: "image" } } } }, visible: false },
        { label: "nested content object", change: { content: { content: { type: "audio" } } }, visible: true },
        { label: "nested content arrays", change: { content: [[{ content: [{ type: "file" }] }]] }, visible: true },
        { label: "null content", change: { content: Prisma.JsonNull }, visible: false },
      ]
      for (const item of cases) {
        await tx.chatMessage.update({ where: { id: message.id }, data: { ...defaults, ...item.change } })
        const [sql] = await tx.$queryRaw<Array<{ visible: boolean }>>(Prisma.sql`SELECT ${availableChatAttachmentSql(Prisma.sql`${post.id}`, Prisma.sql`${room.id}`, now)} AS visible`)
        expect(sql.visible, item.label).toBe(item.visible)
        expect(Boolean(await findAvailableChatAttachment(tx, post.id, room.id, now)), item.label).toBe(item.visible)
        const summary = (await loadProjectActivity(tx, [project.id], user.id)).get(project.id)!
        expect(summary.unread_feedback_count, item.label).toBe(item.visible ? 1 : 0)
        expect(summary.latest_unread_feedback?.reply_id ?? null, item.label).toBe(item.visible ? reply.id : null)
      }
      await tx.entry.update({ where: { id: post.id }, data: { creation_origin: null } })
      expect((await loadProjectActivity(tx, [project.id], user.id)).get(project.id)?.unread_feedback_count).toBe(1)
      expect(await tx.reply.findUniqueOrThrow({ where: { id: reply.id } })).toEqual(reply)
      throw rollback
    }, { timeout: 20000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await database.$disconnect() }
}, 30000)
