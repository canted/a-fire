import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["save", "publish body", "publish feedback"] as const)("holds referenced Note authority through Entry %s", async operation => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@entry-reference.test`, username: "Writer", created_at: now, updated_at: now } })
  const rooms = await prisma.room.createManyAndReturn({ data: ["Destination", "Reference"].map(name => ({ name, created_at: now, updated_at: now })) })
  const [destination, target] = rooms
  const note = await prisma.page.create({ data: { room_id: target.id, title: "Referenced", created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const source = await prisma.entry.create({ data: { project_id: project.id, creation_origin: "project_material", user_id: user.id, status: "published", created_at: now, updated_at: now } })
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: String(note.id), label: "Referenced" } }] }] }
  const plain = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
  const sharedFeedback = operation === "publish feedback" ? [{ source_room_id: destination.id, original_room_ids: [destination.id], content, format: "mixed_media", format_data: null }] : []
  const post = await prisma.entry.create({ data: { room_id: destination.id, source_entry_id: source.id, feedback_request_customized: true, user_id: user.id, status: "draft", shared_feedback: sharedFeedback, created_at: now, updated_at: now } })
  const original = operation === "publish body" ? content : plain
  const document = await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: original, version: 1, created_at: now, updated_at: now } })
  let release!: () => void, signal!: () => void, identify!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve }), prepared = new Promise<void>(resolve => { signal = resolve })
  const revokerPid = new Promise<number>(resolve => { identify = resolve })
  let saving: Promise<unknown> | undefined, revoking: Promise<unknown> | undefined
  try {
    await prisma.roomMembership.createMany({ data: rooms.map(room => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
    const database = prisma.$extends({ query: { entry: { async update({ args, query }) { const result = await query(args); signal(); await gate; throw new Error(`Interrupted ${result.id}`) } } } })
    const service = withTestDependencies(new EntriesService(), { prisma: database,
      circleAccess: withTestDependencies(new RoomAccessService(), { prisma: database }),
      linkPreviews: { prepareAttachment: vi.fn().mockResolvedValue(null), applyPreparedAttachment: vi.fn() },
    })
    const write = () => operation === "save" ? service.saveContent(post.id, user.id, content) : service.publish(post.id, user.id)
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
    const rejected = expect(saving).rejects.toThrow("Interrupted")
    release(); await rejected; await revoking
    await expect(write()).rejects.toThrow("Mention unavailable")
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: "draft", shared_feedback: sharedFeedback, updated_at: now })
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(original)
    expect(await prisma.notificationEvent.count({ where: { entry_id: post.id } })).toBe(0)
    expect(await prisma.entrySubject.count({ where: { entry_id: post.id } })).toBe(0)
  } finally {
    release()
    await Promise.allSettled([saving, revoking].filter(Boolean))
    await prisma.document.delete({ where: { id: document.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.entry.delete({ where: { id: source.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.page.delete({ where: { id: note.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: { in: rooms.map(room => room.id) } } })
    await prisma.room.deleteMany({ where: { id: { in: rooms.map(room => room.id) } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 15000)
