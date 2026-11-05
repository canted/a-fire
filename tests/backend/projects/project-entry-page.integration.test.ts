import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { projectEntryPage } from "@server/api/v1/projects/project-entry-page"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { Prisma } from "@prisma/client"

it("pages grouped private history without losing feedback or timestamp precision", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback page fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Owner", email: `${crypto.randomUUID()}@entry-page.test`, created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
      const base = { project_id: project.id, user_id: user.id, status: "published", created_at: now, updated_at: now, published_at: now }
      const old = await tx.entry.create({ data: { ...base, creation_origin: "project_material", published_at: new Date(now.getTime()-1000) } })
      const source = await tx.entry.create({ data: { ...base, creation_origin: "project_material" } })
      const feedback = await tx.entry.createManyAndReturn({ data: Array.from({ length: 65 }, () => ({ ...base, creation_origin: "project_feedback", source_entry_id: source.id })) })
      feedback.sort((a,b) => a.id-b.id)
      // Preserve sub-millisecond ordering; a JS Date cursor would skip these rows.
      for (const [index, row] of feedback.entries()) await tx.$executeRaw`UPDATE entries SET published_at='2026-01-01 00:00:00'::timestamp + ${index} * interval '1 microsecond' WHERE id=${row.id}`
      await tx.entry.create({ data: { ...base, creation_origin: "project_material", status: "draft" } })
      const expected = [source.id, ...feedback.map(p => p.id), old.id]
      const ids: number[] = []
      let cursor: string | undefined
      do {
        const page = await projectEntryPage(tx, project.id, user.id, cursor)
        expect(page.ids.length).toBeLessThanOrEqual(30)
        ids.push(...page.ids)
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      expect(ids).toEqual(expected)
      const first = await projectEntryPage(tx, project.id, user.id)
      const scoped = await projectEntryPage(tx, project.id, user.id, undefined, source.id)
      expect(scoped.ids).toEqual(expected.slice(0,30))
      await expect(projectEntryPage(tx, project.id, user.id, scoped.nextCursor!)).rejects.toThrow("Invalid Project Entry cursor")
      await expect(projectEntryPage(tx, project.id, user.id, first.nextCursor!, source.id)).rejects.toThrow("Invalid Project Entry cursor")
      expect((await projectEntryPage(tx, project.id, user.id, undefined, old.id)).ids).toEqual([old.id])
      expect((await projectEntryPage(tx, project.id, user.id, undefined, feedback[0].id)).ids).toEqual([feedback[0].id])
      await expect(projectEntryPage(tx, project.id + 1, user.id, first.nextCursor!)).rejects.toThrow("Invalid Project Entry cursor")
      await expect(projectEntryPage(tx, project.id, user.id + 1, first.nextCursor!)).rejects.toThrow("Invalid Project Entry cursor")
      await expect(projectEntryPage(tx, project.id, user.id, "bad")).rejects.toThrow("Invalid Project Entry cursor")
      const anchor = first.ids.at(-1)!
      await tx.entry.delete({ where: { id: anchor } })
      expect((await projectEntryPage(tx, project.id, user.id, first.nextCursor!)).ids).toEqual(expected.slice(30,60))
      const service = new ProjectEntriesService(); Object.assign(service, { prisma: tx })
      await expect(service.page(project.id, user.id + 1, first.nextCursor!)).rejects.toThrow("Project not found")
      expect((await service.page(project.id, user.id)).entries.map(entry => entry.id)).toEqual(expected.filter(id => id !== anchor).slice(0,30))
      const collaborator = await tx.user.create({ data: { username: "Collaborator", email: `${crypto.randomUUID()}@entry-page.test`, created_at: now, updated_at: now } })
      const participation = await tx.projectParticipation.create({ data: { project_id: project.id, user_id: collaborator.id, invited_by_id: user.id, status: "accepted", invited_at: now, created_at: now, updated_at: now } })
      const collaboratorPage = await service.page(project.id, collaborator.id)
      expect(collaboratorPage.entries).toHaveLength(30)
      await tx.projectParticipation.update({ where: { id: participation.id }, data: { status: "removed" } })
      await expect(service.page(project.id, collaborator.id, collaboratorPage.nextCursor!)).rejects.toThrow("Project not found")
      await tx.entry.createMany({ data: Array.from({ length: 4096 }, () => ({ ...base, creation_origin: "project_material", published_at: new Date(now.getTime()-2000) })) })
      await tx.$executeRaw`SET LOCAL plan_cache_mode = force_generic_plan`
      let query: Prisma.Sql | undefined
      const measured = { $queryRaw: async (sql: Prisma.Sql) => { query = sql; return tx.$queryRaw(sql) } } as Pick<typeof tx, "$queryRaw">
      expect((await projectEntryPage(measured, project.id, user.id)).ids).toEqual(expected.filter(id => id !== anchor).slice(0,30))
      const plan = await tx.$queryRaw<Array<{ "QUERY PLAN": Array<Record<string, any>> }>>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query!}`)
      const summary = plan[0]["QUERY PLAN"][0]
      if (process.env.PROJECT_PAGE_EXPLAIN === "1") process.stdout.write(JSON.stringify(summary) + "\n")
      expect(summary.Plan["Actual Rows"]).toBe(31)
      expect(summary.Plan["Temp Written Blocks"]).toBe(0)
      const nodes = (node: Record<string, any>): Array<Record<string, any>> => [node, ...(node.Plans ?? []).flatMap(nodes)]
      expect(nodes(summary.Plan).reduce((sum,node) => sum + (node["Rows Removed by Join Filter"] ?? 0) * node["Actual Loops"], 0)).toBeLessThan(10000)
      process.stdout.write(JSON.stringify({ projectEntryPagePlan: { rows: 4162, returned: summary.Plan["Actual Rows"], executionMs: summary["Execution Time"], sharedHits: summary.Plan["Shared Hit Blocks"] } }) + "\n")
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
}, 20000)
