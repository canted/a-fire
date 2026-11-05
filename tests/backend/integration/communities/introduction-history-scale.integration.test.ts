import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { IntroductionsService } from "@server/api/v1/introductions/introductions.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("bounds introduction hydration as persisted history grows from 100 to 10,000", async () => {
  const prisma = new PrismaService()
  const rollback = new Error("rollback introduction scale fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const [author, viewer, creator] = await tx.user.createManyAndReturn({ data: Array.from({ length: 3 }, () => ({
        email: `${crypto.randomUUID()}@introduction-scale.test`, username: "Fixture", created_at: now, updated_at: now,
      })) })
      const room = await tx.room.create({ data: { name: "Scale fixture", owner_id: author.id, porosity: "closed", created_at: now, updated_at: now } })
      const service = withTestDependencies(new IntroductionsService(), { prisma: tx })
      const params = { roomId: room.id, viewedUserId: author.id, viewedSquareId: 2147483647, viewerUserId: viewer.id }
      let oldest: number | undefined
      for (const total of [100, 10_000]) {
        const additions = total === 100 ? 100 : 9900
        for (let offset = 0; offset < additions; offset += 500) {
          const rows = await tx.introduction.createManyAndReturn({ data: Array.from({ length: Math.min(500, additions - offset) }, () => ({
            room_id: room.id, created_by_id: creator.id, note: "Synthetic introduction", created_at: now, updated_at: now,
          })), select: { id: true } })
          oldest ??= Math.min(...rows.map(row => row.id))
          await tx.introductionRecipient.createMany({ data: rows.flatMap(row => [author, viewer].map(user => ({
            introduction_id: row.id, user_id: user.id, created_at: now, updated_at: now,
          }))) })
        }
        // Observe real Prisma results, rather than replacing persistence with mocks.
        const reads = vi.spyOn(tx.introduction, "findMany")
        try {
          const overview = await service.overviewForMember(params)
          expect(overview?.count).toBe(total)
          expect(overview?.unseenCount).toBe(total)
          expect(overview?.authors).toHaveLength(1)
          expect(overview?.unseenIntroductions).toHaveLength(3)
          const hydrated = await Promise.all(reads.mock.results.map(result => result.value))
          expect(hydrated.flat()).toHaveLength(3)
          reads.mockClear()
          const first = await service.pageForMember({ ...params, target: String(oldest) })
          const second = await service.pageForMember({ ...params, cursor: first.nextCursor! })
          expect(first.introductions).toHaveLength(31)
          expect(first.introductions.at(-1)?.id).toBe(String(oldest))
          expect(second.introductions).toHaveLength(30)
          expect(new Set([...first.introductions, ...second.introductions].map(item => item.id)).size).toBe(61)
          const pageReads = await Promise.all(reads.mock.results.map(result => result.value))
          expect(pageReads.map(rows => rows.length)).toEqual([31, 31])
        } finally { reads.mockRestore() }
      }
      throw rollback
    }, { timeout: 60_000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
}, 70_000)
