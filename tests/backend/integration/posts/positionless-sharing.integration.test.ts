import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { EntriesReadService } from "@server/api/v1/entries/entries.read.service"
import { EntryNotificationsService } from "@server/api/v1/entries/entry-notifications.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { canManageEntryDraft } from "@server/api/v1/entries/entry-draft-access"

it.each([false, true])("shares and publishes with membership alone (Round: %s), retaining one copy on retry", async inRound => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("Rollback positionless share")
  try {
    await prisma.$transaction(async tx => {
      const database = Object.assign(Object.create(tx), { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) })
      const user = await tx.user.create({ data: { username: "Author", email: `${crypto.randomUUID()}@positionless-share.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Destination Room", owner_id: user.id, created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
      const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Selected work" }] }] }
      await tx.document.create({ data: { docable_type: "Post", docable_id: source.id, content, created_at: now, updated_at: now } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: database })
      const uploads = new UploadsService(); Object.assign(uploads, { prisma: database, circleAccess: access })
      const activities = new RoundsService(); Object.assign(activities, { prisma: database, circleAccess: access, realtime: { emit: vi.fn(), boardRoom: (id: number) => `board:${id}` }, show: async () => ({}) })
      const round = inRound ? await tx.round.create({ data: { room_id: room.id, host_id: user.id, template_key: "feedback", status: "active", name: "Feedback", submit_by: new Date(now.getTime() + 3600000), created_at: now, updated_at: now } }) : null
      if (round) {
        const transact = database.$transaction
        for (const change of ["membership", "round"]) {
          database.$transaction = async (callback: (client: typeof tx) => unknown) => {
            if (change === "membership") await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
            else await tx.round.update({ where: { id: round.id }, data: { status: "archived" } })
            return callback(tx)
          }
          await expect(activities.updateParticipation(round.id, user.id, { role: "participant" })).rejects.toThrow(change === "membership" ? "Members only" : "This Round changed")
          expect(await tx.activityParticipation.count({ where: { round_id: round.id } })).toBe(0)
          database.$transaction = transact
          await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
          await tx.round.update({ where: { id: round.id }, data: { status: "active" } })
        }
        await activities.updateParticipation(round.id, user.id, { role: "participant" })
        const participation = await tx.activityParticipation.findUniqueOrThrow({ where: { round_id_user_id: { round_id: round.id, user_id: user.id } } })
        expect(participation).toMatchObject({ role: "participant", status: "active" })
        expect(participation).not.toHaveProperty("square_id")
      }
      const entries = new ProjectEntriesService(); Object.assign(entries, { prisma: database, circleAccess: access, uploads, rounds: activities })
      const input = { room_id: room.id, ...(round ? { round_id: round.id } : {}), request_key: crypto.randomUUID() }
      const prepared = await entries.shareDraft(project.id, source.id, user.id, input)
      expect(prepared).not.toHaveProperty("square_id")
      expect(await entries.shareDraft(project.id, source.id, user.id, input)).toEqual(prepared)
      const draft = await tx.entry.findUniqueOrThrow({ where: { id: prepared.entry_id } })
      expect(draft).not.toHaveProperty("content")
      expect(await canManageEntryDraft(database, access, draft, user.id)).toBe(true)
      expect(await canManageEntryDraft(database, access, { ...draft, source_entry_id: null }, user.id)).toBe(false)
      const other = await tx.user.create({ data: { username: "Other member", email: `${crypto.randomUUID()}@positionless-share.test`, created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: other.id, created_at: now, updated_at: now } })
      const reads = new EntriesReadService(); Object.assign(reads, { prisma: database, circleAccess: access,
        linkPreviews: { serializeAttachment: vi.fn().mockResolvedValue(null), attachmentsForOwners: vi.fn().mockResolvedValue(new Map()) } })
      await expect(reads.fetchEntry(draft.id, other.id)).rejects.toThrow("Draft Entry is not available")
      await expect(reads.fetchEntry(draft.id, user.id)).resolves.toMatchObject({ entry: { id: draft.id, status: "draft", content, viewer_access: { can_withdraw: false } } })
      const notifications = new EntryNotificationsService(); Object.assign(notifications, { prisma: database, boss: { enqueueInTransaction: vi.fn() } })
      const emit = vi.fn()
      const posts = new EntriesService(); Object.assign(posts, { prisma: database, circleAccess: access, activitiesService: activities, notifications, read: { draftPayload: vi.fn().mockResolvedValue({ id: draft.id }) }, realtime: { emit, chatRoom: (id: number) => `chat:${id}` } })
      // Reading an unchanged draft must not invalidate the editor's recovery revision.
      await posts.fetchDraft(draft.id, user.id)
      const beforeReads = await tx.entry.findUniqueOrThrow({ where: { id: draft.id } })
      await posts.fetchDraft(draft.id, user.id)
      await posts.fetchDraft(draft.id, user.id)
      expect(await tx.entry.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(beforeReads)
      if (round) await tx.round.update({ where: { id: round.id }, data: { reply_mode: "guided", requested_feedback_types: ["question"], idea_guidance: "craft" } })
      else await tx.room.update({ where: { id: room.id }, data: { reply_mode: "guided", default_feedback_types: ["question"], default_idea_guidance: "craft" } })
      await posts.fetchDraft(draft.id, user.id)
      const changedDefaults = await tx.entry.findUniqueOrThrow({ where: { id: draft.id } })
      expect(changedDefaults.updated_at.getTime()).toBeGreaterThan(beforeReads.updated_at.getTime())
      expect(changedDefaults).toMatchObject({ reply_mode: "guided", requested_feedback_types: ["question"], idea_guidance: "craft" })
      await posts.fetchDraft(draft.id, user.id)
      expect(await tx.entry.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(changedDefaults)
      await expect(posts.saveContent(draft.id, user.id, content, undefined, undefined, undefined, undefined, undefined, beforeReads.updated_at.getTime())).rejects.toThrow("changed elsewhere")
      await expect(posts.updateFeedbackRequest(draft.id, user.id, { reply_mode: "simple" })).resolves.toMatchObject({ can_edit_feedback_request: true })
      if (round) {
        await tx.activityParticipation.updateMany({ where: { round_id: round.id, user_id: user.id }, data: { status: "withdrawn" } })
        await expect(posts.publish(draft.id, user.id)).rejects.toThrow("Join this activity")
        expect((await tx.entry.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft")
        await tx.activityParticipation.updateMany({ where: { round_id: round.id, user_id: user.id }, data: { status: "active" } })
      }
      await posts.publish(draft.id, user.id)
      await posts.publish(draft.id, user.id)
      await expect(reads.fetchEntry(draft.id, user.id)).resolves.toMatchObject({ entry: { viewer_access: { can_withdraw: true } } })
      await expect(reads.fetchEntry(draft.id, other.id)).resolves.toMatchObject({ entry: { id: draft.id, status: "published", content, viewer_access: { can_withdraw: false } } })
      expect(await tx.entry.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "published", room_id: room.id, source_entry_id: source.id })
      expect(await tx.notificationEvent.count({ where: { entry_id: draft.id, event_type: "post_created" } })).toBe(1)
      expect(emit).toHaveBeenCalledWith("ChatChannel", `chat:${room.id}`, { type: "invalidate", room_id: room.id })
      expect((await entries.show(project.id, source.id, user.id)).submissions).toEqual([expect.objectContaining({ id: draft.id, room_name: "Destination Room" })])
      expect(await tx.document.findFirst({ where: { docable_type: "Post", docable_id: source.id } })).toMatchObject({ content })
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      await expect(posts.updateFeedbackRequest(draft.id, user.id, { reply_mode: "simple" })).rejects.toThrow("Forbidden")
      await expect(posts.publish(draft.id, user.id)).rejects.toThrow("Forbidden")
      await expect(entries.shareDraft(project.id, source.id, user.id, { ...input, request_key: crypto.randomUUID() })).rejects.toThrow()
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
