import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("joins Room Rounds and reuses participation identity across role changes and rejoining", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback participation fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await tx.user.createManyAndReturn({ data: Array.from({ length: 2 }, () => ({ email: `${crypto.randomUUID()}@participation-position.test`, username: "Fixture", created_at: now, updated_at: now })) })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      await tx.roomMembership.createMany({ data: users.map(user => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: users[0].id, name: "Retained Round", status: "active", created_at: now, updated_at: now } })
      const retained = await tx.activityParticipation.create({ data: { round_id: round.id, user_id: users[0].id, role: "participant", status: "withdrawn", joined_at: now, withdrawn_at: now, created_at: now, updated_at: now } })
      const database = Object.assign(Object.create(tx), { $transaction: (operation: (client: typeof tx) => unknown) => operation(tx) })
      const circleAccess = withTestDependencies(new RoomAccessService(), { prisma: database })
      const service = withTestDependencies(new RoundsService(), { prisma: database, circleAccess, realtime: { emit: vi.fn(), chatRoom: (id: number) => `chat:${id}` } })
      vi.spyOn(service, "show").mockResolvedValue({} as Awaited<ReturnType<RoundsService["show"]>>)
      for (const user of users) {
        for (const role of ["participant", "reviewer", "participant"] as const) {
          await service.updateParticipation(round.id, user.id, { role })
          const participation = await tx.activityParticipation.findUniqueOrThrow({ where: { round_id_user_id: { round_id: round.id, user_id: user.id } } })
          expect(participation).toMatchObject({ role, status: "active" })
          expect(participation).not.toHaveProperty("square_id")
          if (user.id === users[0].id) expect(participation.id).toBe(retained.id)
        }
      }
      await tx.roomMembership.updateMany({ where: { room_id: room.id, user_id: users[1].id }, data: { disabled: true } })
      await expect(service.updateParticipation(round.id, users[1].id, { role: "reviewer" })).rejects.toThrow()
      expect((await tx.activityParticipation.findUniqueOrThrow({ where: { round_id_user_id: { round_id: round.id, user_id: users[1].id } } })).role).toBe("participant")
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
