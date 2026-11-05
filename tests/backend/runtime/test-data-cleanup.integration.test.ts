import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { cleanupAllTestData } from "../../e2e/fixtures/cleanup"
import { prisma as fixtureDatabase } from "../../e2e/fixtures/database"

it("resets application data and retained queue work together without recycling payload IDs", async () => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date()
  const rollback = new Error("Roll back the reset regression fixture")
  await boss.start()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@cleanup.test`, username: "Before reset", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Reset fixture", owner_id: user.id, created_at: now, updated_at: now } })
      const event = await tx.notificationEvent.create({ data: { event_type: "post_created", room_id: room.id, actor_id: user.id, created_at: now, updated_at: now } })
      const inbox = await tx.notificationInboxItem.create({ data: { user_id: user.id, notification_event_id: event.id, created_at: now, updated_at: now } })
      const delivery = await tx.notificationPushDelivery.create({ data: { user_id: user.id, notification_event_id: event.id, notification_inbox_item_id: inbox.id, state: "failed", due_at: now, created_at: now, updated_at: now } })
      const fanout = await boss.enqueueInTransaction(tx, "notifications.fanout", { eventId: event.id })
      await boss.enqueueInTransaction(tx, "notifications.push.delayed", { deliveryId: delivery.id })
      // Completed jobs are retained too, and caused the original count failures.
      await tx.$executeRaw`UPDATE pgboss.job SET state='completed' WHERE id=${fanout}::uuid`

      // Flush deferred Boss constraint triggers before truncating in this
      // rollback-only transaction, as a committed fixture would have done.
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`
      await cleanupAllTestData(tx)

      expect(await tx.notificationEvent.count()).toBe(0)
      expect(await tx.notificationPushDelivery.count()).toBe(0)
      expect(await tx.user.count()).toBe(0)
      expect(await tx.$queryRaw`SELECT id FROM pgboss.job`).toEqual([])
      expect(await tx.$queryRaw`SELECT name FROM pgboss.queue WHERE name='notifications.fanout'`).toEqual([{ name: "notifications.fanout" }])
      const next = await tx.user.create({ data: { email: `${crypto.randomUUID()}@cleanup.test`, username: "After reset", created_at: now, updated_at: now } })
      expect(next.id).toBeGreaterThan(user.id)
      const nextRoom = await tx.room.create({ data: { name: "After reset", owner_id: next.id, created_at: now, updated_at: now } })
      const nextEvent = await tx.notificationEvent.create({ data: { event_type: "post_created", room_id: nextRoom.id, actor_id: next.id, created_at: now, updated_at: now } })
      expect(nextEvent.id).toBeGreaterThan(event.id)
      // Exercise the real reset while preserving the rest of the test database.
      throw rollback
    }, { timeout: 15000 }).catch(error => { if (error !== rollback) throw error })
  } finally {
    await boss.onModuleDestroy()
    await prisma.$disconnect()
    await fixtureDatabase.$disconnect()
  }
}, 20000)
