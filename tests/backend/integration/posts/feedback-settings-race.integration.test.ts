import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it.each(["membership", "room", "deleted", "same-timestamp edit", "entry moved", "unchanged"])("rechecks feedback settings after a %s transition", async change => {
  const prisma = new PrismaClient(), now = new Date(), rollback = new Error("Rollback feedback settings")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Author", email: `${crypto.randomUUID()}@feedback-settings.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
      const other = await tx.room.create({ data: { name: "Other", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { user_id: user.id, room_id: room.id, source_entry_id: source.id, status: "published", reply_mode: "simple", created_at: now, updated_at: now } })
      let retained = post
      const database = Object.assign(Object.create(tx), { $transaction: async (callback: (client: typeof tx) => unknown) => {
        // Transition after the authorized preparation read but before the write transaction.
        if (change === "entry moved") retained = await tx.entry.update({ where: { id: post.id }, data: { room_id: other.id } })
        if (change === "membership") await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
        if (change === "room") await tx.room.update({ where: { id: room.id }, data: { deleted_at: now } })
        if (change === "deleted") retained = await tx.entry.update({ where: { id: post.id }, data: { status: "deleted" } })
        if (change === "same-timestamp edit") retained = await tx.entry.update({ where: { id: post.id }, data: { reply_mode: "guided", requested_feedback_types: ["idea"], idea_guidance: "craft" } })
        return callback(tx)
      } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: database })
      const service = new EntriesService(); Object.assign(service, { prisma: database, circleAccess: access })
      const result = service.updateFeedbackRequest(post.id, user.id, { reply_mode: "guided", requested_feedback_types: ["question"] })
      if (change === "unchanged") {
        await expect(result).resolves.toMatchObject({ can_edit_feedback_request: true, feedback_request: { reply_mode: "guided" } })
        const updated = await tx.entry.findUniqueOrThrow({ where: { id: post.id } })
        expect(updated).toMatchObject({ requested_feedback_types: ["question"], feedback_request_customized: true })
        expect(updated.updated_at.getTime()).toBeGreaterThan(post.updated_at.getTime())
      } else {
        await expect(result).rejects.toThrow(change === "membership" ? "Members only" : change === "room" ? "Community not found" : change === "deleted" ? "Entry unavailable" : "This Entry changed")
        expect(await tx.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(retained)
      }
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
