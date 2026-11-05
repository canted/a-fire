import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundRuntime } from "@server/api/v1/rounds/runtime/round-runtime.registry"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"
import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"

it.each(["feedback", "art_before_chorus"])("repairs %s milestones atomically under concurrent retries", async template => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { username: "Host", email: `${crypto.randomUUID()}@milestone-recovery.test`, created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", template_key: template, status: "active", created_at: new Date(now.getTime() - 180000), started_at: new Date(now.getTime() - 120000), submit_by: new Date(now.getTime() - 60000), feedback_due_at: new Date(now.getTime() + 3600000), updated_at: now } })
  const runtime = new RoundRuntime(), creative = new ArtBeforeChorusRoundService()
  Object.assign(runtime, { prisma, artBeforeChorus: creative })
  const hints: number[] = []
  const listener = new CommittedIdChangeListener("afire_room_changes", "afire-milestone-recovery-test", process.env.DATABASE_URL!, id => hints.push(id), () => {}, () => {})
  let sentinel = Number.MAX_SAFE_INTEGER - room.id
  const flush = async () => {
    const id = sentinel--
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(id)})::text`
    await vi.waitFor(() => expect(hints).toContain(id))
    return hints.filter(value => value === room.id).length
  }
  try {
    await listener.start()
    let writes = 0
    const failed = prisma.$extends({ query: { chatMessage: { async upsert({ args, query }) {
      const result = await query(args)
      if (++writes === 2) throw new Error("Milestone repair interrupted")
      return result
    } } } })
    Object.assign(runtime, { prisma: failed })
    await expect(runtime.syncChat(round.id)).rejects.toThrow("Milestone repair interrupted")
    expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(0)
    expect(await flush()).toBe(0)
    Object.assign(runtime, { prisma })
    await Promise.all([runtime.syncChat(round.id), runtime.syncChat(round.id), runtime.syncChat(round.id)])
    const expected = template === "feedback" ? 3 : 2 // Creative response phase still needs its cover threshold.
    const messages = await prisma.chatMessage.findMany({ where: { room_id: room.id }, orderBy: { id: "asc" } })
    expect(messages).toHaveLength(expected)
    expect(await flush()).toBe(1)
    await runtime.syncChat(round.id)
    expect(await flush()).toBe(1)
    expect(await prisma.chatMessage.findMany({ where: { room_id: room.id }, orderBy: { id: "asc" } })).toEqual(messages)
    // Repair one missing milestone without replacing the others.
    await prisma.chatMessage.delete({ where: { id: messages[0].id } })
    await runtime.syncChat(round.id)
    expect(await flush()).toBe(2)
    expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(expected)
    expect(await prisma.chatMessage.findMany({ where: { id: { in: messages.slice(1).map(message => message.id) } }, orderBy: { id: "asc" } })).toEqual(messages.slice(1))
  } finally {
    await listener.stop()
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
