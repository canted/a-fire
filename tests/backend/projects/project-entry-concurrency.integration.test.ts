import "reflect-metadata"
import { expect, it } from "vitest"
import { ConflictException } from "@nestjs/common"
import { PrismaService } from "@server/prisma/prisma.service"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"

it("rolls back stale Project saves and preserves the newer Document", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@entry-race.test`, username: "Author", created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "draft", created_at: now, updated_at: now } })
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
  await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: doc("original"), version: 1, created_at: now, updated_at: now } })
  // Historical rows may retain finer precision than the JavaScript representation.
  await prisma.$executeRaw`UPDATE entries SET updated_at = updated_at + interval '123 microseconds' WHERE id = ${post.id}`
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let prepared!: () => void
  const ready = new Promise<void>(resolve => { prepared = resolve })
  const makeService = (wait: boolean) => {
    const service = new ProjectEntriesService()
    Object.assign(service, { prisma, uploads: { assertContentMediaAccess: async () => { if (wait) { prepared(); await held } } } })
    return service
  }
  let stale: Promise<unknown> | undefined
  try {
    for (const format of ["text", "image", "audio", "video", "link"]) {
      await expect(makeService(false).update(project.id, post.id, user.id, {
        expected_revision: now.getTime(), format, content: doc("rejected type change"),
      })).rejects.toThrow("Unsupported post format")
    }
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).format).toBe("mixed_media")
    expect((await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: post.id } })).content).toEqual(doc("original"))
    stale = makeService(true).update(project.id, post.id, user.id, { expected_revision: now.getTime(), content: doc("stale"), intent: "stale title" })
    const rejected = expect(stale).rejects.toBeInstanceOf(ConflictException)
    const genericPosts = new EntriesService()
    Object.assign(genericPosts, { prisma })
    await expect(genericPosts.saveContent(post.id, user.id, doc("bypass"))).rejects.toThrow("through its project")
    await ready
    await makeService(false).update(project.id, post.id, user.id, { expected_revision: now.getTime(), content: doc("newer"), intent: "newer title" })
    await expect(makeService(false).update(project.id, post.id, user.id, { expected_revision: now.getTime(), intent: "late browser draft" })).rejects.toBeInstanceOf(ConflictException)
    await expect(makeService(false).update(project.id, post.id, user.id, { intent: "missing revision" })).rejects.toThrow("expected_revision")
    release()
    await rejected
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ project_intent: "newer title" })
    expect(await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: post.id } })).toMatchObject({ content: doc("newer"), version: 2 })
  } finally {
    release()
    await stale?.catch(() => {})
    await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: post.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
