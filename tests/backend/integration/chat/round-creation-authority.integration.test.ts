import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RoundRuntime } from "@server/api/v1/rounds/runtime/round-runtime.registry"
import { ArtBeforeChorusRoundService } from "@server/api/v1/rounds/runtime/art-before-chorus.activity.service"

const cases = ["create", "edit", "start", "archive", "archive-creative"].flatMap(operation =>
  ["membership", "owner", "deleted", "unchanged", ...(["edit", "start"].includes(operation) ? ["completed", "edited"] : []), ...(operation.startsWith("archive") ? ["round-scope"] : [])].map(change => ({ operation, change })))
it.each(cases)("checks $operation when $change changes after initial authorization", async ({ operation, change }) => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@round-authority.test`, username: "Owner", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  const round = operation === "create" ? null : await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Original", template_key: operation === "archive-creative" ? "art_before_chorus" : "feedback", status: operation.startsWith("archive") ? "active" : "draft", created_at: now, updated_at: now } })
  const other = await prisma.room.create({ data: { name: "Other", created_at: now, updated_at: now } })
  let concurrent = round
  const access = new RoomAccessService(); Object.assign(access, { prisma })
  const notifications = { scheduleActivityNotifications: vi.fn() }
  const service = new RoundsService()
  const transact = prisma.$transaction.bind(prisma)
  const changedTransaction = async (callback: Parameters<PrismaService["$transaction"]>[0]) => {
    if (change === "membership") await prisma.roomMembership.updateMany({ where: { room_id: room.id }, data: { disabled: true } })
    if (change === "owner") await prisma.room.update({ where: { id: room.id }, data: { owner_id: null } })
    if (change === "deleted") await prisma.room.update({ where: { id: room.id }, data: { deleted_at: new Date() } })
    if (round && change === "round-scope") concurrent = await prisma.round.update({ where: { id: round.id }, data: { room_id: other.id } })
    if (round && change === "completed") concurrent = await prisma.round.update({ where: { id: round.id }, data: { status: "archived", closed_at: new Date() } })
    if (round && change === "edited") concurrent = await prisma.round.update({ where: { id: round.id }, data: { prompt: "Concurrent edit" } })
    return transact(callback)
  }
  const database = new Proxy(prisma, { get: (target, key) => key === "$transaction" ? changedTransaction : Reflect.get(target, key, target) })
  const creative = new ArtBeforeChorusRoundService(); Object.assign(creative, { prisma: database })
  const runtime = new RoundRuntime(); Object.assign(runtime, { prisma, artBeforeChorus: creative, realtime: { emit: vi.fn(), chatRoom: (id: number) => `chat:${id}` } })
  Object.assign(service, { rounds: runtime, prisma: database, circleAccess: access, notifications, activityLifecycle: { reconcileCircle: vi.fn(), reconcileActivity: vi.fn().mockResolvedValue(false) } })
  try {
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
    const action = operation === "create" ? service.createForRoom(room.id, user.id, { name: "New", status: "draft" })
      : operation === "edit" ? service.update(round!.id, user.id, { name: "Changed" }) : operation === "start" ? service.start(round!.id, user.id) : service.archive(round!.id, user.id)
    if (change === "unchanged") {
      await expect(action).resolves.toMatchObject({ status: operation === "start" ? "active" : operation.startsWith("archive") ? "archived" : "draft" })
      if (operation === "create") expect(await prisma.round.findFirstOrThrow({ where: { room_id: room.id } })).toMatchObject({ room_id: room.id })
      if (!operation.startsWith("archive")) expect(notifications.scheduleActivityNotifications).toHaveBeenCalledOnce()
      else expect(await prisma.roundResult.count({ where: { round_id: round!.id } })).toBe(1)
    } else {
      const reason = change === "membership" ? "Members only" : change === "owner" ? "Room owner only" : change === "deleted" ? "Community not found" : "This Round changed"
      await expect(action).rejects.toThrow(reason)
      if (round) expect(await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).toEqual(concurrent)
      else expect(await prisma.round.count({ where: { room_id: room.id } })).toBe(0)
      expect(notifications.scheduleActivityNotifications).not.toHaveBeenCalled()
    }
  } finally {
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.roundResult.deleteMany({ where: { room_id: room.id } })
    await prisma.round.deleteMany({ where: { room_id: { in: [room.id, other.id] } } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.deleteMany({ where: { id: { in: [room.id, other.id] } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
