import "reflect-metadata"
import { it, expect } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"

it("preserves Document authority, mention access and concurrent edits for a Project Entry", async () => {
  const prisma = new PrismaService(), now = new Date()
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@content-authority.test`, username: "Author", created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "draft", format: "mixed_media", created_at: now, updated_at: now } })
  const service = new ProjectEntriesService()
  Object.assign(service, { prisma, uploads: { assertContentMediaAccess: async () => {} } })
  try {
    await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: doc("original"), version: 1, created_at: now, updated_at: now } })
    for (const text of ["first edit", "second edit"]) {
      const current = await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })
      const result = await service.update(project.id, post.id, user.id, { expected_revision: current.updated_at.getTime(), content: doc(text) })
      expect(result.content).toEqual(doc(text))
      expect((await prisma.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: post.id } } })).content).toEqual(doc(text))
    }
    const retainedMention = { type: "mention", attrs: { targetType: "note", targetId: "2147483647", label: "Retained Note", href: "/app/note/2147483647" } }
    const retained = { type: "doc", content: [{ type: "paragraph", content: [retainedMention] }] }
    await prisma.document.update({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: post.id } }, data: { content: retained } })
    const current = await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })
    const edited = { type: "doc", content: [{ type: "paragraph", content: [retainedMention, { type: "text", text: "My new annotation" }] }] }
    await service.update(project.id, post.id, user.id, { expected_revision: current.updated_at.getTime(), content: edited })
    const before = await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })
    const changedReference = structuredClone(edited)
    changedReference.content[0].content[0] = { ...retainedMention, attrs: { ...retainedMention.attrs, label: "Changed reference" } }
    await expect(service.update(project.id, post.id, user.id, { expected_revision: before.updated_at.getTime(), content: changedReference })).rejects.toThrow("Mention unavailable")
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(before)
    expect((await prisma.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: post.id } } })).content).toEqual(edited)
    const concurrent = doc("Concurrent stored edit")
    Object.assign(service, { uploads: { assertContentMediaAccess: async () => {
      await prisma.document.update({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: post.id } }, data: { content: concurrent } })
    } } })
    await expect(service.update(project.id, post.id, user.id, { expected_revision: before.updated_at.getTime(), content: doc("Overwrite attempt") })).rejects.toThrow("document changed while saving")
    expect((await prisma.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: post.id } } })).content).toEqual(concurrent)
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(before)
  } finally {
    await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: post.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
