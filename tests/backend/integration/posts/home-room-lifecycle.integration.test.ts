import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { HomeService } from "@server/api/v1/projects/home.service"

it("excludes deleted Rooms from Home even while their membership rows remain", async () => {
  const prisma = new PrismaService(), rollback = new Error("Rollback Home lifecycle"), now = new Date()
  try {
    await expect(prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Home", email: `${crypto.randomUUID()}@home-lifecycle.test`, created_at: now, updated_at: now } })
      const rooms = await Promise.all([false, true].map(deleted => tx.room.create({ data: { owner_id: user.id, name: deleted ? "Deleted" : "Visible", deleted_at: deleted ? now : null, created_at: now, updated_at: now } })))
      await tx.roomMembership.createMany({ data: rooms.map(room => ({ user_id: user.id, room_id: room.id, created_at: now, updated_at: now })) })
      const service = new HomeService()
      Object.assign(service, { prisma: tx, projects: { homeSummaries: async () => [] }, rounds: {}, entries: {}, unseen: {
        countResponsesToOwnPosts: async (_user: number, ids: number[]) => { expect(ids).toEqual([rooms[0].id]); return 0 },
        countForUserWithRooms: async (_user: number, ids: number[]) => { expect(ids).toEqual([rooms[0].id]); return { overall: { total: 0 }, byRoom: new Map() } },
      } })
      const result = await service.snapshot(user.id)
      expect(result.recentRooms.map(room => room.id)).toEqual([String(rooms[0].id)])
      expect(result.roomDashboard).toEqual({ newResponses: 0, activitiesJoined: 0, feedbackGiven: 0, entriesShared: 0 })
      throw rollback
    })).rejects.toBe(rollback)
  } finally { await prisma.$disconnect() }
})
