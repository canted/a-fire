import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossWorkers } from "@server/queue/boss.workers"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["entry", "reply"] as const)("reuses one persisted %s event after delivery failure and concurrent retries", async kind => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@legacy-fanout.test`, username: "Author", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", format: "mixed_media", created_at: now, updated_at: now } })
  const reply = kind === "reply" ? await prisma.reply.create({ data: { entry_id: post.id, user_id: user.id, status: "published", created_at: now, updated_at: now } }) : null
  let secondReplyId: number | undefined
  const payload = reply ? { replyId: reply.id } : { entryId: post.id }
  const workers = withTestDependencies(new BossWorkers(), { prisma })
  const deliver = vi.spyOn(workers as never, "deliverToCommunity" as never) as unknown as ReturnType<typeof vi.fn>
  deliver.mockRejectedValueOnce(new Error("Delivery interrupted")).mockResolvedValue(undefined)
  try {
    await expect(workers.handleNotificationFanout(payload)).rejects.toThrow("Delivery interrupted")
    const first = await prisma.notificationEvent.findFirstOrThrow({ where: { entry_id: post.id } })
    if (reply) {
      expect(first.reply_id).toBe(reply.id)
      await expect(prisma.notificationEvent.update({ where: { id: first.id }, data: { reply_id: -1 } })).rejects.toMatchObject({ code: "P2003" })
    }
    await Promise.all(Array.from({ length: 6 }, () => workers.handleNotificationFanout(payload)))
    expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(1)
    expect(deliver).toHaveBeenCalledTimes(7)
    expect(deliver.mock.calls.every(([event]) => event.id === first.id)).toBe(true)
    expect(await prisma.notificationEvent.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first)
    await prisma.notificationEvent.delete({ where: { id: first.id } })
    deliver.mockClear()
    // Six simultaneous first attempts must also create only one event.
    await Promise.all(Array.from({ length: 6 }, () => workers.handleNotificationFanout(payload)))
    expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(1)
    expect(new Set(deliver.mock.calls.map(([event]) => event.id)).size).toBe(1)
    if (reply) {
      const second = await prisma.reply.create({ data: { entry_id: post.id, user_id: user.id, status: "published", created_at: now, updated_at: now } })
      secondReplyId = second.id
      await workers.handleNotificationFanout({ replyId: second.id })
      expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(2)
      expect(new Set(deliver.mock.calls.map(([event]) => event.id)).size).toBe(2)
    }
    await prisma.entry.update({ where: { id: post.id }, data: { status: "deleted" } })
    deliver.mockClear()
    await workers.handleNotificationFanout(payload)
    expect(deliver).not.toHaveBeenCalled()
  } finally {
    deliver.mockRestore()
    await prisma.notificationEvent.deleteMany({ where: { entry_id: post.id } })
    if (secondReplyId) await prisma.reply.delete({ where: { id: secondReplyId } })
    if (reply) await prisma.reply.delete({ where: { id: reply.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
