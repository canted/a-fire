import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("holds a new private Project reference through saving and rolls back interruption", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@project-reference.test`, username: "Writer", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Reference", created_at: now, updated_at: now } })
  const note = await prisma.page.create({ data: { room_id: room.id, title: "Referenced", created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { project_id: project.id, creation_origin: "project_material", user_id: user.id, status: "draft", created_at: now, updated_at: now } })
  const original = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
  const document = await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: original, version: 1, created_at: now, updated_at: now } })
  let release!: () => void, signal!: () => void, identify!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve }), prepared = new Promise<void>(resolve => { signal = resolve })
  const revokerPid = new Promise<number>(resolve => { identify = resolve })
  let saving: Promise<unknown> | undefined, revoking: Promise<unknown> | undefined
  try {
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
    const database = prisma.$extends({ query: { entry: { async update({ args, query }) { await query(args); signal(); await gate; throw new Error("Interrupted edit") } } } })
    const service = withTestDependencies(new ProjectEntriesService(), { prisma: database,
      circleAccess: withTestDependencies(new RoomAccessService(), { prisma: database }), uploads: { assertContentMediaAccess: async () => {} },
    })
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: String(note.id), label: "Referenced" } }] }] }
    const write = () => service.update(project.id, post.id, user.id, { content, expected_revision: now.getTime() })
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
    const rejected = expect(saving).rejects.toThrow("Interrupted edit")
    release(); await rejected; await revoking
    await expect(write()).rejects.toThrow("Mention unavailable")
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ updated_at: now, status: "draft" })
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).content).toEqual(original)
  } finally {
    release()
    await Promise.allSettled([saving, revoking].filter(Boolean))
    await prisma.document.delete({ where: { id: document.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.page.delete({ where: { id: note.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 15000)
