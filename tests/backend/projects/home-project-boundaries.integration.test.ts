import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { HomeService } from "@server/api/v1/projects/home.service"
import { ProjectsService } from "@server/api/v1/projects/projects.service"

it("hydrates only displayed Home Projects while aggregating authorized history across the full collection", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback bounded Home Projects")
  const hydrated: number[] = [], named: number[] = []
  const database = prisma.$extends({ query: { project: { async findMany({ args, query }) {
    const rows = await query(args)
    if (args.include) hydrated.push(rows.length)
    else named.push(rows.length)
    return rows
  } } } })
  try {
    await database.$transaction(async tx => {
      const now = new Date(), before = new Date(+now - 600000)
      const [viewer, peer] = await Promise.all(["Viewer", "Peer"].map(username => tx.user.create({ data: { email: `${crypto.randomUUID()}@home-bound.test`, username, created_at: before, updated_at: before } })))
      for (let index = 0; index < 100; index++) {
        const project = await tx.project.create({ data: { owner_id: viewer.id, name: `Owned ${index}`, created_at: before, updated_at: before } })
        await tx.entry.create({ data: { project_id: project.id, user_id: viewer.id, creation_origin: "project_material", status: "published", published_at: new Date(+before + index * 1000), created_at: before, updated_at: before } })
      }
      const invitation = await tx.project.create({ data: { owner_id: peer.id, name: "Pending private Project", created_at: now, updated_at: now,
        participations: { create: { user_id: viewer.id, invited_by_id: peer.id, status: "pending", invited_at: now, created_at: now, updated_at: now } } } })
      await tx.entry.create({ data: { project_id: invitation.id, user_id: viewer.id, creation_origin: "project_material", status: "published", published_at: now, created_at: now, updated_at: now } })
      const projects = new ProjectsService()
      Object.assign(projects, { prisma: tx })
      const service = new HomeService()
      Object.assign(service, { prisma: tx, projects, entries: { show: async (_project: number, id: number) => ({ id }) },
        unseen: { countResponsesToOwnPosts: async () => 0, countForUserWithRooms: async () => ({ overall: { total: 0 }, byRoom: new Map() }) } })
      const snapshot = await service.snapshot(viewer.id, "UTC", true)
      expect(snapshot.recentProjects).toHaveLength(3)
      expect(snapshot.recentEntries).toHaveLength(4)
      expect(snapshot.activityEntries).toHaveLength(50)
      expect(snapshot.activityNextCursor).toBeTruthy()
      expect(snapshot.contributions.reduce((sum, day) => sum + day.count, 0)).toBe(100)
      expect(snapshot.recentProjects.every(item => item.project.id !== invitation.id)).toBe(true)
      expect(snapshot.activityEntries?.every(item => item.projectId !== invitation.id)).toBe(true)
      expect(hydrated).toEqual([4])
      expect(named).toEqual([50])
      const next = await service.snapshot(viewer.id, "UTC", true, snapshot.activityNextCursor!)
      expect(next.activityEntries).toHaveLength(50)
      expect(next.activityNextCursor).toBeNull()
      expect(new Set([...snapshot.activityEntries!, ...next.activityEntries!].map(entry => entry.id)).size).toBe(100)
      await tx.projectParticipation.updateMany({ where: { project_id: invitation.id }, data: { status: "accepted" } })
      const accepted = await service.snapshot(viewer.id)
      expect(accepted.recentProjects[0].project.id).toBe(invitation.id)
      expect(accepted.contributions.reduce((sum, day) => sum + day.count, 0)).toBe(101)
      await tx.projectParticipation.updateMany({ where: { project_id: invitation.id }, data: { status: "declined" } })
      expect((await service.snapshot(viewer.id)).recentProjects.every(item => item.project.id !== invitation.id)).toBe(true)
      expect(hydrated.every(count => count <= 7)).toBe(true)
      // Empty Projects still fill Home, without a newer pending invitation
      // consuming one of its three slots or exposing private material.
      await tx.entry.deleteMany({ where: { user_id: viewer.id } })
      await tx.projectParticipation.updateMany({ where: { project_id: invitation.id }, data: { status: "pending" } })
      const empty = await service.snapshot(viewer.id)
      expect(empty.recentEntries).toEqual([])
      expect(empty.recentProjects.map(item => item.project.name)).toEqual(["Owned 99", "Owned 98", "Owned 97"])
      expect(empty.recentProjects.every(item => item.entry === null)).toBe(true)
      expect(hydrated.at(-1)).toBe(3)
      await expect(projects.homeSummaries(viewer.id, Array.from({ length: 8 }, (_, index) => index + 1))).rejects.toThrow("exceeds its bound")
      throw rollback
    }, { timeout: 20000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
}, 30000)
