import type { Prisma } from "@prisma/client"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"

it("commits Room participation hints atomically and rechecks withdrawal authority", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { username: "Participant", email: `${crypto.randomUUID()}@round-hints.test`, created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "No Board", owner_id: user.id, porosity: "closed", created_at: now, updated_at: now } })
  const membership = await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", status: "active", created_at: now, updated_at: now } })
  const access = new RoomAccessService(); Object.assign(access, { prisma })
  const service = new RoundsService(); Object.assign(service, { prisma, circleAccess: access })
  // Persistence and notification boundaries are real; the final read representation
  // is covered separately by Room Round HTTP/browser tests.
  vi.spyOn(service, "show").mockResolvedValue({} as Awaited<ReturnType<RoundsService["show"]>>)
  const hints: number[] = []
  const listener = new CommittedIdChangeListener("afire_room_changes", "afire-round-participation-test", process.env.DATABASE_URL!, id => hints.push(id), () => {}, () => {})
  let sentinel = Number.MAX_SAFE_INTEGER - room.id
  const flush = async () => {
    const id = sentinel--
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(id)})::text`
    await vi.waitFor(() => expect(hints).toContain(id))
    return hints.filter(value => value === room.id).length
  }
  try {
    await listener.start()
    const failedJoin = prisma.$extends({ query: { activityParticipation: { async upsert({ args, query }) { await query(args); throw new Error("Join interrupted") } } } })
    Object.assign(service, { prisma: failedJoin })
    await expect(service.updateParticipation(round.id, user.id, { role: "participant" })).rejects.toThrow("Join interrupted")
    expect(await prisma.activityParticipation.count({ where: { round_id: round.id } })).toBe(0)
    expect(await flush()).toBe(0)
    Object.assign(service, { prisma })
    await service.updateParticipation(round.id, user.id, { role: "participant" })
    expect(await flush()).toBe(1)
    const joined = await prisma.activityParticipation.findUniqueOrThrow({ where: { round_id_user_id: { round_id: round.id, user_id: user.id } } })
    expect(joined).toMatchObject({ status: "active" })
    expect(joined).not.toHaveProperty("square_id")
    const failedWithdrawal = {
      round: prisma.round,
      $transaction: (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => prisma.$transaction(async tx => {
        await operation(tx) // The Room hint has already been queued in this transaction.
        throw new Error("Withdrawal interrupted")
      }),
    }
    Object.assign(service, { prisma: failedWithdrawal })
    await expect(service.withdrawParticipation(round.id, user.id)).rejects.toThrow("Withdrawal interrupted")
    expect(await prisma.activityParticipation.findUniqueOrThrow({ where: { id: joined.id } })).toEqual(joined)
    expect(await flush()).toBe(1)
    Object.assign(service, { prisma })
    const requireMember = access.require.bind(access)
    const revoke = vi.spyOn(access, "require").mockImplementationOnce(async (...args) => {
      const result = await requireMember(...args)
      await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      return result
    })
    await expect(service.withdrawParticipation(round.id, user.id)).rejects.toThrow("Members only")
    revoke.mockRestore()
    expect(await prisma.activityParticipation.findUniqueOrThrow({ where: { id: joined.id } })).toEqual(joined)
    expect(await flush()).toBe(1)
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
    await Promise.all([service.withdrawParticipation(round.id, user.id), service.withdrawParticipation(round.id, user.id)])
    expect(await flush()).toBe(2)
    expect(await prisma.activityParticipation.findUniqueOrThrow({ where: { id: joined.id } })).toMatchObject({ status: "withdrawn" })
    // Draft cancellation has no published Wall, but still changes the Room list.
    const draft = await prisma.round.update({ where: { id: round.id }, data: { status: "draft" } })
    Object.assign(service, { prisma: failedWithdrawal })
    await expect(service.archive(round.id, user.id)).rejects.toThrow("Withdrawal interrupted")
    expect(await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).toEqual(draft)
    expect(await flush()).toBe(2)
    Object.assign(service, { prisma })
    await Promise.all([service.archive(round.id, user.id), service.archive(round.id, user.id)])
    expect(await flush()).toBe(3)
    expect((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).status).toBe("cancelled")
    expect(await prisma.roundResult.count({ where: { round_id: round.id } })).toBe(0)
  } finally {
    await listener.stop()
    vi.restoreAllMocks()
    await prisma.activityParticipation.deleteMany({ where: { round_id: round.id } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.roomMembership.delete({ where: { id: membership.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
