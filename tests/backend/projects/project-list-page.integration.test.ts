import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { ProjectsService } from "@server/api/v1/projects/projects.service"

it("pages Projects in activity order with private invitations and revocable access", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback Project pagination")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date("2026-10-01T12:00:00Z")
      const [viewer, peer] = await Promise.all(["Viewer", "Peer"].map(username => tx.user.create({ data: { username, email: `${crypto.randomUUID()}@project-page.test`, created_at: now, updated_at: now } })))
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: viewer.id, created_at: now, updated_at: now } })
      const ids: number[] = []
      for (let index = 0; index < 45; index++) {
        const project = await tx.project.create({ data: { owner_id: viewer.id, name: `Project ${index}`, created_at: now, updated_at: now,
          rooms: { create: { room_id: room.id, created_at: now } } } })
        ids.push(project.id)
        if (index < 33) await tx.entry.create({ data: { project_id: project.id, user_id: viewer.id, status: "published", creation_origin: "project_material", published_at: now, created_at: now, updated_at: now } })
      }
      const invitation = await tx.project.create({ data: { owner_id: peer.id, name: "Invitation", description: "Private description", created_at: now, updated_at: now,
        participations: { create: { user_id: viewer.id, invited_by_id: peer.id, status: "pending", invited_at: now, created_at: now, updated_at: now } } } })
      await tx.entry.create({ data: { project_id: invitation.id, user_id: peer.id, status: "published", creation_origin: "project_material", project_intent: "Secret", published_at: new Date(+now + 86400000), created_at: now, updated_at: now } })
      const service = new ProjectsService()
      Object.assign(service, { prisma: tx })
      const first = await service.listMine(viewer.id, undefined, "")
      expect(first.projects.map(row => row.id)).toEqual(ids.slice(3, 33).reverse())
      expect(first.nextCursor).toBeTruthy()
      // The cursor survives deletion of its last Project, without shifting pages.
      await tx.project.delete({ where: { id: first.projects.at(-1)!.id } })
      const second = await service.listMine(viewer.id, undefined, first.nextCursor!)
      expect(second.projects.map(row => row.id)).toEqual([...ids.slice(0, 3).reverse(), invitation.id, ...ids.slice(33).reverse()])
      expect(second.nextCursor).toBeNull()
      expect(second.projects.find(row => row.id === invitation.id)).toMatchObject({ description: null, latest_material: null, material_activity_at: null, participants: [], rooms: [] })
      await expect(service.listMine(peer.id, undefined, first.nextCursor!)).rejects.toThrow("Invalid Project list cursor")
      await expect(service.listMine(viewer.id, room.id, first.nextCursor!)).rejects.toThrow("Invalid Project list cursor")
      await tx.projectParticipation.updateMany({ where: { project_id: invitation.id }, data: { status: "declined" } })
      expect((await service.listMine(viewer.id, undefined, first.nextCursor!)).projects.map(row => row.id)).not.toContain(invitation.id)
      const scoped = await service.listMine(viewer.id, room.id, "")
      expect(scoped.projects).toHaveLength(30)
      await tx.roomMembership.updateMany({ where: { room_id: room.id, user_id: viewer.id }, data: { disabled: true } })
      expect((await service.listMine(viewer.id, room.id, scoped.nextCursor!)).projects).toEqual([])
      throw rollback
    }, { timeout: 20000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
}, 30000)
