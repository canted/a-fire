import { ForbiddenException, NotFoundException } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { canReadProjectEntry } from "@server/api/v1/projects/project-access"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { ProjectsService } from "@server/api/v1/projects/projects.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { vi } from "vitest"

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

describe("project practice persistence", () => {
  it("preserves independent snapshots while enforcing membership across the persisted lifecycle", async () => {
    const prisma = new PrismaClient()
    const rollback = new Error("Rollback isolated project fixtures")
    try {
      await prisma.$transaction(async (tx) => {
        const now = new Date()
        const prefix = randomUUID()
        const users = await Promise.all(["owner", "member", "pending", "reviewer"].map((role) => tx.user.create({ data: { email: `${prefix}-${role}@project.test`, username: `${prefix}-${role}`, created_at: now, updated_at: now } })))
        const [owner, member, pending, reviewer] = users
        const circle = await tx.room.create({ data: { name: "Project test circle", owner_id: owner.id, created_at: now, updated_at: now } })
        await tx.roomMembership.createMany({ data: [owner, member, reviewer].map((user) => ({ room_id: circle.id, user_id: user.id, disabled: false, created_at: now, updated_at: now })) })
        const project = await tx.project.create({ data: { owner_id: owner.id, name: "Private project", description: "Private description", created_at: now, updated_at: now, rooms: { create: { room_id: circle.id, created_at: now } }, participations: { create: [member, pending].map((user) => ({ user_id: user.id, invited_by_id: owner.id, status: user.id === member.id ? "accepted" : "pending", invited_at: now, created_at: now, updated_at: now })) } } })
        // All fixture mutations, including service transactions, share one rollback-only database transaction.
        const scopedPrisma = Object.assign(Object.create(tx), { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) })
        const circleAccess = new RoomAccessService()
        Object.assign(circleAccess, { prisma: scopedPrisma })
        const uploads = {
          assertContentMediaAccess: vi.fn(),
          copyContentSnapshot: vi.fn().mockImplementation((_actor, _source, _target, content, formatData) => Promise.resolve({ content: structuredClone(content), formatData: structuredClone(formatData) })),
        }
        const entries = new ProjectEntriesService()
        Object.assign(entries, { prisma: scopedPrisma, uploads, circleAccess, rounds: { validateActivitySubmission: vi.fn() } })
        const projects = new ProjectsService()
        Object.assign(projects, { prisma: scopedPrisma, uploads, entries })

        const chosen = await projects.create(owner.id, { name: "Chosen identity", iconSymbol: "projectClover", iconColor: "purple" })
        expect(chosen).toMatchObject({ icon_symbol: "projectClover", icon_color: "purple" })
        await projects.update(chosen.id, owner.id, { iconSymbol: "projectGuitar", iconColor: "aqua" })
        expect(await projects.show(chosen.id, owner.id)).toMatchObject({ icon_symbol: "projectGuitar", icon_color: "aqua" })

        const draft = await entries.create(project.id, member.id)
        await expect(entries.show(project.id, draft.id, owner.id)).rejects.toBeInstanceOf(NotFoundException)
        const savedDraft = await entries.update(project.id, draft.id, member.id, { expected_revision: Date.parse(draft.updated_at), content: doc("Original project material"), intent: "Keep practising", save: true })
        await expect(projects.show(project.id, reviewer.id)).rejects.toBeInstanceOf(NotFoundException)
        await expect(projects.show(project.id, pending.id)).resolves.toMatchObject({ invitation_only: true, description: null,  entries: [] })
        expect((await entries.page(project.id, owner.id)).entries).toHaveLength(1)

        await expect(entries.shareDraft(project.id, draft.id, member.id, { room_id: circle.id })).resolves.toMatchObject({ entry_id: expect.any(Number) })
        await expect(entries.shareDraft(project.id, draft.id, owner.id, { room_id: circle.id })).rejects.toBeInstanceOf(ForbiddenException)
        const ownerDraft = await entries.create(project.id, owner.id)
        await entries.update(project.id, ownerDraft.id, owner.id, { expected_revision: Date.parse(ownerDraft.updated_at), content: doc("Original project material"), intent: "Circle framing", save: true })
        const manifest = await entries.shareSelection(project.id, ownerDraft.id, owner.id, circle.id)
        const share = await entries.shareDraft(project.id, ownerDraft.id, owner.id, { room_id: circle.id, source_revision: manifest.revision, selected_unit_ids: ["title", "body"], request_key: randomUUID() })
        await tx.entry.update({ where: { id: share.entry_id }, data: { status: "published", published_at: now } })
        await entries.update(project.id, draft.id, member.id, { expected_revision: Date.parse(savedDraft.updated_at), content: doc("Later project material") })
        expect((await tx.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: share.entry_id } } })).content).toEqual(doc("Original project material"))
        expect((await tx.entry.findUniqueOrThrow({ where: { id: share.entry_id } })).format_data).toMatchObject({ title: "Circle framing" })
        expect((await tx.entry.findUniqueOrThrow({ where: { id: share.entry_id } })).project_id).toBeNull()

        const reply = await tx.reply.create({ data: { entry_id: share.entry_id, user_id: reviewer.id, status: "published", published_at: now, created_at: now, updated_at: now } })
        await tx.document.create({ data: { docable_type: "Reply", docable_id: reply.id, content: doc("Original feedback"), created_at: now, updated_at: now } })
        const kept = await entries.keep(project.id, member.id, reply.id)
        expect(kept.already_saved).toBe(false)
        expect(await entries.keep(project.id, member.id, reply.id)).toMatchObject({ id: kept.id, already_saved: true })
        await tx.document.update({ where: { docable_type_docable_id: { docable_type: "Reply", docable_id: reply.id } }, data: { content: doc("Edited source feedback") } })
        expect((await entries.show(project.id, kept.id, owner.id)).content).toEqual(doc("Original feedback"))
        await tx.document.delete({ where: { docable_type_docable_id: { docable_type: "Reply", docable_id: reply.id } } })
        await tx.reply.delete({ where: { id: reply.id } })
        await tx.entry.delete({ where: { id: share.entry_id } })
        await expect(entries.show(project.id, kept.id, owner.id)).resolves.toMatchObject({ content: doc("Original feedback"), source_available: false, can_edit: false, source_author_name: reviewer.username })

        await tx.roomMembership.updateMany({ where: { room_id: circle.id, user_id: member.id }, data: { disabled: true } })
        const memberView = await projects.show(project.id, member.id)
        expect(memberView.entries).toEqual([])
        expect((await entries.page(project.id, member.id)).entries).toHaveLength(3)
        await projects.update(project.id, owner.id, { roomIds: [] })

        await projects.removeParticipant(project.id, owner.id, member.id)
        await expect(entries.show(project.id, draft.id, member.id)).rejects.toBeInstanceOf(NotFoundException)
        await expect(canReadProjectEntry(scopedPrisma, await tx.entry.findUniqueOrThrow({ where: { id: kept.id } }), member.id)).resolves.toBe(false)
        expect((await entries.show(project.id, kept.id, owner.id)).content).toEqual(doc("Original feedback"))
        throw rollback
      }, { timeout: 20000 })
    } catch (error) {
      if (error !== rollback) throw error
    } finally {
      await prisma.$disconnect()
    }
  }, 30000)
})
