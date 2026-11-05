import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { EntriesService } from "@server/api/v1/entries/entries.service"

it.each(["customized", "published", "edited", "feedback at the same timestamp", "unchanged"])("does not overwrite a draft %s during feedback synchronization", async change => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback feedback sync"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Author", email: `${crypto.randomUUID()}@feedback-sync.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", reply_mode: "guided", default_feedback_types: ["question"], created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { source_entry_id: source.id, room_id: room.id, user_id: user.id, status: "draft", feedback_request_customized: false, reply_mode: "simple", created_at: now, updated_at: now } })
      let changed = post
      const service = new EntriesService()
      Object.assign(service, {
        prisma: { entry: tx.entry, room: { findUnique: async () => {
          if (change === "unchanged") return room
          changed = await tx.entry.update({ where: { id: post.id }, data: {
            ...(change === "customized" ? { feedback_request_customized: true, reply_mode: "guided", requested_feedback_types: ["idea"], idea_guidance: "craft" } : {}),
            ...(change === "published" ? { status: "published" } : {}),
            ...(change === "edited" ? { project_intent: "New title" } : {}),
            ...(change === "feedback at the same timestamp" ? { reply_mode: "guided", requested_feedback_types: ["idea"], idea_guidance: "craft" } : {}),
            updated_at: change === "feedback at the same timestamp" ? now : new Date(now.getTime() + 1000),
          } })
          return room
        } } },
        circleAccess: { resolve: async () => ({ kind: "member", canWriteWall: true }) },
        read: { draftPayload: () => tx.entry.findUniqueOrThrow({ where: { id: post.id } }) },
      })
      // The mutation runs after the sync read, before its write, on real rows.
      // Authorization/presentation are adapters; the persisted sync path is real.
      const result = await service.fetchDraft(post.id, user.id)
      if (change === "unchanged") {
        expect(result).toMatchObject({ reply_mode: "guided", requested_feedback_types: ["question"], idea_guidance: "open" })
        expect(await tx.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(result)
      } else {
        expect(result).toEqual(changed)
        expect(await tx.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(changed)
      }
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
