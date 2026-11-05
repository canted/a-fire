import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service"

it.each(["cancel", "extend", "shorten", "precision", "chat-failure", "refresh-failure"])("rechecks a selected Round after a concurrent %s", async change => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@completion-race.test`, username: "Host", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { name: "Feedback", host_id: user.id, room_id: room.id, template_key: "feedback", status: "active", feedback_due_at: new Date(now.getTime() - 60000), created_at: new Date(now.getTime() - 180000), updated_at: now } })
  const changedDeadline = new Date(now.getTime() + (change === "extend" ? 60000 : -120000))
  const runtime = { syncChat: vi.fn(), complete: vi.fn() }
  const service = new RoundLifecycleService()
  const racing = { round: prisma.round, $transaction: async (callback: Parameters<PrismaService["$transaction"]>[0]) => {
    await prisma.round.update({ where: { id: round.id }, data: change === "cancel" ? { status: "cancelled" } : { feedback_due_at: changedDeadline } })
    return prisma.$transaction(callback)
  } }
  Object.assign(service, { prisma: racing, rounds: runtime })
  try {
    if (change === "refresh-failure") {
      Object.assign(service, { prisma })
      runtime.syncChat.mockRejectedValue(new Error("Refresh unavailable"))
      await expect(service.reconcileActivity(round.id, now)).resolves.toBe(true)
      expect(runtime.syncChat).not.toHaveBeenCalled()
      expect(await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).toMatchObject({ status: "archived" })
      expect(await prisma.roundResult.count({ where: { round_id: round.id } })).toBe(1)
      expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(2)
      expect(await service.reconcileActivity(round.id, now)).toBe(false)
      expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(2)
      return
    }
    if (change === "chat-failure") {
      const failing = prisma.$extends({ query: { chatMessage: { async upsert() { throw new Error("Chat persistence unavailable") } } } })
      Object.assign(service, { prisma: failing })
      await expect(service.reconcileActivity(round.id, now)).rejects.toThrow("Chat persistence unavailable")
      expect(await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).toEqual(round)
      expect(await prisma.roundResult.count({ where: { round_id: round.id } })).toBe(0)
      expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(0)
      expect(runtime.syncChat).not.toHaveBeenCalled()
      Object.assign(service, { prisma })
      expect(await service.reconcileActivity(round.id, now)).toBe(true)
      expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(2)
      expect(await service.reconcileActivity(round.id, now)).toBe(false)
      expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(2)
      return
    }
    if (change === "precision") {
      await prisma.$executeRaw`UPDATE rounds SET feedback_due_at = feedback_due_at + interval '123 microseconds' WHERE id = ${round.id}`
      Object.assign(service, { prisma })
      expect(await service.reconcileActivity(round.id, now)).toBe(true)
      const [stored] = await prisma.$queryRaw<Array<{ exact: boolean }>>`SELECT closed_at = feedback_due_at AS exact FROM rounds WHERE id = ${round.id}`
      expect(stored.exact).toBe(true)
      return
    }
    expect(await service.reconcileActivity(round.id, now)).toBe(change === "shorten")
    const current = await prisma.round.findUniqueOrThrow({ where: { id: round.id } })
    expect(current).toMatchObject({ status: change === "cancel" ? "cancelled" : change === "shorten" ? "archived" : "active", closed_at: change === "shorten" ? changedDeadline : null })
    expect(await prisma.roundResult.count({ where: { round_id: round.id } })).toBe(change === "shorten" ? 1 : 0)
    expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(change === "shorten" ? 2 : 0)
    expect(runtime.syncChat).not.toHaveBeenCalled()
    Object.assign(service, { prisma })
    expect(await service.reconcileActivity(round.id, now)).toBe(false)
    if (change === "shorten") {
      expect(await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).toMatchObject({ status: "archived", closed_at: changedDeadline })
      expect(await prisma.roundResult.findUniqueOrThrow({ where: { round_id: round.id } })).toMatchObject({ published_at: changedDeadline })
      expect(runtime.syncChat).not.toHaveBeenCalled()
    }
  } finally {
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.roundResult.deleteMany({ where: { round_id: round.id } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
