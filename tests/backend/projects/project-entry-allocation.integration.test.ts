import "reflect-metadata"
import { expect, it } from "vitest"
import { ForbiddenException } from "@nestjs/common"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"

it("serializes resumable allocation and rechecks access after an earlier admission read", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const users = await Promise.all(["Owner", "Author"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@allocation.test`, username, created_at: now, updated_at: now } })))
  const [owner, author] = users
  const project = await prisma.project.create({ data: { owner_id: owner.id, name: "Private", created_at: now, updated_at: now } })
  const participant = await prisma.projectParticipation.create({ data: { project_id: project.id, user_id: author.id, invited_by_id: owner.id, status: "accepted", invited_at: now, created_at: now, updated_at: now } })
  const service = new ProjectEntriesService()
  Object.assign(service, { prisma })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let reached!: () => void
  const ready = new Promise<void>(resolve => { reached = resolve })
  let work: Promise<unknown> | undefined
  try {
    const drafts = await Promise.all(Array.from({ length: 6 }, () => service.create(project.id, author.id)))
    expect(new Set(drafts.map(draft => draft.id)).size).toBe(1)
    expect(await prisma.entry.count({ where: { project_id: project.id } })).toBe(1)
    const requestKey = crypto.randomUUID()
    const keyed = await Promise.all(Array.from({ length: 4 }, () => service.create(project.id, author.id, { fresh: true, request_key: requestKey })))
    expect(new Set(keyed.map(draft => draft.id)).size).toBe(1)
    expect(keyed[0].id).not.toBe(drafts[0].id)
    let first = true
    const scoped = prisma.$extends({ query: { project: { async findUnique({ args, query }) {
      const result = await query(args)
      if (first) { first = false; reached(); await held }
      return result
    } } } })
    const delayed = new ProjectEntriesService()
    Object.assign(delayed, { prisma: scoped })
    work = delayed.create(project.id, author.id, { fresh: true, request_key: crypto.randomUUID() })
    const denied = expect(work).rejects.toBeInstanceOf(ForbiddenException)
    await ready
    await prisma.projectParticipation.update({ where: { id: participant.id }, data: { status: "removed" } })
    release()
    await denied
    expect(await prisma.entry.count({ where: { project_id: project.id } })).toBe(2)
  } finally {
    release()
    await work?.catch(() => {})
    await prisma.entry.deleteMany({ where: { project_id: project.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await prisma.$disconnect()
  }
})
