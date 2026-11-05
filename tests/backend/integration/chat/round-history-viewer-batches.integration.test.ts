import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it.each([2, 3])("batches history viewer state across 500 IDs with %s covers and retains participant status", async coverCount => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback history fixture")
  try {
    await prisma.$transaction(async tx => {
      const users = await Promise.all(Array.from({ length: 3 }, (_, index) => tx.user.create({ data: { email: `${crypto.randomUUID()}@round-history.test`, username: `Member ${index}`, created_at: now, updated_at: now } })))
      const user = users[0]
      const room = await tx.room.create({ data: { name: "History", owner_id: user.id, created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const base = { room_id: room.id, host_id: user.id, name: "Archived", template_key: "feedback", status: "archived", closed_at: now, created_at: now, updated_at: now }
      await tx.round.createMany({ data: Array.from({ length: 501 }, () => base) })
      const historical = await tx.round.findFirstOrThrow({ where: { room_id: room.id }, orderBy: { id: "asc" } })
      await tx.activityParticipation.create({ data: { round_id: historical.id, user_id: user.id, role: "participant", status: "withdrawn", joined_at: now, created_at: now, updated_at: now } })
      const active: number[] = []
      for (const count of [coverCount]) {
        const round = await tx.round.create({ data: { ...base, name: `Covers ${count}`, status: "active", closed_at: null, template_key: "art_before_chorus", submit_by: new Date(now.getTime() - 60000), feedback_due_at: new Date(now.getTime() + 60000) } })
        active.push(round.id)
        await tx.activityParticipation.create({ data: { round_id: round.id, user_id: user.id, role: "participant", joined_at: now, created_at: now, updated_at: now } })
        for (const author of users.slice(0, count)) {
          const post = await tx.entry.create({ data: { room_id: room.id, round_id: round.id, user_id: author.id, status: "draft", created_at: now, updated_at: now } })
          await tx.activityArtifact.create({ data: { round_id: round.id, user_id: author.id, entry_id: post.id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
        }
      }
      const projects = await Promise.all(users.map(author => tx.project.create({ data: { owner_id: author.id, name: "Private", created_at: now, updated_at: now } })))
      const sources = await Promise.all(users.map((author, index) => tx.entry.create({ data: { project_id: projects[index].id, user_id: author.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })))
      const ownEntry = await tx.entry.create({ data: { room_id: room.id, round_id: historical.id, source_entry_id: sources[0].id, user_id: user.id, status: "published", published_at: now, created_at: now, updated_at: now } })
      const otherPost = await tx.entry.create({ data: { room_id: room.id, round_id: active[0], source_entry_id: sources[1].id, user_id: users[1].id, status: "published", published_at: now, created_at: now, updated_at: now } })
      const feedback = await tx.reply.create({ data: { entry_id: otherPost.id, user_id: user.id, status: "published", published_at: now, created_at: now, updated_at: now } })
      await tx.reply.create({ data: { entry_id: otherPost.id, user_id: users[2].id, status: "published", published_at: now, created_at: now, updated_at: now } })
      const batches: number[] = []
      let groupReads = 0
      const participation = new Proxy(tx.activityParticipation, { get(target, key) {
        if (key === "findUnique") return () => { throw new Error("History must not query each participant separately") }
        if (key === "findMany") return async (args: Parameters<typeof target.findMany>[0]) => {
          const ids = (args?.where?.round_id as { in: number[] }).in
          batches.push(ids.length)
          expect(ids.length).toBeLessThanOrEqual(500)
          return target.findMany(args)
        }
        return Reflect.get(target, key)
      } })
      const artifacts = new Proxy(tx.activityArtifact, { get(target, key) {
        if (key === "count") return () => { throw new Error("History must not count covers per Round") }
        if (key === "groupBy") return (...args: Parameters<typeof target.groupBy>) => { groupReads++; return target.groupBy(...args) }
        return Reflect.get(target, key)
      } })
      const database = new Proxy(tx, { get(target, key) { return key === "$transaction" ? (callback: (client: typeof tx) => unknown) => callback(database) : key === "activityParticipation" ? participation : key === "activityArtifact" ? artifacts : Reflect.get(target, key) } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: database })
      const lifecycle = new RoundLifecycleService(); Object.assign(lifecycle, { prisma: database })
      const service = new RoundsService(); Object.assign(service, { prisma: database, circleAccess: access, activityLifecycle: lifecycle })
      const result = await service.listForRoom(room.id, user.id)
      expect(batches).toEqual([500, 2])
      expect(groupReads).toBe(1)
      expect(result.recentRounds).toHaveLength(501)
      expect(result.currentRounds.find(round => round.id === String(active[0]))?.viewerState?.canSubmit).toBe(coverCount === 2)
      expect(result.recentRounds.find(round => round.id === String(historical.id))?.viewerState).toMatchObject({ role: null, status: "withdrawn", canSubmit: false })
      expect(result.recentRounds.find(round => round.id === String(historical.id))?.viewerContributions).toEqual([
        { entryId: String(ownEntry.id), kind: "submission", replyCount: 0, occurredAt: now.toISOString(), label: "Your shared work" },
      ])
      expect(result.currentRounds.find(round => round.id === String(active[0]))?.viewerContributions).toEqual([
        { entryId: String(otherPost.id), kind: "reply", replyId: String(feedback.id), occurredAt: now.toISOString(), label: "Your feedback" },
      ])
      batches.length = 0
      groupReads = 0
      const overview = await service.overviewForRoom(room.id, user.id)
      expect(overview.roomId).toBe(String(room.id))
      expect(overview.recentRounds).toEqual([])
      expect(overview.roomHistory).toHaveLength(3)
      expect(overview.currentRounds.map(round => round.id).sort()).toEqual(active.map(String).sort())
      expect(overview.participationPreview).toHaveLength(2)
      expect(overview.participationPreview.map(item => item.contribution.entryId).sort()).toEqual([ownEntry.id, otherPost.id].map(String).sort())
      expect(batches).toEqual([1])
      expect(groupReads).toBe(1)
      throw rollback
    }, { timeout: 60000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
