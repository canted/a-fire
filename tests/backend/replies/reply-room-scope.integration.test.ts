import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { ForbiddenException } from "@nestjs/common"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RepliesService } from "@server/api/v1/replies/replies.service"
import { canEditEntryReply, canReplyToEntry } from "@server/api/v1/replies/reply-access"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("denies replies after source Room membership is revoked despite membership in another Room", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@reply-scope.test`, username: "Member", created_at: now, updated_at: now } })
  const rooms = await prisma.room.createManyAndReturn({ data: ["First", "Second"].map(name => ({ name, owner_id: user.id, created_at: now, updated_at: now })) })
  await prisma.roomMembership.createMany({ data: rooms.map(room => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
  const post = await prisma.entry.create({ data: { room_id: rooms[0].id, user_id: user.id, status: "published", created_at: now, updated_at: now } })
  const access = new RoomAccessService()
  Object.assign(access, { prisma })
  const preview = { prepareAttachment: vi.fn() }
  const service = withTestDependencies(new RepliesService(), { prisma, circleAccess: access, linkPreviews: preview })
  try {
    expect((await access.resolve(rooms[0].id, user.id))?.kind).toBe("member")
    expect((await access.resolve(rooms[1].id, user.id))?.kind).toBe("member")
    expect(await canReplyToEntry(access, post, user.id)).toBe(true)
    await prisma.roomMembership.updateMany({ where: { room_id: rooms[0].id, user_id: user.id }, data: { disabled: true } })
    expect(await canReplyToEntry(access, post, user.id)).toBe(false)
    expect(await canEditEntryReply(access, { user_id: user.id, status: "draft", entry: post }, user.id)).toBe(false)
    await expect(service.create(post.id, user.id, { status: "published", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Reply" }] }] } })).rejects.toBeInstanceOf(ForbiddenException)
    expect(preview.prepareAttachment).not.toHaveBeenCalled()
    expect(await prisma.reply.count({ where: { entry_id: post.id } })).toBe(0)
    await prisma.roomMembership.updateMany({ where: { room_id: rooms[0].id, user_id: user.id }, data: { disabled: false } })
    const matching = await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })
    expect(await canReplyToEntry(access, matching, user.id)).toBe(true)
  } finally {
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.roomMembership.deleteMany({ where: { user_id: user.id } })
    await prisma.room.deleteMany({ where: { id: { in: rooms.map(room => room.id) } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
