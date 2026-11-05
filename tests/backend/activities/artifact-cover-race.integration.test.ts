import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"

it.each(["choice", "cover", "artwork", "deleted entry"])("rejects a prepared response after selected %s changes", async change => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@artifact-race.test`, username: "Artist", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", template_config: { responseFormat: "audio_text" }, template_key: "art_before_chorus", status: "active", submit_by: new Date(now.getTime() - 1000), feedback_due_at: new Date(now.getTime() + 7200000), created_at: now, updated_at: now } })
  await prisma.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } })
  const source = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, status: "published", creation_origin: "project_material", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, round_id: round.id, source_entry_id: source.id, status: "draft", creation_origin: "round_activity_response", format: "mixed_media", format_data: { text: "Lyrics", gradient: "sunset" }, created_at: now, updated_at: now } })
  const document = await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lyrics" }] }] }, version: 1, created_at: now, updated_at: now } })
  const artists = await Promise.all([1, 2, 3].map(() => prisma.user.create({ data: { email: `${crypto.randomUUID()}@cover-race.test`, username: "Artist", created_at: now, updated_at: now } })))
  const covers = await Promise.all(artists.map(async artist => {
    const coverPost = await prisma.entry.create({ data: { user_id: artist.id, round_id: round.id, status: "draft", format: "mixed_media", format_data: { image_url: "/api/v1/uploads/42" }, created_at: now, updated_at: now } })
    return prisma.activityArtifact.create({ data: { round_id: round.id, user_id: artist.id, entry_id: coverPost.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
  }))
  const offer = await prisma.activityOffer.create({ data: { round_id: round.id, user_id: user.id, first_artifact_id: covers[0].id, second_artifact_id: covers[1].id, chosen_artifact_id: covers[0].id, created_at: now, updated_at: now } })
  const service = new ArtBeforeChorusRoundService()
  Object.assign(service, { prisma, circleAccess: Object.assign(new RoomAccessService(), { prisma }) })
  const transaction = prisma.$transaction.bind(prisma)
  // The real preflight finishes, then a competing request changes its inputs.
  const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
    if (change === "choice") await prisma.activityOffer.update({ where: { id: offer.id }, data: { chosen_artifact_id: covers[1].id } })
    if (change === "cover") await prisma.activityArtifact.update({ where: { id: covers[0].id }, data: { status: "removed" } })
    if (change === "artwork") await prisma.entry.update({ where: { id: covers[0].entry_id }, data: { format_data: { image_url: "/api/v1/uploads/43" }, updated_at: new Date(now.getTime() + 1000) } })
    if (change === "deleted entry") await prisma.entry.update({ where: { id: covers[0].entry_id }, data: { status: "deleted" } })
    return transaction(callback)
  })
  try {
    await expect(service.submitArtifact(round, user.id, { kind: "response", entryId: post.id })).rejects.toThrow("The chosen cover changed")
    expect(spy).toHaveBeenCalledOnce()
    expect(await prisma.activityArtifact.count({ where: { round_id: round.id, kind: "response" } })).toBe(0)
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ format: "mixed_media", format_data: { text: "Lyrics", gradient: "sunset" }, updated_at: now })
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).version).toBe(1)
    spy.mockRestore()
    await prisma.activityArtifact.update({ where: { id: covers[0].id }, data: { status: "active" } })
    await prisma.entry.update({ where: { id: covers[0].entry_id }, data: { status: "draft" } })
    const originalDocument = await prisma.document.findUniqueOrThrow({ where: { id: document.id } })
    const mentionDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: "2147483647", label: "Unavailable" } }] }] }
    for (const location of ["body", "saved feedback"]) {
      if (location === "body") await prisma.document.update({ where: { id: document.id }, data: { content: mentionDocument } })
      else await prisma.entry.update({ where: { id: post.id }, data: { shared_feedback: [{ source_room_id: room.id, original_room_ids: [room.id], content: mentionDocument, format: "mixed_media", format_data: null }] } })
      const before = await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })
      await expect(service.submitArtifact(round, user.id, { kind: "response", entryId: post.id })).rejects.toThrow("This step accepts audio and text only")
      expect(await prisma.activityArtifact.count({ where: { round_id: round.id, kind: "response" } })).toBe(0)
      expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(before)
      expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(0)
      await prisma.document.update({ where: { id: document.id }, data: { content: originalDocument.content! } })
      await prisma.entry.update({ where: { id: post.id }, data: { shared_feedback: [] } })
    }
    await expect(service.submitArtifact(round, user.id, { kind: "response", entryId: post.id })).resolves.toMatchObject({ kind: "response" })
  } finally {
    spy.mockRestore()
    await prisma.activityOffer.delete({ where: { id: offer.id } })
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.activityArtifact.deleteMany({ where: { round_id: round.id } })
    await prisma.document.delete({ where: { id: document.id } })
    await prisma.entry.deleteMany({ where: { id: { in: [post.id, source.id, ...covers.map(cover => cover.entry_id)] } } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { id: { in: [user.id, ...artists.map(artist => artist.id)] } } })
    await prisma.$disconnect()
  }
})
