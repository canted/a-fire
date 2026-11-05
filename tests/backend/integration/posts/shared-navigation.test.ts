import { projectNavigationCandidate } from "@server/api/v1/entries/project-navigation-candidate"
import { Prisma, PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { EntriesReadService } from "@server/api/v1/entries/entries.read.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

describe("shared post navigation authorization", () => {
  it("keeps author and project navigation within the current Room, including revoked Project access", async () => {
    const navigationQueries: Array<{ exclusionCount: number; hasCursor: boolean }> = []
    const prisma = new PrismaClient().$extends({ query: { entry: {
      async findMany({ args, query }) {
        if (args.where?.creation_origin === "project_material" && args.select?.id) throw new Error("Navigation must not materialize private source IDs")
        return query(args)
      }, async findFirst({ args, query }) {
      if (args.where?.AND && args.where.status === "published") {
        const id = args.where.id
        navigationQueries.push({
          exclusionCount: typeof id === "object" && Array.isArray(id?.notIn) ? id.notIn.length : 0,
          hasCursor: Boolean(args.cursor),
        })
      }
      return query(args)
    } } } })
    const rollback = new Error("Rollback isolated shared navigation fixtures")
    const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T12:00:00Z`)
    try {
      await prisma.$transaction(async (tx) => {
        const prefix = randomUUID()
        const now = new Date()
        const [owner, viewer, contributor, circleOnly] = await Promise.all(["owner", "viewer", "contributor", "circle"].map(role => tx.user.create({ data: {
          email: `${prefix}-${role}@navigation.test`, username: role, created_at: now, updated_at: now,
        } })))
        const project = await tx.project.create({ data: { owner_id: owner.id, name: "Private source identity", created_at: now, updated_at: now } })
        await tx.projectParticipation.createMany({ data: [viewer, contributor].map(user => ({ project_id: project.id, user_id: user.id, invited_by_id: owner.id, status: "accepted", invited_at: now, responded_at: now, created_at: now, updated_at: now })) })
        const circles = await Promise.all(["Current", "Accessible", "Inaccessible"].map(name => tx.room.create({ data: { owner_id: owner.id, name, porosity: "closed", created_at: now, updated_at: now } })))
        await tx.roomMembership.createMany({ data: [
          ...circles.map(circle => ({ room_id: circle.id, user_id: owner.id })),
          { room_id: circles[0].id, user_id: viewer.id },
          { room_id: circles[1].id, user_id: viewer.id },
          { room_id: circles[0].id, user_id: circleOnly.id },
          { room_id: circles[1].id, user_id: contributor.id },
        ].map(data => ({ ...data, created_at: now, updated_at: now })) })
        const materials = await Promise.all([owner, contributor].map(user => tx.entry.create({ data: {
          user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", published_at: at(5), created_at: at(5), updated_at: at(5),
        } })))
        // Private Project size must not produce a source-ID array in navigation.
        await tx.entry.createMany({ data: Array.from({ length: 2000 }, () => ({
          user_id: owner.id, project_id: project.id, creation_origin: "project_material",
          status: "draft", created_at: now, updated_at: now,
        })) })
        await tx.entry.createMany({ data: Array.from({ length: 20000 }, () => ({
          user_id: circleOnly.id, room_id: circles[0].id, status: "published",
          published_at: at(1), created_at: at(1), updated_at: at(1),
        })) })
        const readableAuthor = await tx.entry.create({ data: { user_id: owner.id, room_id: circles[0].id, status: "published", published_at: at(3), created_at: at(3), updated_at: at(3) } })
        await tx.entry.create({ data: { user_id: owner.id, room_id: circles[2].id, source_entry_id: materials[0].id, status: "published", published_at: at(4), created_at: at(4), updated_at: at(4) } })
        // A long run of inaccessible shares, with tied timestamps, must not
        // grow the exclusion list or hide the earlier readable destination.
        await tx.entry.createMany({ data: Array.from({ length: 40 }, () => ({
          user_id: owner.id, room_id: circles[2].id, source_entry_id: materials[0].id,
          status: "published", published_at: at(4), created_at: at(4), updated_at: at(4),
        })) })
        const readableProject = await tx.entry.create({ data: { user_id: contributor.id, room_id: circles[0].id, source_entry_id: materials[1].id, status: "published", published_at: at(5), created_at: at(5), updated_at: at(5) } })
        for (const status of ["draft", "deleted"]) await tx.entry.create({ data: { user_id: owner.id, room_id: circles[1].id, source_entry_id: materials[0].id, status, published_at: at(5), created_at: at(5), updated_at: at(5) } })
        // Even an accessible Room must not enter this Room's carousel.
        await tx.entry.create({ data: { user_id: owner.id, room_id: circles[1].id, source_entry_id: materials[0].id, status: "published", published_at: at(5), created_at: at(5), updated_at: at(5) } })
        const current = await tx.entry.create({ data: { user_id: owner.id, room_id: circles[0].id, source_entry_id: materials[0].id, status: "published", published_at: at(6), created_at: at(6), updated_at: at(6) } })
        const latest = await tx.entry.create({ data: { user_id: owner.id, room_id: circles[0].id, source_entry_id: materials[0].id, status: "published", published_at: at(6), created_at: at(6), updated_at: at(6) } })
        const circleAccess = withTestDependencies(new RoomAccessService(), { prisma: tx })
        const service = withTestDependencies(new EntriesReadService(), { prisma: tx, circleAccess, linkPreviews: {
          serializeAttachment: async () => null,
          attachmentsForOwners: async () => new Map(),
        } })

        await tx.$executeRaw`SET LOCAL TIME ZONE 'America/Los_Angeles'`
        await tx.$executeRaw`ANALYZE entries`
        let candidateStatement: Prisma.Sql | undefined
        await projectNavigationCandidate({ $queryRaw: async (query: Prisma.Sql) => {
          candidateStatement = query
          return tx.$queryRaw(query)
        } } as unknown as Pick<Prisma.TransactionClient, "$queryRaw">, project.id, current.id, at(6), true)
        const queryPlan = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${candidateStatement!}`)
        const scans: Array<{ relation: unknown; rows: unknown; removed: unknown; loops: unknown; index: unknown }> = []
        const visitPlan = (node: Record<string, unknown>) => {
          if (node["Relation Name"] === "entries" || typeof node["Index Name"] === "string") scans.push({ relation: node["Relation Name"], rows: node["Actual Rows"], removed: node["Rows Removed by Filter"], loops: node["Actual Loops"], index: node["Index Name"] })
          for (const child of (node.Plans ?? []) as Array<Record<string, unknown>>) visitPlan(child)
        }
        visitPlan((queryPlan[0]["QUERY PLAN"] as Array<{ Plan: Record<string, unknown> }>)[0].Plan)
        expect(scans.some(scan => scan.index === "index_entries_on_source_entry_status")).toBe(true)
        // The unrelated published history must not become a filtered whole-table scan.
        expect(scans.every(scan => Number(scan.removed ?? 0) < 20000)).toBe(true)
        const participant = (await service.fetchEntry(current.id, viewer.id)).entry
        expect(participant.project).toMatchObject({ id: project.id, name: "Private source identity" })
        expect(participant.previous_author_entry?.id).toBe(readableAuthor.id)
        expect(participant.previous_project_entry?.id).toBe(readableProject.id)
        expect(participant.next_project_entry?.id).toBe(latest.id)
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`
        const utc = (await service.fetchEntry(current.id, viewer.id)).entry
        expect(utc.previous_project_entry).toEqual(participant.previous_project_entry)
        expect(utc.next_project_entry).toEqual(participant.next_project_entry)

        const firstPost = (await service.fetchEntry(readableProject.id, viewer.id)).entry
        expect(firstPost.previous_project_entry).toBeNull()
        expect(firstPost.next_project_entry?.id).toBe(current.id)
        const latestPost = (await service.fetchEntry(latest.id, viewer.id)).entry
        expect(latestPost.previous_project_entry?.id).toBe(current.id)
        expect(latestPost.next_project_entry).toBeNull()
        // Removing private material leaves published copies and their stable lineage intact.
        await tx.entry.update({ where: { id: materials[0].id }, data: { status: "deleted" } })
        const deletedSource = (await service.fetchEntry(current.id, viewer.id)).entry
        expect(deletedSource.previous_project_entry?.id).toBe(readableProject.id)
        expect(deletedSource.next_project_entry?.id).toBe(latest.id)
        expect(deletedSource).not.toHaveProperty("source_entry_id")
        const circleViewer = (await service.fetchEntry(current.id, circleOnly.id)).entry
        expect(circleViewer).toMatchObject({ project: null, project_id: null, previous_project_entry: null, previous_author_entry: expect.objectContaining({ id: readableAuthor.id }) })
        expect(circleViewer).not.toHaveProperty("source_entry_id")
        expect(circleViewer).not.toHaveProperty("keep_project_id")

        await tx.roomMembership.updateMany({ where: { room_id: circles[1].id, user_id: viewer.id }, data: { disabled: true } })
        const revokedCircle = (await service.fetchEntry(current.id, viewer.id)).entry
        expect(revokedCircle.project?.id).toBe(project.id)
        expect(revokedCircle.previous_author_entry?.id).toBe(readableAuthor.id)
        expect(revokedCircle.previous_project_entry?.id).toBe(readableProject.id)
        await tx.projectParticipation.updateMany({ where: { project_id: project.id, user_id: viewer.id }, data: { status: "declined" } })
        const revokedProject = (await service.fetchEntry(current.id, viewer.id)).entry
        expect(revokedProject).toMatchObject({ project: null, project_id: null, previous_project_entry: null })
        expect(revokedProject).not.toHaveProperty("source_entry_id")
        // A missing source cannot establish a project relationship; never guess it from the author.
        await tx.entry.delete({ where: { id: materials[0].id } })
        const missingSource = (await service.fetchEntry(current.id, owner.id)).entry
        expect(missingSource).toMatchObject({ project: null, project_id: null, previous_project_entry: null, next_project_entry: null })
        // Other-room candidates are excluded in SQL, rather than scanned one by one.
        expect(navigationQueries.filter(query => query.hasCursor)).toHaveLength(0)
        expect(navigationQueries.every(query => query.exclusionCount === 0)).toBe(true)
        throw rollback
      }, { timeout: 20000 })
    } catch (error) { if (error !== rollback) throw error }
    finally { await prisma.$disconnect() }
  }, 30000)
})
