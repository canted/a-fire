import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"

it("retains one offer under races and validates current Round, participant and cover when choosing", async () => {
  const prisma = new PrismaService(), now = new Date()
  const users = await Promise.all(["Artist", "Responder"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@cover-choice.test`, username, created_at: now, updated_at: now } })))
  const [artist, responder] = users
  const room = await prisma.room.create({ data: { owner_id: artist.id, name: "Room", created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: room.id, user_id: responder.id, created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { room_id: room.id, host_id: artist.id, name: "Round", template_key: "art_before_chorus", status: "active", submit_by: new Date(now.getTime() - 1000), feedback_due_at: new Date(now.getTime() + 7200000), created_at: now, updated_at: now } })
  const participant = await prisma.activityParticipation.create({ data: { round_id: round.id, user_id: responder.id, role: "participant", status: "active", joined_at: now, created_at: now, updated_at: now } })
  const posts = await Promise.all([artist, responder].map(user => prisma.entry.create({ data: { room_id: room.id, user_id: user.id, round_id: round.id, status: "draft", created_at: now, updated_at: now } })))
  // Offers need two eligible covers, independent of their original contributor identities.
  const covers = await Promise.all(posts.map((post, index) => prisma.activityArtifact.create({ data: { round_id: round.id, user_id: index ? responder.id : artist.id, entry_id: post.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })))
  const third = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@cover-choice.test`, username: "Other artist", created_at: now, updated_at: now } })
  users.push(third)
  const thirdPost = await prisma.entry.create({ data: { room_id: room.id, user_id: third.id, round_id: round.id, status: "draft", created_at: now, updated_at: now } })
  posts.push(thirdPost)
  covers.push(await prisma.activityArtifact.create({ data: { round_id: round.id, user_id: third.id, entry_id: thirdPost.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } }))
  const service = new ArtBeforeChorusRoundService()
  Object.assign(service, { prisma, circleAccess: Object.assign(new RoomAccessService(), { prisma }) })
  const choose = (coverId: number) => service.chooseCover(round, responder.id, { coverId })
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
    const offers = await Promise.all(Array.from({ length: 6 }, () => (service as any).ensureOffer(round.id, responder.id)))
    expect(new Set(offers.map(offer => offer.id)).size).toBe(1)
    expect(await prisma.activityOffer.count({ where: { round_id: round.id } })).toBe(1)
    const coverId = offers[0].first_artifact_id
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: responder.id }, data: { disabled: true } })
    await expect(choose(coverId)).rejects.toThrow("Members only")
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: responder.id }, data: { disabled: false } })
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: now } })
    await expect(choose(coverId)).rejects.toThrow("Community not found")
    await prisma.room.update({ where: { id: room.id }, data: { deleted_at: null } })
    await prisma.round.update({ where: { id: round.id }, data: { status: "archived" } })
    await expect(choose(coverId)).rejects.toThrow("closed")
    await prisma.round.update({ where: { id: round.id }, data: { status: "active" } })
    await prisma.activityParticipation.update({ where: { id: participant.id }, data: { status: "withdrawn" } })
    await expect(choose(coverId)).rejects.toThrow("Join this Activity")
    await prisma.activityParticipation.update({ where: { id: participant.id }, data: { status: "active" } })
    await prisma.activityArtifact.update({ where: { id: coverId }, data: { status: "removed" } })
    await expect(choose(coverId)).rejects.toThrow("no longer available")
    expect((await prisma.activityOffer.findUniqueOrThrow({ where: { id: offers[0].id } })).chosen_artifact_id).toBeNull()
    await prisma.activityArtifact.update({ where: { id: coverId }, data: { status: "active" } })
    await expect(choose(covers[1].id)).rejects.toThrow("offered")
    expect(await flush()).toBe(0)
    const transaction = prisma.$transaction.bind(prisma)
    const rollback = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => transaction(async tx => {
      await callback(tx)
      throw new Error("Choice interrupted after hint")
    }))
    await expect(choose(coverId)).rejects.toThrow("Choice interrupted after hint")
    rollback.mockRestore()
    expect((await prisma.activityOffer.findUniqueOrThrow({ where: { id: offers[0].id } })).chosen_artifact_id).toBeNull()
    expect(await flush()).toBe(0)
    await Promise.all([choose(coverId), choose(coverId)])
    expect(await flush()).toBe(1)
    expect((await prisma.activityOffer.findUniqueOrThrow({ where: { id: offers[0].id } })).chosen_artifact_id).toBe(coverId)
  } finally {
    await listener.stop()
    await prisma.activityOffer.deleteMany({ where: { round_id: round.id } })
    await prisma.activityArtifact.deleteMany({ where: { round_id: round.id } })
    await prisma.entry.deleteMany({ where: { id: { in: posts.map(post => post.id) } } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await prisma.$disconnect()
  }
})
