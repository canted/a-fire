import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { canReadContentNotice } from "@server/notifications/notification-access"

it("authorizes Entry and Chat notices using the caller transaction's membership and content state", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@notice-tx.test`, username: "Member", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Closed", porosity: "closed", created_at: now, updated_at: now } })
  const membership = await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { room_id: room.id, user_id: user.id, status: "published", created_at: now, updated_at: now } })
  const message = await prisma.chatMessage.create({ data: { room_id: room.id, author_id: user.id, body: "Fixture", masked_alias: "", status: "published", fire_at: new Date(now.getTime() + 86400000), expires_at: new Date(now.getTime() + 172800000), created_at: now, updated_at: now } })
  const access = new RoomAccessService()
  Object.assign(access, { prisma })
  const events = [{ event_type: "post_created", entry_id: post.id, room_id: room.id }, { event_type: "chat_message_created", room_id: room.id, payload: { chat_message_id: message.id } }]
  const rollback = new Error("rollback")
  try {
    for (const override of [
      { room_id: room.id + 1 },
      { target_path: `/app/rooms/${room.id + 1}/chat#chat-${message.id}` },
      { target_path: `/app/rooms/${room.id}/chat#chat-${message.id + 1}` },
    ]) expect(await canReadContentNotice(access, prisma, user.id, { ...events[1], ...override })).toBe(false)
    expect(await canReadContentNotice(access, prisma, user.id, { ...events[1], target_path: `/app/rooms/${room.id}/chat#chat-${message.id}` })).toBe(true)
    for (const change of ["membership", "content"]) {
      for (const event of events) expect(await canReadContentNotice(access, prisma, user.id, event)).toBe(true)
      try {
        await prisma.$transaction(async tx => {
          if (change === "membership") await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
          else {
            await tx.entry.update({ where: { id: post.id }, data: { status: "deleted" } })
            await tx.chatMessage.update({ where: { id: message.id }, data: { status: "deleted" } })
          }
          for (const event of events) expect(await canReadContentNotice(access, tx, user.id, event)).toBe(false)
          throw rollback
        })
      } catch (error) { if (error !== rollback) throw error }
    }
  } finally {
    await prisma.chatMessage.delete({ where: { id: message.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.roomMembership.delete({ where: { id: membership.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
