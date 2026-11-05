import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { homeEntrySummary } from "@server/api/v1/projects/home-entry-summary"

it("bounds Home previews while aggregating full private history in the viewer's timezone", async () => {
  const prisma = new PrismaService(), rollback = new Error("Rollback Home fixture")
  const now = new Date("2026-01-02T12:00:00Z"), at = new Date("2026-01-01T00:30:00Z")
  try {
    await expect(prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'America/Los_Angeles'`
      const user = await tx.user.create({ data: { username: "Home test", email: `${crypto.randomUUID()}@home.test`, created_at: now, updated_at: now } })
      const peer = await tx.user.create({ data: { username: "Peer", email: `${crypto.randomUUID()}@home.test`, created_at: now, updated_at: now } })
      const projects = await Promise.all(Array.from({ length: 4 }, (_, i) => tx.project.create({ data: { name: `Project ${i}`, owner_id: i === 3 ? peer.id : user.id, created_at: now, updated_at: now } })))
      await tx.projectParticipation.create({ data: { project_id: projects[3].id, user_id: user.id, invited_by_id: peer.id, status: "pending", invited_at: now, created_at: now, updated_at: now } })
      const base = { user_id: user.id, status: "published", creation_origin: "project_material", published_at: at, created_at: at, updated_at: at }
      await tx.entry.createMany({ data: Array.from({ length: 1000 }, () => ({ ...base, project_id: projects[0].id })) })
      for (const project of projects.slice(1)) await tx.entry.create({ data: { ...base, project_id: project.id } })
      await tx.entry.create({ data: { ...base, project_id: projects[0].id, status: "draft" } })
      await tx.entry.create({ data: { ...base, project_id: projects[0].id, status: "deleted" } })
      await tx.entry.create({ data: { ...base, project_id: projects[0].id, published_at: new Date("2020-01-01Z") } })
      const fallback = await tx.entry.create({ data: { ...base, project_id: projects[0].id, published_at: null } })
      const projectIds = projects.slice(0, 3).map(p => p.id)
      const result = await homeEntrySummary(tx, user.id, "America/Los_Angeles", now)
      expect((await homeEntrySummary(tx, user.id, "UTC", at)).contributions).toEqual([{ date: "2026-01-01", count: 1003 }])
      expect(result.recent).toHaveLength(4)
      expect(result.recent[0].id).toBe(fallback.id)
      expect(result.projects).toHaveLength(3)
      expect(new Set(result.projects.map(p => p.project_id))).toEqual(new Set(projectIds))
      expect(result.contributions).toEqual([{ date: "2025-12-31", count: 1003 }])
      expect((await homeEntrySummary(tx, user.id, "UTC", now)).contributions).toEqual([{ date: "2026-01-01", count: 1003 }])
      await tx.projectParticipation.updateMany({ where: { project_id: projects[3].id }, data: { status: "accepted" } })
      expect((await homeEntrySummary(tx, user.id, "UTC", now)).contributions).toEqual([{ date: "2026-01-01", count: 1004 }])
      await tx.projectParticipation.updateMany({ where: { project_id: projects[3].id }, data: { status: "declined" } })
      await tx.project.updateMany({ where: { id: { in: projectIds } }, data: { owner_id: peer.id } })
      expect(await homeEntrySummary(tx, user.id, "UTC", now)).toEqual({ recent: [], projects: [], contributions: [] })
      throw rollback
    }, { timeout: 15000 })).rejects.toBe(rollback)
  } finally { await prisma.$disconnect() }
})
