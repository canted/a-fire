import { Prisma } from "@prisma/client"
import { RoundRuntime } from "@server/api/v1/rounds/runtime/round-runtime.registry"
import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoundNotificationsService } from "@server/api/v1/rounds/round-notifications.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it.each(["create", "edit", "start"].map(operation => ({ operation })))("commits $operation, jobs and Room hints through Room scope", async ({ operation }) => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date(), jobs: string[] = []
  await boss.start()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@round-schedule.test`, username: "Owner", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const dates = { submit_by: new Date(now.getTime() + 172800000), feedback_due_at: new Date(now.getTime() + 259200000) }
  const original = operation === "create" ? null : await prisma.round.create({ data: { name: "Original", room_id: room.id, host_id: user.id, status: operation === "start" ? "draft" : "active", started_at: now, ...dates, created_at: now, updated_at: now } })
  const access = new RoomAccessService(); Object.assign(access, { prisma })
  const realRuntime = new RoundRuntime(), emit = vi.fn()
  Object.assign(realRuntime, { prisma, realtime: { emit, chatRoom: (id: number) => `chat:${id}` } })
  let fail: "queue" | "chat" | null = "queue"
  const runtime = { syncChat: vi.fn(async (...args: Parameters<RoundRuntime["syncChat"]>) => {
    await realRuntime.syncChat(...args)
    if (fail === "chat") throw new Error("Chat milestone interrupted")
  }) }, notifications = new RoundNotificationsService()
  Object.assign(notifications, { prisma, rounds: runtime, boss: {
    hasOutstandingJob: boss.hasOutstandingJob.bind(boss),
    enqueueInTransaction: async (...args: Parameters<BossService["enqueueInTransaction"]>) => {
      const id = await boss.enqueueInTransaction(...args); jobs.push(id)
      if (fail === "queue") throw new Error("Schedule interrupted")
      return id
    },
  } })
  const service = new RoundsService(); Object.assign(service, { prisma, circleAccess: access, notifications, rounds: runtime, activityLifecycle: { reconcileCircle: async () => {}, reconcileActivity: async () => false } })
  const createInput = { name: "New", submit_by: dates.submit_by.toISOString(), feedback_due_at: dates.feedback_due_at.toISOString() }
  const run = () => operation === "create"
    ? service.createForRoom(room.id, user.id, createInput)
    : operation === "edit" ? service.update(original!.id, user.id, { name: "Changed" }) : service.start(original!.id, user.id)
  const hints: number[] = []
  const listener = new CommittedIdChangeListener("afire_room_changes", "afire-round-schedule-test", process.env.DATABASE_URL!, id => hints.push(id), () => {}, () => {})
  let sentinel = Number.MAX_SAFE_INTEGER - room.id
  const flush = async () => {
    const id = sentinel--
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(id)})::text`
    await vi.waitFor(() => expect(hints).toContain(id))
    return hints.filter(value => value === room.id).length
  }

  try {
    await listener.start()
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
    await expect(run()).rejects.toThrow("Schedule interrupted")
    if (original) expect(await prisma.round.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original)
    else expect(await prisma.round.count({ where: { room_id: room.id } })).toBe(0)
    if (jobs.length) expect(await prisma.$queryRaw(Prisma.sql`SELECT id FROM pgboss.job WHERE id IN (${Prisma.join(jobs.map(id => Prisma.sql`${id}::uuid`))})`)).toEqual([])
    expect(runtime.syncChat).not.toHaveBeenCalled()
    expect(await flush()).toBe(0)
    fail = "chat"
    await expect(run()).rejects.toThrow("Chat milestone interrupted")
    if (original) expect(await prisma.round.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original)
    else expect(await prisma.round.count({ where: { room_id: room.id } })).toBe(0)
    expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(0)
    if (jobs.length) expect(await prisma.$queryRaw(Prisma.sql`SELECT id FROM pgboss.job WHERE id IN (${Prisma.join(jobs.map(id => Prisma.sql`${id}::uuid`))})`)).toEqual([])
    expect(await flush()).toBe(0)
    expect(emit).not.toHaveBeenCalled()
    fail = null
    await run()
    expect(await prisma.chatMessage.count({ where: { room_id: room.id, timeline_kind: "round_event" } })).toBe(2)
    expect(emit).not.toHaveBeenCalled()
    expect(await flush()).toBe(1)
    if (operation === "start") { await run(); expect(await flush()).toBe(1) }
    const round = await prisma.round.findFirstOrThrow({ where: { room_id: room.id } })
    if (operation === "create") expect(round.room_id).toBe(room.id)
    // Rebuilding jobs after a restart uses the same deduplication boundary.
    await Promise.all([notifications.scheduleActivityNotifications(round), notifications.scheduleActivityNotifications(round)])
    const queued = await prisma.$queryRaw<Array<{ data: { milestone: string }; start_after: Date }>>`SELECT data, start_after FROM pgboss.job WHERE name = 'rounds.notification' AND data->>'activityId' = ${String(round.id)}`
    expect(queued).toHaveLength(5)
    expect(new Set(queued.map(job => job.data.milestone)).size).toBe(5)
    expect(queued.find(job => job.data.milestone === "round_completed")!.start_after).toEqual(dates.feedback_due_at)
  } finally {
    await listener.stop()
    if (jobs.length) await prisma.$executeRaw(Prisma.sql`DELETE FROM pgboss.job WHERE id IN (${Prisma.join(jobs.map(id => Prisma.sql`${id}::uuid`))})`)
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.round.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await boss.onModuleDestroy(); await prisma.$disconnect()
  }
})
