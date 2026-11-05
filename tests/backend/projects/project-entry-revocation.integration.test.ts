import "reflect-metadata"
import { expect, it } from "vitest"
import { ForbiddenException } from "@nestjs/common"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"

it.each(["before transaction", "during transaction"])("serializes Project Entry edits with access revocation %s", async phase => {
  const prisma = new PrismaService()
  const now = new Date()
  const users = await Promise.all(["Owner", "Author"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@project-revocation.test`, username, created_at: now, updated_at: now } })))
  const [owner, author] = users
  const project = await prisma.project.create({ data: { owner_id: owner.id, name: "Private", created_at: now, updated_at: now } })
  const participant = await prisma.projectParticipation.create({ data: { project_id: project.id, user_id: author.id, invited_by_id: owner.id, status: "accepted", invited_at: now, created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: author.id, project_id: project.id, creation_origin: "project_material", status: "draft", created_at: now, updated_at: now } })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let reached!: () => void
  const ready = new Promise<void>(resolve => { reached = resolve })
  const scoped = prisma.$extends({ query: { entry: { async update({ args, query }) {
    if (phase === "during transaction") { reached(); await held }
    return query(args)
  } } } })
  const service = new ProjectEntriesService()
  Object.assign(service, { prisma: scoped, uploads: { assertContentMediaAccess: async () => { if (phase === "before transaction") { reached(); await held } } } })
  let work: Promise<unknown> | undefined
  try {
    work = service.update(project.id, post.id, author.id, { expected_revision: now.getTime(), intent: "Edited" })
    const outcome = work.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
    await ready
    if (phase === "before transaction") {
      await prisma.projectParticipation.update({ where: { id: participant.id }, data: { status: "removed" } })
    } else {
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`
        await tx.$executeRaw`UPDATE project_participations SET status = 'removed' WHERE id = ${participant.id}`
      })).rejects.toMatchObject({ code: "P2010", meta: { code: "55P03" } })
    }
    release()
    const result = await outcome
    if (phase === "before transaction") {
      expect(result.error).toBeInstanceOf(ForbiddenException)
      expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).project_intent).toBeNull()
    } else {
      expect(result.error).toBeUndefined()
      expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).project_intent).toBe("Edited")
      await prisma.projectParticipation.update({ where: { id: participant.id }, data: { status: "removed" } })
      await expect(service.update(project.id, post.id, author.id, { expected_revision: Date.now(), intent: "Denied" })).rejects.toBeInstanceOf(ForbiddenException)
    }
  } finally {
    release()
    await work?.catch(() => {})
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await prisma.$disconnect()
  }
})
