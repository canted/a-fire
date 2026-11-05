import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RepliesService } from "@server/api/v1/replies/replies.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["create", "update", "publish"] as const)("rejects %s after reply metadata or its document changes during preparation", async operation => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@reply-save.test`, username: "Reviewer", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { room_id: room.id, user_id: user.id, status: "published", created_at: now, updated_at: now } })
  const reply = await prisma.reply.create({ data: { entry_id: post.id, user_id: user.id, status: "draft", created_at: now, updated_at: now } })
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
  const changed = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Newer edit" }] }] }
  const document = await prisma.document.create({ data: { docable_type: "Reply", docable_id: reply.id, content, version: 1, created_at: now, updated_at: now } })
  const apply = vi.fn()
  const previews = { prepareAttachment: vi.fn(), applyPreparedAttachment: apply, serializeAttachment: vi.fn().mockResolvedValue(null) }
  const circleAccess = withTestDependencies(new RoomAccessService(), { prisma })
  const service = withTestDependencies(new RepliesService(), { prisma, circleAccess, linkPreviews: previews })
  try {
    await prisma.$transaction(async tx => {
      await tx.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: true } })
      expect(await circleAccess.resolve(room.id, user.id, new Date(), tx)).toBeNull()
      // A separate connection still sees committed membership: transaction propagation matters.
      expect(await circleAccess.resolve(room.id, user.id)).toMatchObject({ kind: "member" })
      await tx.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: false } })
    })
    if (operation !== "create") {
      for (const expected_revision of [now.getTime() - 1, -1, null, "stale", 1.5]) {
        await expect(service[operation](post.id, reply.id, user.id, { content, expected_revision })).rejects.toThrow(expected_revision === now.getTime() - 1 ? "changed elsewhere" : "Invalid reply revision")
      }
      expect(previews.prepareAttachment).not.toHaveBeenCalled()
      expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(content)
    }
    const forged = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: "2147483647", label: "Unavailable Note" } }] }] }
    previews.prepareAttachment.mockResolvedValue(null)
    await expect(operation === "create" ? service.create(post.id, user.id, { content: forged }) : service[operation](post.id, reply.id, user.id, { content: forged })).rejects.toThrow("Mention unavailable")
    expect(await prisma.reply.count({ where: { entry_id: post.id } })).toBe(1)
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(content)
    expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(0)
    expect(apply).not.toHaveBeenCalled()
    for (const change of operation === "create" ? ["parent", "membership"] : ["metadata", "document", "parent", "membership"]) {
      previews.prepareAttachment.mockImplementationOnce(async () => {
        if (change === "metadata") await prisma.reply.update({ where: { id: reply.id }, data: { updated_at: new Date(now.getTime() + 1) } })
        if (change === "parent") await prisma.entry.update({ where: { id: post.id }, data: { status: "deleted" } })
        if (change === "membership") await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: true } })
        if (change === "document") await prisma.document.update({ where: { id: document.id }, data: { content: changed } })
        return null
      })
      const saving = operation === "create" ? service.create(post.id, user.id, { content }) : service[operation](post.id, reply.id, user.id, { content })
      await expect(saving).rejects.toThrow(change === "parent" ? "Replies belong to published circle entries" : change === "membership" ? "Forbidden" : "This reply changed before saving")
      expect(await prisma.reply.count({ where: { entry_id: post.id } })).toBe(1)
      expect((await prisma.reply.findUniqueOrThrow({ where: { id: reply.id } })).status).toBe("draft")
      expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(change === "document" ? changed : content)
      expect(apply).not.toHaveBeenCalled()
      expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(0)
      await prisma.entry.update({ where: { id: post.id }, data: { status: "published" } })
      await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: false } })
      await prisma.reply.update({ where: { id: reply.id }, data: { updated_at: now } })
      await prisma.document.update({ where: { id: document.id }, data: { content } })
    }
    if (operation === "update") {
      const changed = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Newer edit" }, { type: "mention", attrs: { targetType: "user", targetId: String(user.id), label: "Reviewer", href: "/app/note/999" } }] }] }
      const saved = await service.update(post.id, reply.id, user.id, { content: changed, expected_revision: now.getTime() })
      expect(saved.revision).toBeGreaterThan(now.getTime())
      expect(saved.revision).toBe((await prisma.reply.findUniqueOrThrow({ where: { id: reply.id } })).updated_at.getTime())
      await expect(service.update(post.id, reply.id, user.id, { content, expected_revision: now.getTime() })).rejects.toThrow("changed elsewhere")
      expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toMatchObject({ content: [{ content: [{ type: "text" }, { attrs: { href: `/app/rooms/${room.id}/members/${user.id}`, avatarUrl: null } }] }] })
      await prisma.reply.update({ where: { id: reply.id }, data: { status: "published", published_at: now } })
      previews.prepareAttachment.mockResolvedValue(null)
      const beforeRetry = await prisma.reply.findUniqueOrThrow({ where: { id: reply.id } })
      const documentBeforeRetry = await prisma.document.findUniqueOrThrow({ where: { id: document.id } })
      const appliedBeforeRetry = apply.mock.calls.length
      const recovered = await service.update(post.id, reply.id, user.id, { content: changed, expected_revision: now.getTime() })
      expect(recovered.revision).toBe(saved.revision)
      expect(await prisma.reply.findUniqueOrThrow({ where: { id: reply.id } })).toEqual(beforeRetry)
      expect(await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).toEqual(documentBeforeRetry)
      expect(apply).toHaveBeenCalledTimes(appliedBeforeRetry)
      await expect(service.update(post.id, reply.id, user.id, { content, expected_revision: now.getTime() })).rejects.toThrow("changed elsewhere")
      previews.prepareAttachment.mockResolvedValueOnce({ source_url: "https://example.com/", preview_id: null, hidden: true })
      await expect(service.update(post.id, reply.id, user.id, { content: changed, expected_revision: now.getTime() })).rejects.toThrow("changed elsewhere")
      await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: true } })
      await expect(service.update(post.id, reply.id, user.id, { content: changed, expected_revision: now.getTime() })).rejects.toThrow("Forbidden")
      expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(0)
    }
  } finally {
    await prisma.document.delete({ where: { id: document.id } })
    await prisma.reply.delete({ where: { id: reply.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
