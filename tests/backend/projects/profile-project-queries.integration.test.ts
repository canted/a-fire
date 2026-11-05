import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { ProjectsService } from "@server/api/v1/projects/projects.service"

it("batches profile Project images as the list grows while excluding private Projects", async () => {
  const queries: string[] = []
  const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
  prisma.$on("query", event => queries.push(event.query))
  const rollback = new Error("Rollback profile query fixtures")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await Promise.all(["owner", "viewer"].map(role => tx.user.create({ data: {
        email: `${crypto.randomUUID()}@profile-project.test`, username: role, created_at: now, updated_at: now,
      } })))
      const [owner, viewer] = users
      const room = await tx.room.create({ data: { name: "Profile Room", created_at: now, updated_at: now } })
      const service = new ProjectsService()
      Object.assign(service, { prisma: tx })
      const add = (accepted: boolean) => tx.project.create({ data: {
        owner_id: owner.id, name: accepted ? "Shared collaboration" : "Private Project", created_at: now, updated_at: now,
        rooms: { create: { room_id: room.id, created_at: now } },
        participations: { create: { user_id: viewer.id, invited_by_id: owner.id, status: accepted ? "accepted" : "pending", invited_at: now, created_at: now, updated_at: now } },
      } })
      await add(false)
      const first = await add(true)
      await add(true)
      await add(true)
      const blob = await tx.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "icon.png", service_name: "test", byte_size: 1, created_at: now } })
      await tx.activeStorageAttachment.create({ data: { record_type: "Project", record_id: first.id, name: "icon", blob_id: blob.id, created_at: now } })
      const read = async (count: number) => {
        queries.length = 0
        const projects = await service.listForUser(owner.id, room.id, viewer.id)
        const reads = queries.filter(query => /\bSELECT\b/i.test(query))
        expect(projects).toHaveLength(count)
        expect(projects.every(project => project.name === "Shared collaboration")).toBe(true)
        expect(projects.find(project => project.id === first.id)?.icon_url).toContain(`/uploads/${blob.id}`)
        expect(reads.filter(query => query.includes("FROM unnest") && query.includes("active_storage_attachments"))).toHaveLength(1)
        return reads.length
      }
      const small = await read(3)
      for (let i = 0; i < 27; i++) await add(true)
      expect(await read(30)).toBe(small)
      throw rollback
    }, { timeout: 20000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
