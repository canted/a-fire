import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service"

it("reconciles the single active Round, preserves Room scope, and replays without duplicate results", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback batch fixture")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@round-batch.test`, username: "Host", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Batch Room", owner_id: user.id, created_at: now, updated_at: now } })
      const other = await tx.room.create({ data: { name: "Other Room", owner_id: user.id, created_at: now, updated_at: now } })
      const data = { room_id: room.id, host_id: user.id, name: "Overdue", template_key: "feedback", status: "active", feedback_due_at: now, created_at: now, updated_at: now }
      await tx.round.createMany({ data: [data] })
      const outside = await tx.round.create({ data: { ...data, room_id: other.id } })
      const futureRoom = await tx.room.create({ data: { name: "Future Room", created_at: now, updated_at: now } })
      const future = await tx.round.create({ data: { ...data, room_id: futureRoom.id, feedback_due_at: new Date(now.getTime() + 60000) } })
      const pages: number[] = []
      let running = 0, maximum = 0
      const activity = new Proxy(tx.round, { get(target, key) {
        if (key === "findMany") return async (args: Parameters<typeof tx.round.findMany>[0]) => {
          expect(args?.take).toBe(100)
          const rows = await target.findMany(args)
          pages.push(rows.length)
          return rows
        }
        return Reflect.get(target, key)
      } })
      const database = new Proxy(tx, { get(target, key) {
        if (key === "round") return activity
        if (key === "$transaction") return async (write: (client: typeof tx) => Promise<unknown>) => {
          running++; maximum = Math.max(maximum, running)
          try { return await write(tx) } finally { running-- }
        }
        return Reflect.get(target, key)
      } })
      const lifecycle = new RoundLifecycleService(); Object.assign(lifecycle, { prisma: database })
      await lifecycle.reconcileCircle(room.id, now)
      expect(pages).toEqual([1])
      expect(maximum).toBe(1)
      expect(await tx.round.count({ where: { room_id: room.id, status: "archived" } })).toBe(1)
      expect(await tx.roundResult.count({ where: { room_id: room.id } })).toBe(1)
      expect(await tx.round.findUniqueOrThrow({ where: { id: outside.id } })).toEqual(outside)
      expect(await tx.round.findUniqueOrThrow({ where: { id: future.id } })).toEqual(future)
      const late = await tx.round.create({ data })
      await lifecycle.reconcileCircle(room.id, now)
      expect((await tx.round.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("archived")
      expect(pages).toEqual([1, 1])
      const walls = await tx.roundResult.count({ where: { room_id: room.id } })
      const messages = await tx.chatMessage.count({ where: { room_id: room.id } })
      await lifecycle.reconcileCircle(room.id, now)
      expect(await tx.roundResult.count({ where: { room_id: room.id } })).toBe(walls)
      expect(await tx.chatMessage.count({ where: { room_id: room.id } })).toBe(messages)
      throw rollback
    }, { timeout: 60000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
