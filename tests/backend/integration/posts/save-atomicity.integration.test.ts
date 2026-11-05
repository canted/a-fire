import { EntriesReadService } from "@server/api/v1/entries/entries.read.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoundRuntime } from "@server/api/v1/rounds/runtime/round-runtime.registry"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { LinkPreviewsService } from "@server/api/v1/link-previews/link-previews.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("rolls back document, subject and preview writes when saving Entry metadata fails", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@save.test`, username: "Author", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const source = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", template_key: "art_before_chorus", status: "active", submit_by: new Date(now.getTime() + 3600000), created_at: now, updated_at: now } })
  const participant = await prisma.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, source_entry_id: source.id, status: "draft", created_at: now, updated_at: now } })
  const original = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] }
  const edited = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Edited" }] }] }
  const doc = await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: original, version: 1, created_at: now, updated_at: now } })
  const preview = await prisma.linkPreviewAttachment.create({ data: { owner_type: "Post", owner_id: post.id, source_url: "https://example.com", hidden: true, created_at: now, updated_at: now } })
  let fail = true
  let race = false, arrivals = 0
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const database = prisma.$extends({ query: { entry: { async findUnique({ args, query }) {
    const result = await query(args)
    if (race && !args.select && arrivals < 2) {
      if (++arrivals === 2) release()
      await barrier
    }
    return result
  }, async update({ args, query }) {
    const result = await query(args)
    if (fail) throw new Error("Save interrupted")
    return result
  } } } })
  const linkPreviews = withTestDependencies(new LinkPreviewsService(), { prisma: database })
  const service = withTestDependencies(new EntriesService(), {
    prisma: database,
    activitiesService: withTestDependencies(new RoundsService(), { prisma: database, circleAccess: withTestDependencies(new RoomAccessService(), { prisma: database }), rounds: withTestDependencies(new RoundRuntime(), { prisma: database, artBeforeChorus: withTestDependencies(new ArtBeforeChorusRoundService(), { prisma: database, circleAccess: withTestDependencies(new RoomAccessService(), { prisma: database }) }) }) }),
    circleAccess: withTestDependencies(new RoomAccessService(), { prisma: database }),
    linkPreviews,
    read: withTestDependencies(new EntriesReadService(), { prisma: database, linkPreviews }),
  })
  try {
    await expect(service.saveContent(post.id, user.id, edited, undefined, undefined, undefined, "audio"))
      .rejects.toThrow("Unsupported post format")
    expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ content: original, version: 1 })
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).format).toBe("mixed_media")
    const forged = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: "2147483647", label: "Unavailable" } }] }] }
    await expect(service.saveContent(post.id, user.id, forged)).rejects.toThrow("Mention unavailable")
    expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ content: original, version: 1 })
    expect(await prisma.entrySubject.count({ where: { entry_id: post.id } })).toBe(0)
    expect(await prisma.linkPreviewAttachment.findUnique({ where: { id: preview.id } })).not.toBeNull()
    await expect(service.saveContent(post.id, user.id, edited)).rejects.toThrow("Save interrupted")
    expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ content: original, version: 1 })
    expect(await prisma.entrySubject.count({ where: { entry_id: post.id } })).toBe(0)
    expect(await prisma.linkPreviewAttachment.findUnique({ where: { id: preview.id } })).not.toBeNull()
    expect((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).updated_at).toEqual(now)
    fail = false
    const response = await service.saveContent(post.id, user.id, edited)
    expect(response.revision).toBeGreaterThan(now.getTime())
    expect(response.revision).toBe((await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).updated_at.getTime())
    expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ content: edited, version: 2 })
    expect(await prisma.entrySubject.count({ where: { entry_id: post.id } })).toBe(1)
    expect(await prisma.linkPreviewAttachment.findUnique({ where: { id: preview.id } })).toBeNull()
    await expect(service.saveContent(post.id, user.id, original, undefined, undefined, undefined, undefined, undefined, now.getTime())).rejects.toThrow("changed elsewhere")
    await expect(service.saveContent(post.id, user.id, original, undefined, undefined, undefined, undefined, undefined, "invalid")).rejects.toThrow("revision must")
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).version).toBe(2)
    race = true
    const outcomes = await Promise.allSettled([service.saveContent(post.id, user.id, original), service.saveContent(post.id, user.id, edited)])
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1)
    const rejected = outcomes.find(result => result.status === "rejected")
    expect(rejected?.status === "rejected" && rejected.reason.message).toContain("This Entry changed")
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })
    expect(saved.version).toBe(3)
    expect(saved.content).toEqual(outcomes[0].status === "fulfilled" ? original : edited)
    race = false
    for (const change of ["membership", "room"]) {
      vi.spyOn(linkPreviews, "prepareAttachment").mockImplementationOnce(async () => {
        if (change === "membership") await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: true } })
        else await prisma.room.update({ where: { id: room.id }, data: { deleted_at: new Date() } })
        return null
      })
      await expect(service.saveContent(post.id, user.id, original)).rejects.toThrow(change === "membership" ? "Members only" : "Community not found")
      expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toEqual(saved)
      await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: false } })
      await prisma.room.update({ where: { id: room.id }, data: { deleted_at: null } })
    }
    await prisma.entry.update({ where: { id: post.id }, data: { round_id: round.id, creation_origin: "round_activity_cover", format: "mixed_media" } })
    const coverContent = { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] }
    for (const change of ["participation", "phase"]) {
      vi.spyOn(linkPreviews, "prepareAttachment").mockImplementationOnce(async () => {
        if (change === "participation") await prisma.activityParticipation.update({ where: { id: participant.id }, data: { status: "withdrawn" } })
        else await prisma.round.update({ where: { id: round.id }, data: { status: "archived" } })
        return null
      })
      await expect(service.saveContent(post.id, user.id, coverContent)).rejects.toThrow(change === "participation" ? "Join this Activity" : "not accepting contributions")
      expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toEqual(saved)
      await prisma.activityParticipation.update({ where: { id: participant.id }, data: { status: "active" } })
      await prisma.round.update({ where: { id: round.id }, data: { status: "active" } })
    }
    await service.saveContent(post.id, user.id, coverContent)
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).content).toEqual(coverContent)
    const submittedDocument = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })
    vi.spyOn(linkPreviews, "prepareAttachment").mockImplementationOnce(async () => {
      await prisma.activityArtifact.create({ data: { round_id: round.id, user_id: user.id, entry_id: post.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
      return null
    })
    await expect(service.saveContent(post.id, user.id, { type: "doc", content: [] })).rejects.toThrow("Add a title")
    expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toEqual(submittedDocument)
  } finally {
    await prisma.linkPreviewAttachment.deleteMany({ where: { owner_type: "Post", owner_id: post.id } })
    await prisma.document.delete({ where: { id: doc.id } })
    await prisma.entrySubject.deleteMany({ where: { entry_id: post.id } })
    await prisma.activityArtifact.deleteMany({ where: { round_id: round.id } })
    await prisma.entry.delete({ where: { id: post.id } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.entry.delete({ where: { id: source.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
