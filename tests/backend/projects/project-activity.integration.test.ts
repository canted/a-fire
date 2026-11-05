import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { loadProjectActivity } from "@server/api/v1/projects/project-activity"
import { UnseenContentService } from "@server/api/v1/unseen/unseen-content.service"

const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T12:00:00Z`)
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

describe("Home project activity persistence", () => {
  it("reduces large histories to one summary per Project and preserves fallback and tie ordering", async () => {
    const prisma = new PrismaClient(), rollback = new Error("Rollback large Project history")
    const observedRows: number[] = []
    const database = prisma.$extends({ query: { async $queryRaw({ args, query }) {
      const rows = await query(args)
      observedRows.push((rows as unknown[]).length)
      return rows
    } } })
    try {
      await database.$transaction(async tx => {
        const owner = await tx.user.create({ data: { email: `${randomUUID()}@activity.test`, username: "Writer", created_at: at(1), updated_at: at(1) } })
        const projects = await Promise.all(["Populated", "Fallback", "Empty"].map(name => tx.project.create({ data: { owner_id: owner.id, name, created_at: at(1), updated_at: at(10) } })))
        const [project, fallback] = projects
        const data = { user_id: owner.id, creation_origin: "project_material", status: "published", created_at: at(1), updated_at: at(10) }
        await tx.entry.createMany({ data: Array.from({ length: 1000 }, () => ({ ...data, project_id: project.id, published_at: at(3) })) })
        const newest = await tx.entry.create({ data: { ...data, project_id: project.id, published_at: at(3), project_intent: "Tie winner" } })
        const nullPublication = await tx.entry.create({ data: { ...data, project_id: fallback.id, created_at: at(2) } })
        const room = await tx.room.create({ data: { name: "Room without Squares", created_at: at(1), updated_at: at(1) } })
        await tx.roomMembership.create({ data: { room_id: room.id, user_id: owner.id, unseen_started_at: at(1), created_at: at(1), updated_at: at(1) } })
        const share = await tx.entry.create({ data: { ...data, creation_origin: null, project_id: null, source_entry_id: newest.id, room_id: room.id, published_at: at(3) } })
        // Multiple independent copies contribute feedback to the same private source.
        const secondShare = await tx.entry.create({ data: { ...data, creation_origin: null, project_id: null, source_entry_id: newest.id, room_id: room.id, published_at: at(3) } })
        await tx.reply.createMany({ data: Array.from({ length: 1000 }, () => ({ entry_id: share.id, status: "published", created_at: at(4), updated_at: at(4), published_at: at(4) })) })
        const last = await tx.reply.create({ data: { entry_id: secondShare.id, status: "published", created_at: at(4), updated_at: at(4), published_at: at(4) } })
        const fallbackShare = await tx.entry.create({ data: { ...data, creation_origin: null, project_id: null, source_entry_id: nullPublication.id, room_id: room.id, published_at: at(3) } })
        const fallbackReply = await tx.reply.create({ data: { entry_id: fallbackShare.id, status: "published", created_at: at(5), updated_at: at(5), published_at: at(5) } })
        const result = await loadProjectActivity(tx, projects.map(row => row.id), owner.id)
        expect(observedRows).toEqual([3])
        expect(result.get(project.id)).toMatchObject({ material_activity_at: at(3).toISOString(), latest_material: { id: newest.id, intent: "Tie winner" }, unread_feedback_count: 1001, latest_unread_feedback: { reply_id: last.id, source_author_name: "Someone", excerpt: null, room_name: room.name } })
        expect(result.get(fallback.id)?.latest_material).toMatchObject({ id: nullPublication.id, added_at: at(2).toISOString() })
        expect(result.get(fallback.id)).toMatchObject({ unread_feedback_count: 1, latest_unread_feedback: { reply_id: fallbackReply.id } })
        expect(result.get(projects[2].id)).toMatchObject({ latest_material: null, unread_feedback_count: 0 })
        await tx.room.update({ where: { id: room.id }, data: { deleted_at: at(10) } })
        expect((await loadProjectActivity(tx, [project.id], owner.id)).get(project.id)?.unread_feedback_count).toBe(0)
        throw rollback
      }, { timeout: 20000 })
    } catch (error) { if (error !== rollback) throw error }
    finally { await prisma.$disconnect() }
  }, 30000)

  it("uses first publication and the canonical reply read cursor without exposing unrelated feedback", async () => {
    const prisma = new PrismaClient()
    const rollback = new Error("Rollback isolated Home activity fixtures")
    try {
      await prisma.$transaction(async (tx) => {
        const prefix = randomUUID()
        const now = new Date()
        const [owner, reviewer, peer] = await Promise.all(["owner", "reviewer", "peer"].map((role) => tx.user.create({ data: { email: `${prefix}-${role}@activity.test`, username: `${prefix}-${role}`, created_at: now, updated_at: now } })))
        const project = await tx.project.create({ data: { owner_id: owner.id, name: "Activity project", created_at: at(1), updated_at: at(10) } })
        const material = await tx.entry.create({ data: { user_id: owner.id, project_id: project.id, creation_origin: "project_material", status: "published", format: "mixed_media", project_intent: "Return to the first recording", created_at: at(1), published_at: at(4), updated_at: at(9) } })
        await tx.entry.create({ data: { user_id: owner.id, project_id: project.id, creation_origin: "project_material", status: "draft", created_at: at(8), updated_at: at(10) } })
        await tx.entry.create({ data: { user_id: owner.id, project_id: project.id, creation_origin: "project_feedback", status: "published", created_at: at(8), published_at: at(8), updated_at: at(8) } })
        const circle = await tx.room.create({ data: { owner_id: owner.id, name: "Actual feedback circle", created_at: now, updated_at: now } })
        await tx.roomMembership.createMany({ data: [owner, reviewer, peer].map((user) => ({ room_id: circle.id, user_id: user.id, unseen_started_at: at(2), username_override: user.id === reviewer.id ? "Circle Reviewer" : null, created_at: now, updated_at: now })) })
        const share = await tx.entry.create({ data: { user_id: owner.id, source_entry_id: material.id, room_id: circle.id, status: "published", created_at: at(4), published_at: at(4), updated_at: at(4) } })
        const peerProject = await tx.project.create({ data: { owner_id: peer.id, name: "Peer private", created_at: now, updated_at: now } })
        const peerSource = await tx.entry.create({ data: { user_id: peer.id, project_id: peerProject.id, creation_origin: "project_material", status: "published", created_at: at(4), published_at: at(4), updated_at: at(4) } })
        const peerShare = await tx.entry.create({ data: { user_id: peer.id, source_entry_id: peerSource.id, room_id: circle.id, status: "published", created_at: at(4), published_at: at(4), updated_at: at(4) } })
        const replies = await Promise.all([
          { entry_id: share.id, user_id: reviewer.id, status: "published", day: 1 }, // Before circle unseen baseline.
          { entry_id: share.id, user_id: reviewer.id, status: "published", day: 5 },
          { entry_id: share.id, user_id: reviewer.id, status: "published", day: 5 }, // Same timestamp, greater ID.
          { entry_id: share.id, user_id: reviewer.id, status: "published", day: 6 },
          { entry_id: share.id, user_id: owner.id, status: "published", day: 7 }, // Own reply.
          { entry_id: share.id, user_id: reviewer.id, status: "draft", day: 8 },
          { entry_id: peerShare.id, user_id: reviewer.id, status: "published", day: 9 }, // Someone else's contribution.
        ].map(({ day, ...data }) => tx.reply.create({ data: { ...data, published_at: data.status === "published" ? at(day) : null, created_at: at(day), updated_at: at(day) } })))
        const latest = replies[3]
        await tx.document.create({ data: { docable_type: "Reply", docable_id: latest.id, content: doc("An actual response worth returning for"), created_at: now, updated_at: now } })
        await tx.entryViewState.create({ data: { user_id: owner.id, entry_id: share.id, reply_seen_through_at: at(5), reply_seen_through_id: replies[1].id, created_at: now, updated_at: now } })
        const activity = (await loadProjectActivity(tx as any, [project.id], owner.id)).get(project.id)
        expect(activity).toMatchObject({ material_activity_at: at(4).toISOString(), latest_material: { id: material.id, added_at: at(4).toISOString(), intent: "Return to the first recording" }, unread_feedback_count: 2, latest_unread_feedback: { reply_id: latest.id, source_author_name: "Circle Reviewer", room_name: "Actual feedback circle", excerpt: "An actual response worth returning for" } })

        // PostgreSQL retains microseconds that JavaScript Date would collapse.
        // The later reply stays unread even when its ID is below the cursor ID.
        await tx.$executeRaw`UPDATE replies SET published_at='2026-09-05 12:00:00.000002'::timestamp WHERE id=${replies[2].id}`
        await tx.$executeRaw`UPDATE entry_view_states SET reply_seen_through_at='2026-09-05 12:00:00.000001'::timestamp,reply_seen_through_id=${latest.id} WHERE entry_id=${share.id} AND user_id=${owner.id}`
        expect((await loadProjectActivity(tx, [project.id], owner.id)).get(project.id)?.unread_feedback_count).toBe(2)

        const unseen = new UnseenContentService()
        Object.assign(unseen, { prisma: tx })
        await unseen.markPostSeen(owner.id, share.id, { replyIds: [latest.id] })
        expect((await loadProjectActivity(tx as any, [project.id], owner.id)).get(project.id)?.unread_feedback_count).toBe(0)
        await tx.roomMembership.updateMany({ where: { room_id: circle.id, user_id: owner.id }, data: { disabled: true } })
        const noCircleAccess = (await loadProjectActivity(tx as any, [project.id], owner.id)).get(project.id)
        expect(noCircleAccess).toMatchObject({ material_activity_at: at(4).toISOString(), unread_feedback_count: 0, latest_unread_feedback: null })
        throw rollback
      }, { timeout: 20000 })
    } catch (error) {
      if (error !== rollback) throw error
    } finally { await prisma.$disconnect() }
  }, 30000)
})
