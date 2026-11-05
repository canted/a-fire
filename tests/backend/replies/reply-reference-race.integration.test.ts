import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RepliesService } from "@server/api/v1/replies/replies.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["create", "update", "publish"] as const)("holds referenced Note authority through Reply %s and rolls back an interrupted write", async operation => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@reply-reference.test`, username: "Writer", created_at: now, updated_at: now } })
  const rooms = await prisma.room.createManyAndReturn({ data: ["Destination", "Reference"].map(name => ({ name, created_at: now, updated_at: now })) })
  const [destination, target] = rooms
  const note = await prisma.page.create({ data: { room_id: target.id, title: "Referenced", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { room_id: destination.id, user_id: user.id, status: "published", created_at: now, updated_at: now } })
  const reply = await prisma.reply.create({ data: { entry_id: post.id, user_id: user.id, status: "draft", created_at: now, updated_at: now } })
  const original = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
  const document = await prisma.document.create({ data: { docable_type: "Reply", docable_id: reply.id, content: original, version: 1, created_at: now, updated_at: now } })
  let release!: () => void, signal!: () => void, identify!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve }), prepared = new Promise<void>(resolve => { signal = resolve })
  const revokerPid = new Promise<number>(resolve => { identify = resolve })
  let saving: Promise<unknown> | undefined, revoking: Promise<unknown> | undefined
  try {
    await prisma.roomMembership.createMany({ data: rooms.map(room => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
    const service = withTestDependencies(new RepliesService(), { prisma,
      circleAccess: withTestDependencies(new RoomAccessService(), { prisma }),
      linkPreviews: { serializeAttachment: vi.fn().mockResolvedValue(null), prepareAttachment: vi.fn().mockResolvedValue(null), async applyPreparedAttachment() { signal(); await gate; throw new Error("Interrupted after content write") } },
    })
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: String(note.id), label: "Referenced" } }] }] }
    const write = () => operation === "create" ? service.create(post.id, user.id, { content }) : service[operation](post.id, reply.id, user.id, { content, expected_revision: now.getTime() })
    saving = write()
    await Promise.race([prepared, saving])
    revoking = prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      identify(row.pid)
      await tx.page.update({ where: { id: note.id }, data: { deleted_at: new Date() } })
    })
    const pid = await Promise.race([revokerPid, revoking.then(() => { throw new Error("Expected overlapping revocation") })])
    await expect.poll(async () => {
      const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::integer)) > 0 AS blocked`
      return row.blocked
    }, { timeout: 1000 }).toBe(true)
    const rejected = expect(saving).rejects.toThrow("Interrupted after content write")
    release(); await rejected; await revoking
    await expect(write()).rejects.toThrow("Mention unavailable")
    expect(await prisma.reply.count({ where: { entry_id: post.id } })).toBe(1)
    expect((await prisma.reply.findUniqueOrThrow({ where: { id: reply.id } })).status).toBe("draft")
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(original)
    expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(0)
    if (operation === "publish") {
      // Replaying an earlier successful publication does not republish its old references.
      await prisma.reply.update({ where: { id: reply.id }, data: { status: "published", published_at: now } })
      await prisma.document.update({ where: { id: document.id }, data: { content } })
      await expect(write()).resolves.toMatchObject({ id: reply.id })
      expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(content)
      expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(0)
    }
  } finally {
    release()
    await Promise.allSettled([saving, revoking].filter(Boolean))
    await prisma.document.delete({ where: { id: document.id } })
    await prisma.reply.delete({ where: { id: reply.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.page.delete({ where: { id: note.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: { in: rooms.map(room => room.id) } } })
    await prisma.room.deleteMany({ where: { id: { in: rooms.map(room => room.id) } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 15000)
