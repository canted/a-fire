import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"

it("commits cover removal, moderation and notification work together under current Round policy", async () => {
  const prisma = new PrismaService(), boss = new BossService()
  await boss.start()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@cover-removal.test`, username: "Host", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", template_key: "art_before_chorus", status: "active", submit_by: new Date(now.getTime() + 3600000), feedback_due_at: new Date(now.getTime() + 7200000), created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { room_id: room.id, user_id: user.id, round_id: round.id, status: "draft", created_at: now, updated_at: now } })
  const artifact = await prisma.activityArtifact.create({ data: { round_id: round.id, user_id: user.id, entry_id: post.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
  const service = new ArtBeforeChorusRoundService()
  Object.assign(service, { prisma, boss, circleAccess: Object.assign(new RoomAccessService(), { prisma }) })
  const ids: string[] = []
  const enqueue = boss.enqueueInTransaction.bind(boss)
  let fail = true
  const spy = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
    const id = await enqueue(...args)
    ids.push(id)
    if (fail) throw new Error("Injected queue failure")
    return id
  })
  const remove = () => service.removeCover(round, user.id, { artifactId: artifact.id, sendPushNotification: true })
  const hints: number[] = []
  const listener = new CommittedIdChangeListener("afire_room_changes", "afire-creative-test", process.env.DATABASE_URL!, id => hints.push(id), () => {}, () => {})
  let sentinel = Number.MAX_SAFE_INTEGER - room.id
  const flush = async () => {
    const id = sentinel--
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(id)})::text`
    await vi.waitFor(() => expect(hints).toContain(id))
    return hints.filter(value => value === room.id).length
  }
  try {
    await listener.start()
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: true } })
    await expect(remove()).rejects.toThrow("Members only")
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: false } })
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: now } })
    await expect(remove()).rejects.toThrow("Community not found")
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: null } })
    await prisma.room.update({ where: { id: room.id }, data: { owner_id: null } })
    await expect(remove()).rejects.toThrow("Circle manager only")
    expect((await prisma.activityArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).status).toBe("active")
    expect(await prisma.activityModerationEvent.count({ where: { round_id: round.id } })).toBe(0)
    await prisma.room.update({ where: { id: room.id }, data: { owner_id: user.id } })
    await prisma.round.update({ where: { id: round.id }, data: { status: "archived" } })
    await expect(remove()).rejects.toThrow("being collected")
    expect(ids).toHaveLength(0)
    await prisma.round.update({ where: { id: round.id }, data: { status: "active" } })
    await expect(remove()).rejects.toThrow("Injected queue failure")
    expect((await prisma.activityArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).status).toBe("active")
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("draft")
    expect(await prisma.activityModerationEvent.count({ where: { round_id: round.id } })).toBe(0)
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(0)
    expect(await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM pgboss.job WHERE id = ${ids[0]}::uuid`).toHaveLength(0)
    expect(await flush()).toBe(0)
    fail = false
    const results = await Promise.allSettled([remove(), remove()])
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(await flush()).toBe(1)
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("deleted")
    expect(await prisma.activityModerationEvent.count({ where: { round_id: round.id } })).toBe(1)
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(1)
    expect(ids).toHaveLength(2)
    expect(await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM pgboss.job WHERE id = ${ids[1]}::uuid`).toHaveLength(1)
  } finally {
    await listener.stop()
    spy.mockRestore()
    for (const id of ids) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.activityModerationEvent.deleteMany({ where: { round_id: round.id } })
    await prisma.notificationEvent.deleteMany({ where: { room_id: room.id } })
    await prisma.activityArtifact.delete({ where: { id: artifact.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await boss.onModuleDestroy()
    await prisma.$disconnect()
  }
})
