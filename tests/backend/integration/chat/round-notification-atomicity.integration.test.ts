import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { RoundNotificationsService } from "@server/api/v1/rounds/round-notifications.service"

it.each(["milestone", "reminder"])("commits %s events with queue work, rolling back failed insertion", async kind => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date(), jobs: string[] = []
  await boss.start()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@round-notify.test`, username: "Member", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { name: "Round", room_id: room.id, host_id: user.id, status: "active", started_at: now, created_at: now, updated_at: now } })
  let fail = true
  const service = new RoundNotificationsService()
  Object.assign(service, { prisma, lifecycle: { reconcileActivity: async () => false }, rounds: { syncChat: async () => {} }, boss: {
    enqueueInTransaction: async (...args: Parameters<BossService["enqueueInTransaction"]>) => {
      const id = await boss.enqueueInTransaction(...args); jobs.push(id)
      if (fail) throw new Error("Queue interrupted")
      return id
    },
  } })
  const run = () => kind === "milestone" ? service.handleScheduledNotification({ roundId: round.id, milestone: "submission_started", expectedAt: now.toISOString() }) : service.enqueueReminder(round, user.id, user.id, "submission")
  try {
    await prisma.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } })
    await expect(run()).rejects.toThrow("Queue interrupted")
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(0)
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${jobs[0]}::uuid`).toEqual([])
    fail = false
    if (kind === "milestone") { await Promise.all([run(), run()]); await run() }
    else await run()
    const events = await prisma.notificationEvent.findMany({ where: { room_id: room.id } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ room_id: room.id, target_path: `/app/rounds/${round.id}` })
    const queued = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM pgboss.job WHERE name = 'notifications.fanout' AND data->>'eventId' = ${String(events[0].id)}`
    expect(queued).toHaveLength(1)
  } finally {
    for (const id of jobs) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.notificationEvent.deleteMany({ where: { room_id: room.id } })
    await prisma.activityParticipation.deleteMany({ where: { round_id: round.id } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await boss.onModuleDestroy(); await prisma.$disconnect()
  }
})
