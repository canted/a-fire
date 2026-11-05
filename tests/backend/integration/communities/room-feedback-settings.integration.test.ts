import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { roomFeedbackSettings } from "@server/api/v1/rooms/room-feedback-settings"

it("owns Room feedback while preserving independent draft requests", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback Room feedback"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Owner", email: `${crypto.randomUUID()}@room-feedback.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", created_at: now, updated_at: now } })
      const drafts = []
      for (const variant of ["ordinary", "custom", "round", "published", "private"]) drafts.push(await tx.entry.create({ data: {
        room_id: variant === "private" ? null : room.id, user_id: user.id,
        status: variant === "published" ? "published" : "draft", feedback_request_customized: variant === "custom",
        round_id: variant === "round" ? round.id : null, reply_mode: "simple", created_at: now, updated_at: now,
      } }))
      const foreignRoom = await tx.room.create({ data: { name: "Other Room", created_at: now, updated_at: now } })
      const foreignDraft = await tx.entry.create({ data: {
        room_id: foreignRoom.id, user_id: user.id,
        status: "draft", reply_mode: "simple", created_at: now, updated_at: now,
      } })
      const service = new RoomsService()
      const update = (userId: number, input: Parameters<RoomsService["updateFeedbackSettings"]>[2]) => service.updateFeedbackSettings(room.id, userId, input)
      // The surrounding rollback transaction owns this test connection/Room lock.
      Object.assign(service, { prisma: { $transaction: (operation: (db: typeof tx) => unknown) => operation(tx) } })
      await expect(update(user.id + 100000, { replyMode: "guided" })).rejects.toThrow("Forbidden")
      const settings = await update(user.id, { replyMode: "guided", defaultFeedbackTypes: ["question"], defaultIdeaGuidance: "craft" })
      expect(settings.replyMode).toBe("guided")
      expect(await roomFeedbackSettings(tx, room.id)).toEqual({ reply_mode: "guided", default_feedback_types: ["question"], default_idea_guidance: "craft" })
      const after = await tx.entry.findMany({ where: { id: { in: drafts.map(post => post.id) } }, orderBy: { id: "asc" } })
      expect(after[0]).toMatchObject({ reply_mode: "guided", requested_feedback_types: ["question"], idea_guidance: "craft" })
      expect(after.slice(1)).toEqual(drafts.slice(1))
      expect(await tx.entry.findUniqueOrThrow({ where: { id: foreignDraft.id } })).toEqual(foreignDraft)
      await tx.room.update({ where: { id: room.id }, data: { deleted_at: now } })
      await expect(roomFeedbackSettings(tx, room.id)).rejects.toThrow("Community not found")
      await expect(update(user.id, { replyMode: "simple" })).rejects.toThrow("Community not found")
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("rolls back a failed draft refresh and serializes competing Room settings updates", async () => {
  const prisma = new PrismaClient(), now = new Date()
  const user = await prisma.user.create({ data: { username: "Owner", email: `${crypto.randomUUID()}@feedback-atomic.test`, created_at: now, updated_at: now } })
  let roomId: number | undefined, postId: number | undefined
  try {
    const room = await prisma.room.create({ data: { owner_id: user.id, name: "Atomic settings", created_at: now, updated_at: now } })
    roomId = room.id
    const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, status: "draft", feedback_request_customized: false, created_at: now, updated_at: now } })
    postId = post.id
    let rejectRefresh = true
    const database = prisma.$extends({ query: { entry: { async updateMany({ args, query }) {
      if (rejectRefresh) { rejectRefresh = false; throw new Error("Injected draft refresh failure") }
      return query(args)
    } } } })
    const service = new RoomsService()
    Object.assign(service, { prisma: database })
    await expect(service.updateFeedbackSettings(room.id, user.id, { replyMode: "guided", defaultFeedbackTypes: ["question"] })).rejects.toThrow("Injected draft refresh failure")
    // These reads occur outside the failed service transaction, so they prove
    // rollback by the production transaction boundary, not test cleanup.
    expect(await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).toEqual(room)
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(post)
    await service.updateFeedbackSettings(room.id, user.id, { replyMode: "guided", defaultFeedbackTypes: ["question"] })
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).requested_feedback_types).toEqual(["question"])
    await Promise.all([
      service.updateFeedbackSettings(room.id, user.id, { replyMode: "guided", defaultFeedbackTypes: ["idea"], defaultIdeaGuidance: "craft" }),
      service.updateFeedbackSettings(room.id, user.id, { replyMode: "simple" }),
    ])
    const finalRoom = await prisma.room.findUniqueOrThrow({ where: { id: room.id } })
    const finalPost = await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })
    expect(finalPost.reply_mode).toBe(finalRoom.reply_mode)
    expect(finalPost.requested_feedback_types).toEqual(finalRoom.reply_mode === "guided" ? finalRoom.default_feedback_types : [])
    expect(finalPost.idea_guidance).toBe(finalRoom.reply_mode === "guided" ? finalRoom.default_idea_guidance : null)
  } finally {
    if (postId) await prisma.entry.delete({ where: { id: postId } })
    if (roomId) await prisma.room.delete({ where: { id: roomId } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
