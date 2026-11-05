import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"

it.each(["participation", "entry", "document", "unversioned document", "round", "membership", "room"])("rejects an already prepared contribution after %s changes", async change => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@artifact-race.test`, username: "Artist", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", template_key: "art_before_chorus", status: "active", submit_by: new Date(now.getTime() + 3600000), feedback_due_at: new Date(now.getTime() + 7200000), created_at: now, updated_at: now } })
  const participant = await prisma.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } })
  const source = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, status: "published", creation_origin: "project_material", created_at: now, updated_at: now } })
  const post = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, round_id: round.id, source_entry_id: source.id, status: "draft", creation_origin: "round_activity_cover", format: "mixed_media", format_data: { image_url: "/api/v1/uploads/42" }, created_at: now, updated_at: now } })
  const document = await prisma.document.create({ data: { docable_type: "Post", docable_id: post.id, content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] }, version: 1, created_at: now, updated_at: now } })
  const service = new ArtBeforeChorusRoundService()
  Object.assign(service, { prisma, circleAccess: Object.assign(new RoomAccessService(), { prisma }) })
  const transaction = prisma.$transaction.bind(prisma)
  // The real preflight finishes, then a competing request changes its inputs.
  const spy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
    if (change === "membership") await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: true } })
    if (change === "room") await prisma.room.update({ where: { id: room.id }, data: { deleted_at: now } })
    if (change === "participation") await prisma.activityParticipation.update({ where: { id: participant.id }, data: { status: "withdrawn" } })
    if (change === "entry") await prisma.entry.update({ where: { id: post.id }, data: { format_data: { image_url: "/api/v1/uploads/43" }, updated_at: new Date(now.getTime() + 1000) } })
    if (change === "document") await prisma.document.update({ where: { id: document.id }, data: { version: { increment: 1 } } })
    if (change === "round") await prisma.round.update({ where: { id: round.id }, data: { template_config: { responseFormat: "audio" }, updated_at: new Date(now.getTime() + 1000) } })
    if (change === "unversioned document") await prisma.document.update({ where: { id: document.id }, data: { content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/43" } }] } } })
    return transaction(callback)
  })
  const hints: number[] = []
  const listener = new CommittedIdChangeListener("afire_room_changes", "afire-creative-test", process.env.DATABASE_URL!, id => hints.push(id), () => {}, () => {})
  let sentinel = Number.MAX_SAFE_INTEGER - room.id
  const flush = async () => {
    const id = sentinel--
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(id)})::text`
    await vi.waitFor(() => expect(hints).toContain(id))
    return hints.filter(value => value === room.id).length
  }
  try {
    await listener.start()
    await expect(service.submitArtifact(round, user.id, { kind: "cover", entryId: post.id })).rejects.toThrow(change === "membership" ? "Members only" : change === "room" ? "Community not found" : change === "participation" ? "Join this Activity" : change === "round" ? "This Round changed" : "Your work changed. Review your contribution again.")
    expect(spy).toHaveBeenCalledOnce()
    expect(await prisma.activityArtifact.count({ where: { round_id: round.id } })).toBe(0)
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: "draft", updated_at: change === "entry" ? new Date(now.getTime() + 1000) : now, format_data: { image_url: change === "entry" ? "/api/v1/uploads/43" : "/api/v1/uploads/42" } })
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).version).toBe(change === "document" ? 2 : 1)
    expect(await flush()).toBe(0)
    spy.mockRestore()
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: user.id }, data: { disabled: false } })
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: null } })
    await prisma.activityParticipation.update({ where: { id: participant.id }, data: { status: "active" } })
    const refreshedRound = await prisma.round.findUniqueOrThrow({ where: { id: round.id } })
    if (change === "participation") {
      const rollback = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => transaction(async tx => {
        await callback(tx)
        throw new Error("Submission interrupted after hint")
      }))
      await expect(service.submitArtifact(refreshedRound, user.id, { kind: "cover", entryId: post.id })).rejects.toThrow("Submission interrupted after hint")
      rollback.mockRestore()
      expect(await prisma.activityArtifact.count({ where: { round_id: round.id } })).toBe(0)
      expect(await flush()).toBe(0)
      expect(await prisma.chatMessage.count({ where: { room_id: room.id } })).toBe(0)
    }
    await expect(service.submitArtifact(refreshedRound, user.id, { kind: "cover", entryId: post.id })).resolves.toMatchObject({ kind: "cover" })
    expect(await flush()).toBe(1)
    expect(await prisma.chatMessage.count({ where: { room_id: room.id, timeline_kind: "round_event" } })).toBeGreaterThan(0)
  } finally {
    await listener.stop()
    spy.mockRestore()
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.activityArtifact.deleteMany({ where: { round_id: round.id } })
    await prisma.document.delete({ where: { id: document.id } })
    await prisma.entry.deleteMany({ where: { id: { in: [post.id, source.id] } } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
