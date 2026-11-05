import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["body", "feedback"] as const)("holds selected %s reference authority through share allocation", async selection => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@share-reference.test`, username: "Writer", created_at: now, updated_at: now } })
  const rooms = await prisma.room.createManyAndReturn({ data: ["Destination", "Reference"].map(name => ({ name, created_at: now, updated_at: now })) })
  const [destination, target] = rooms
  const note = await prisma.page.create({ data: { room_id: target.id, title: "Referenced", created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const source = await prisma.entry.create({ data: { project_id: project.id, creation_origin: "project_material", user_id: user.id, status: "published", created_at: now, updated_at: now } })
  const parent = await prisma.entry.create({ data: { room_id: destination.id, user_id: user.id, status: "published", created_at: now, updated_at: now } })
  const reply = await prisma.reply.create({ data: { entry_id: parent.id, user_id: user.id, status: "published", created_at: now, updated_at: now } })
  const saved = await prisma.entry.create({ data: { project_id: project.id, creation_origin: "project_feedback", user_id: user.id, status: "published", source_entry_id: source.id, source_shared_entry_id: parent.id, source_reply_id: reply.id, source_room_id: destination.id, source_room_ids: [destination.id], created_at: now, updated_at: now } })
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: String(note.id), label: "Referenced" } }] }] }
  const plain = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
  await prisma.document.createMany({ data: [source, saved].map(post => ({ docable_type: "Post", docable_id: post.id, content: (selection === "body" ? post.id === source.id : post.id === saved.id) ? content : plain, created_at: now, updated_at: now })) })
  let release!: () => void, signal!: () => void, identify!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve }), prepared = new Promise<void>(resolve => { signal = resolve })
  const revokerPid = new Promise<number>(resolve => { identify = resolve })
  let sharing: Promise<unknown> | undefined, revoking: Promise<unknown> | undefined
  try {
    await prisma.roomMembership.createMany({ data: rooms.map(room => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
    const service = withTestDependencies(new ProjectEntriesService(), { prisma,
      circleAccess: withTestDependencies(new RoomAccessService(), { prisma }),
      uploads: { async copyContentSnapshot() { signal(); await gate; throw new Error("Interrupted copy") } },
    })
    const manifest = await service.shareSelection(project.id, source.id, user.id, destination.id)
    const write = () => service.shareDraft(project.id, source.id, user.id, { room_id: destination.id, selected_unit_ids: [selection === "body" ? "body" : `feedback:${saved.id}`], source_revision: manifest.revision, request_key: crypto.randomUUID() })
    sharing = write()
    await Promise.race([prepared, sharing])
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
    const rejected = expect(sharing).rejects.toThrow("Interrupted copy")
    release(); await rejected; await revoking
    await expect(write()).rejects.toThrow("Mention unavailable")
    expect(await prisma.entry.count({ where: { room_id: destination.id, source_entry_id: source.id } })).toBe(0)
    expect(await prisma.document.count({ where: { docable_type: "Post", docable_id: { in: [source.id, saved.id] } } })).toBe(2)
  } finally {
    release()
    await Promise.allSettled([sharing, revoking].filter(Boolean))
    await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: { in: [source.id, saved.id] } } })
    await prisma.entry.delete({ where: { id: saved.id } })
    await prisma.reply.delete({ where: { id: reply.id } })
    await prisma.entry.delete({ where: { id: parent.id } })
    await prisma.entry.delete({ where: { id: source.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.page.delete({ where: { id: note.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: { in: rooms.map(room => room.id) } } })
    await prisma.room.deleteMany({ where: { id: { in: rooms.map(room => room.id) } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 15000)
