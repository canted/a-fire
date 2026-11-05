import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { projectEntryPage } from "@server/api/v1/projects/project-entry-page"

it("moves and deletes an original without changing its document or shared copy", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback entry management fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const author = await tx.user.create({ data: { email: `${crypto.randomUUID()}@entry-management.test`, username: "Author", created_at: now, updated_at: now } })
      const projects = await Promise.all(["Original", "Destination"].map(name => tx.project.create({ data: { name, owner_id: author.id, created_at: now, updated_at: now } })))
      const post = await tx.entry.create({ data: { project_id: projects[0].id, user_id: author.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now, published_at: now } })
      const document = await tx.document.create({ data: { docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "audio", attrs: { audioAssetId: 123 } }] }, version: 1, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Shared Room", owner_id: author.id, created_at: now, updated_at: now } })
      const copy = await tx.entry.create({ data: { user_id: author.id, source_entry_id: post.id, room_id: room.id, status: "published", created_at: now, updated_at: now } })
      const service = new ProjectEntriesService()
      Object.assign(service, { prisma: new Proxy(tx, { get(target, prop) { return prop === "$transaction" ? (fn: (client: typeof tx) => unknown) => fn(tx) : Reflect.get(target, prop) } }) })
      await service.changeLocation(projects[0].id, post.id, author.id, now.getTime(), projects[1].id)
      const moved = await tx.entry.findUniqueOrThrow({ where: { id: post.id } })
      expect(moved.project_id).toBe(projects[1].id)
      expect((await projectEntryPage(tx, projects[0].id, author.id)).ids).not.toContain(post.id)
      expect((await projectEntryPage(tx, projects[1].id, author.id)).ids).toContain(post.id)
      await expect(service.changeLocation(projects[0].id, post.id, author.id, now.getTime(), null)).rejects.toThrow()
      await service.changeLocation(projects[1].id, post.id, author.id, moved.updated_at.getTime(), null)
      expect((await projectEntryPage(tx, projects[1].id, author.id)).ids).not.toContain(post.id)
      expect(await tx.entry.findUniqueOrThrow({ where: { id: copy.id } })).toEqual(copy)
      expect(await tx.document.findUniqueOrThrow({ where: { id: document.id } })).toEqual(document)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
