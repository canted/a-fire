import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { ChatService } from "@server/api/v2/rooms/chat.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["membership", "note"] as const)("orders Chat mention publication against referenced $0 revocation", async change => {
  const prisma = new PrismaService(), boss = new BossService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@chat-reference.test`, username: "Writer", created_at: now, updated_at: now } })
  const rooms = await prisma.room.createManyAndReturn({ data: ["Destination", "Reference"].map(name => ({ name, created_at: now, updated_at: now })) })
  const [destination, target] = rooms
  const note = await prisma.page.create({ data: { room_id: target.id, title: "Referenced", created_at: now, updated_at: now } })
  let release!: () => void, signal!: () => void, identify!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const prepared = new Promise<void>(resolve => { signal = resolve })
  const revokerPid = new Promise<number>(resolve => { identify = resolve })
  let sending: Promise<unknown> | undefined, revoking: Promise<unknown> | undefined
  try {
    await boss.start()
    await prisma.roomMembership.createMany({ data: rooms.map(room => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
    const database = prisma.$extends({ query: { chatMessage: { async create({ args, query }) { signal(); await gate; return query(args) } } } })
    const access = withTestDependencies(new RoomAccessService(), { prisma: database })
    const service = withTestDependencies(new ChatService(), { prisma: database, boss, circleAccess: access,
      realtime: { emit: vi.fn(), chatRoom: (id: number) => `chat:${id}` }, rooms: { listMembersForChat: async () => ({ members: [] }) } })
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: String(note.id), label: "Referenced" } }] }] }
    sending = service.sendMessage(destination.id, user.id, { body: "Referenced", content, clientNonce: "first" })
    await Promise.race([prepared, sending])
    revoking = prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      identify(row.pid)
      if (change === "membership") await tx.roomMembership.updateMany({ where: { room_id: target.id, user_id: user.id }, data: { disabled: true } })
      else await tx.page.update({ where: { id: note.id }, data: { deleted_at: new Date() } })
    })
    const pid = await Promise.race([revokerPid, revoking.then(() => { throw new Error("Expected revocation transaction") })])
    await expect.poll(async () => {
      const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::integer)) > 0 AS blocked`
      return row.blocked
    }, { timeout: 1000 }).toBe(true)
    release()
    await Promise.all([sending, revoking])
    await expect(service.sendMessage(destination.id, user.id, { body: "Referenced", content, clientNonce: "after-revocation" })).rejects.toThrow(change === "membership" ? "Forbidden" : "Mention unavailable")
    expect(await prisma.chatMessage.count({ where: { room_id: destination.id } })).toBe(1)
    expect(await prisma.notificationEvent.count({ where: { room_id: destination.id } })).toBe(1)
  } finally {
    release()
    await Promise.allSettled([sending, revoking].filter(Boolean))
    const events = await prisma.notificationEvent.findMany({ where: { room_id: destination.id }, select: { id: true } })
    for (const event of events) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'notifications.fanout' AND data->>'eventId' = ${String(event.id)}`
    await prisma.notificationEvent.deleteMany({ where: { room_id: destination.id } })
    await prisma.chatMessage.deleteMany({ where: { room_id: destination.id } })
    await prisma.page.delete({ where: { id: note.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: { in: rooms.map(room => room.id) } } })
    await prisma.room.deleteMany({ where: { id: { in: rooms.map(room => room.id) } } })
    await prisma.user.delete({ where: { id: user.id } })
    await boss.onModuleDestroy()
    await prisma.$disconnect()
  }
}, 15000)
