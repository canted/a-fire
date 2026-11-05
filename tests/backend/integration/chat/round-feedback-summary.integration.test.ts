import "reflect-metadata"
import { completedFeedbackUsers } from "@server/api/v1/rounds/completed-feedback-users"
import { PrismaClient, type Prisma } from "@prisma/client"
import { expect, it } from "vitest"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("summarizes thousands of Round replies without loading individual feedback rows", async () => {
  const returnedGroupSizes: number[] = []
  const prisma = new PrismaClient().$extends({ query: { reply: {
    async findMany() { throw new Error("Round detail must not materialize individual replies") },
    async groupBy({ args, query }) {
      const rows = await query(args)
      returnedGroupSizes.push(rows.length)
      return rows
    },
  } } })
  const rollback = new Error("rollback Round feedback fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await Promise.all(["Viewer", "Peer"].map(username => tx.user.create({ data: {
        email: `${crypto.randomUUID()}@round-summary.test`, username, created_at: now, updated_at: now,
      } })))
      const room = await tx.room.create({ data: { name: "Feedback", owner_id: users[0].id, created_at: now, updated_at: now } })
      await tx.roomMembership.createMany({ data: users.map(user => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: users[0].id, name: "Round", status: "active", created_at: now, updated_at: now } })
      const projects = await Promise.all(users.map(user => tx.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })))
      const sources = await Promise.all(users.map((user, index) => tx.entry.create({ data: { user_id: user.id, project_id: projects[index].id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })))
      const posts = await Promise.all(users.map((user, index) => tx.entry.create({ data: {
        user_id: user.id, room_id: room.id, round_id: round.id, source_entry_id: sources[index].id,
        status: "published", created_at: now, updated_at: now, published_at: now,
      } })))
      await tx.activityParticipation.createMany({ data: users.map((user, index) => ({
        round_id: round.id, user_id: user.id, role: "participant", submitted_entry_id: posts[index].id,
        joined_at: now, created_at: now, updated_at: now,
      })) })
      await tx.reply.createMany({ data: Array.from({ length: 2000 }, (_, index) => ({
        entry_id: posts[0].id, user_id: users[index % 2].id, status: "published", published_at: now, created_at: now, updated_at: now,
      })) })
      await tx.reply.createMany({ data: Array.from({ length: 18 }, (_, index) => ({
        entry_id: posts[1].id, user_id: users[1].id, status: index < 7 ? "published" : "draft", created_at: now, updated_at: now,
      })) })
      const circleAccess = withTestDependencies(new RoomAccessService(), { prisma: tx })
      const service = withTestDependencies(new RoundsService(), {
        prisma: tx, circleAccess, activityLifecycle: { reconcileActivity: async () => false },
      })
      const result = await service.show(round.id, users[0].id)
      expect(result.feedbackSummary).toEqual({ submittedCount: 2, reviewedCount: 2, replyCount: 2007 })
      expect(result.feedbackProgress).toEqual({ givenCount: 1, totalCount: 2 })
      expect(result.submissions.map(post => post.replyCount).sort((a, b) => a - b)).toEqual([7, 2000])
      expect(returnedGroupSizes.sort()).toEqual([1, 2])
      await tx.reply.create({ data: {
        entry_id: posts[1].id, user_id: users[0].id, status: "draft", created_at: now, updated_at: now,
      } })
      // Query-only instrumentation preserves the transaction delegate at runtime.
      const database = tx as unknown as Prisma.TransactionClient
      // Both reminder paths reuse this query: repeated replies count once,
      // other authors and draft-only responses cannot complete this viewer.
      expect(await completedFeedbackUsers(database, [posts[0].id], users.map(user => user.id))).toEqual(new Set(users.map(user => user.id)))
      expect(await completedFeedbackUsers(database, [posts[0].id], [users[0].id])).toEqual(new Set([users[0].id]))
      expect(await completedFeedbackUsers(database, [posts[1].id], [users[0].id])).toEqual(new Set())
      const beforeEmpty = returnedGroupSizes.length
      expect(await completedFeedbackUsers(database, [], [users[0].id])).toEqual(new Set())
      expect(await completedFeedbackUsers(database, [posts[0].id], [])).toEqual(new Set())
      expect(returnedGroupSizes).toHaveLength(beforeEmpty)
      throw rollback
    }, { timeout: 20000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
