import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossWorkers } from "@server/queue/boss.workers"
import { BossService } from "@server/queue/boss.service"
import { ReflectionsService } from "@server/api/v1/reflections/reflections.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["Post", "Reply"] as const)("commits a %s reflection and its job together", async type => {
  const prisma = new PrismaService()
  const boss = new BossService()
  await boss.start()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@reflection-job.test`, username: "Author", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const page = await prisma.page.create({ data: { title: "Note", room_id: room.id, created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, status: "published", published_at: now, created_at: now, updated_at: now } })
  const reply = await prisma.reply.create({ data: { entry_id: post.id, user_id: user.id, status: "published", published_at: now, created_at: now, updated_at: now } })
  const realtime = { emit: vi.fn(), entryRoom: () => "post", boardRoom: () => "board" }
  const service = withTestDependencies(new ReflectionsService(), { prisma, boss, realtime })
  const ids: string[] = []
  const enqueue = boss.enqueueInTransaction.bind(boss)
  let fail = true
  const spy = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
    const id = await enqueue(...args)
    ids.push(id)
    if (fail) throw new Error("Queue insertion failed")
    return id
  })
  const create = (writer: Pick<ReflectionsService, "createForPost" | "createForReply">) => type === "Post" ? writer.createForPost(post.id, user.id, page.id) : writer.createForReply(reply.id, user.id, page.id)
  try {
    // Membership must not turn an unpublished source into shared Note content.
    await prisma.entry.update({ where: { id: post.id }, data: { status: "draft", published_at: null } })
    await expect(create(service)).rejects.toThrow("Only published entries can be saved to Notes")
    expect(ids).toHaveLength(0)
    await prisma.entry.update({ where: { id: post.id }, data: { status: "published", published_at: now } })
    if (type === "Reply") {
      await prisma.reply.update({ where: { id: reply.id }, data: { status: "draft", published_at: null } })
      await expect(create(service)).rejects.toThrow("Only published replies can be saved to Notes")
      expect(ids).toHaveLength(0)
      await prisma.reply.update({ where: { id: reply.id }, data: { status: "published", published_at: now } })
    }
    let unpublished = false
    const changingSource = prisma.$extends({ query: { page: { async findUnique({ args, query }) {
      const result = await query(args)
      if (!unpublished && args.select?.room_id) {
        unpublished = true
        await prisma.entry.update({ where: { id: post.id }, data: { status: "draft", published_at: null } })
      }
      return result
    } } } })
    const changingWriter = withTestDependencies(new ReflectionsService(), { prisma: changingSource, boss, realtime })
    await expect(create(changingWriter)).rejects.toThrow("Only published entries can be saved to Notes")
    expect(ids).toHaveLength(0)
    await prisma.entry.update({ where: { id: post.id }, data: { status: "published", published_at: now } })
    await expect(create(service)).rejects.toThrow("Queue insertion failed")
    expect(await prisma.reflection.count({ where: { page_id: page.id } })).toBe(0)
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${ids[0]}::uuid`).toEqual([])
    expect(realtime.emit).not.toHaveBeenCalled()
    fail = false
    await Promise.all(Array.from({ length: 6 }, () => create(service)))
    await create(service) // Retry after a successful response was lost.
    expect(await prisma.reflection.count({ where: { page_id: page.id } })).toBe(1)
    expect(ids).toHaveLength(2) // One rolled-back job and one committed job.
    const reflection = await prisma.reflection.findFirstOrThrow({ where: { page_id: page.id } })
    const [job] = await prisma.$queryRaw<Array<{ data: { reflectionId: number } }>>`SELECT data FROM pgboss.job WHERE id = ${ids[1]}::uuid`
    expect(job.data.reflectionId).toBe(reflection.id)
    await prisma.document.create({ data: {
      docable_type: type, docable_id: type === "Post" ? post.id : reply.id,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Cancelled insertion" }] }] },
      created_at: now, updated_at: now,
    } })
    const delayedWorker = withTestDependencies(new BossWorkers(), { prisma })
    await prisma.entry.update({ where: { id: post.id }, data: { creation_origin: "chat_attachment" } })
    await prisma.chatMessage.create({ data: {
      room_id: room.id, author_id: user.id, entry_id: post.id, body: "", masked_alias: "Author",
      content: { type: "doc", content: [{ type: "image", attrs: { src: "/fixture" } }] },
      fire_at: now, expires_at: new Date(now.getTime() + 86400000), pinned_at: now,
      created_at: new Date(now.getTime() - 15 * 86400000), updated_at: now,
    } })
    await expect(create(service)).rejects.toThrow("Chat attachment is no longer available")
    await expect(delayedWorker.handleReflectionApply({ reflectionId: reflection.id })).rejects.toThrow("Chat attachment is no longer available")
    expect(await prisma.document.count({ where: { docable_type: "Note", docable_id: page.id } })).toBe(0)
    await prisma.chatMessage.updateMany({ where: { entry_id: post.id }, data: { created_at: now } })
    await create(service)
    expect(ids).toHaveLength(2)

    await prisma.entry.update({ where: { id: post.id }, data: { status: "draft", published_at: null } })
    await expect(delayedWorker.handleReflectionApply({ reflectionId: reflection.id })).rejects.toThrow("Only published entries can be saved to Notes")
    expect(await prisma.document.count({ where: { docable_type: "Note", docable_id: page.id } })).toBe(0)
    await prisma.entry.update({ where: { id: post.id }, data: { status: "published", published_at: now } })
    if (type === "Reply") {
      await prisma.reply.update({ where: { id: reply.id }, data: { status: "draft", published_at: null } })
      await expect(delayedWorker.handleReflectionApply({ reflectionId: reflection.id })).rejects.toThrow("Only published replies can be saved to Notes")
      expect(await prisma.document.count({ where: { docable_type: "Note", docable_id: page.id } })).toBe(0)
      await prisma.reply.update({ where: { id: reply.id }, data: { status: "published", published_at: now } })
    }
    // Pause at the transaction hint read, after the worker has read the queued record.
    // Remove through the real service before the worker acquires the Note lock.
    let removed = false
    const racing = prisma.$extends({ query: { page: { async findUnique({ args, query }) {
      const result = await query(args)
      if (!removed && args.select?.room_id) {
        removed = true
        if (type === "Post") await service.deleteForPost(post.id, user.id, page.id)
        else await service.deleteForReply(reply.id, user.id, page.id)
      }
      return result
    } } } })
    const worker = withTestDependencies(new BossWorkers(), { prisma: racing })
    await worker.handleReflectionApply({ reflectionId: reflection.id })
    expect(removed).toBe(true)
    expect(await prisma.reflection.count({ where: { page_id: page.id } })).toBe(0)
    expect(await prisma.document.count({ where: { docable_type: "Note", docable_id: page.id } })).toBe(0)
    let revoked = false
    const stale = prisma.$extends({ query: { page: { async findUnique({ args, query }) {
      const result = await query(args)
      if (!revoked && args.select?.room_id) {
        revoked = true
        await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: true, revoked_at: now } })
      }
      return result
    } } } })
    const staleService = withTestDependencies(new ReflectionsService(), { prisma: stale, boss, realtime })
    await expect(create(staleService)).rejects.toThrow("Forbidden")
    expect(await prisma.reflection.count({ where: { page_id: page.id } })).toBe(0)
    expect(ids).toHaveLength(2)
  } finally {
    spy.mockRestore()
    await boss.onModuleDestroy()
    for (const id of ids) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.reflection.deleteMany({ where: { page_id: page.id } })
    await prisma.document.deleteMany({ where: { OR: [
      { docable_type: "Post", docable_id: post.id }, { docable_type: "Reply", docable_id: reply.id },
      { docable_type: "Note", docable_id: page.id },
    ] } })
    await prisma.reply.delete({ where: { id: reply.id } })
    await prisma.chatMessage.deleteMany({ where: { entry_id: post.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.page.delete({ where: { id: page.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
