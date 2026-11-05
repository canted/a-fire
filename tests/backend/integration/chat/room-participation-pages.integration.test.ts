import "reflect-metadata"
import type { Prisma } from "@prisma/client"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { readRoomParticipation } from "@server/api/v1/rounds/room-participation"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("pages own submissions, replies and choices without exposing private or withdrawn content", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback participation fixture")
  try {
    await prisma.$transaction(async tx => {
      const users = await Promise.all(["Viewer", "Other"].map(username => tx.user.create({ data: { email: `${crypto.randomUUID()}@participation-pages.test`, username, created_at: now, updated_at: now } })))
      const room = await tx.room.create({ data: { name: "Room", porosity: "closed", created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { room_id: room.id, user_id: users[0].id, created_at: now, updated_at: now } })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: users[0].id, name: "Round", status: "archived", created_at: now, updated_at: now } })
      const base = { room_id: room.id, round_id: round.id, user_id: users[0].id, status: "published", published_at: now, created_at: now, updated_at: now }
      const own = await tx.entry.create({ data: base })
      const other = await tx.entry.create({ data: { ...base, user_id: users[1].id } })
      const reply = await tx.reply.create({ data: { entry_id: other.id, user_id: users[0].id, status: "published", published_at: now, created_at: now, updated_at: now } })
      await tx.reply.create({ data: { entry_id: other.id, user_id: users[1].id, status: "published", published_at: now, created_at: now, updated_at: now } })
      const artifact = await tx.activityArtifact.create({ data: { round_id: round.id, entry_id: other.id, user_id: users[1].id, kind: "cover", status: "active", submitted_at: now, created_at: now, updated_at: now } })
      await tx.activityOffer.create({ data: { round_id: round.id, user_id: users[0].id, first_artifact_id: artifact.id, second_artifact_id: artifact.id, chosen_artifact_id: artifact.id, created_at: now, updated_at: now } })
      const mismatchedRound = await tx.round.create({ data: { room_id: room.id, host_id: users[0].id, name: "Mismatched choice", status: "archived", created_at: now, updated_at: now } })
      await tx.activityOffer.create({ data: { round_id: mismatchedRound.id, user_id: users[0].id, first_artifact_id: artifact.id, second_artifact_id: artifact.id, chosen_artifact_id: artifact.id, created_at: now, updated_at: now } })
      await tx.entry.create({ data: { ...base, status: "draft" } })
      await tx.entry.create({ data: { ...base, status: "deleted" } })
      const project = await tx.project.create({ data: { owner_id: users[0].id, name: "Private", created_at: now, updated_at: now } })
      await tx.entry.create({ data: { ...base, project_id: project.id, room_id: null } })
      const otherRoom = await tx.room.create({ data: { name: "Elsewhere", created_at: now, updated_at: now } })
      await tx.entry.create({ data: { ...base, room_id: otherRoom.id } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: tx })
      const service = new RoundsService(); Object.assign(service, { prisma: { $transaction: (fn: (tx: Prisma.TransactionClient) => unknown) => fn(tx) }, circleAccess: access })
      const first = await service.participationForRoom(room.id, users[0].id, { limit: 1 })
      expect(first.items[0].contribution).toMatchObject({ kind: "choice", entryId: String(other.id) })
      const second = await service.participationForRoom(room.id, users[0].id, { limit: 1, cursor: first.nextCursor! })
      expect(second.items[0].contribution).toMatchObject({ kind: "reply", entryId: String(other.id), replyId: String(reply.id) })
      const third = await service.participationForRoom(room.id, users[0].id, { limit: 1, cursor: second.nextCursor! })
      expect(third.items[0].contribution).toMatchObject({ kind: "submission", entryId: String(own.id), replyCount: 0 })
      expect(third.nextCursor).toBeNull()
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()), user: users[1].id })).toString("base64url")
      await expect(service.participationForRoom(room.id, users[0].id, { cursor: forged })).rejects.toThrow("cursor")
      await tx.activityArtifact.update({ where: { id: artifact.id }, data: { status: "removed" } })
      expect((await service.participationForRoom(room.id, users[0].id)).items.map(item => item.contribution.kind)).toEqual(["reply", "submission"])
      await expect(service.participationForRoom(room.id, users[0].id, { limit: 101 })).rejects.toThrow("limit")
      await tx.entry.update({ where: { id: other.id }, data: { status: "deleted" } })
      expect((await service.participationForRoom(room.id, users[0].id)).items.map(item => item.contribution.kind)).toEqual(["submission"])
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      await expect(service.participationForRoom(room.id, users[0].id, { cursor: first.nextCursor! })).rejects.toThrow("Forbidden")
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})


it("walks publication and legacy timestamp streams without skipping tied events", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback participation streams")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@participation-streams.test`, username: "Viewer", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Streams", created_at: now, updated_at: now } })
      const round = await tx.round.create({ data: { room_id: room.id, host_id: user.id, name: "Round", status: "archived", created_at: now, updated_at: now } })
      await tx.entry.createMany({ data: Array.from({ length: 121 }, (_, index) => ({ room_id: room.id, round_id: round.id, user_id: user.id, status: "published", published_at: index % 2 ? now : null, created_at: now, updated_at: now })) })
      const posts = await tx.entry.findMany({ where: { round_id: round.id }, orderBy: { id: "desc" } })
      await tx.reply.createMany({ data: posts.map((post, index) => ({ user_id: user.id, entry_id: post.id, status: "published", published_at: index % 2 ? now : null, created_at: now, updated_at: now })) })
      await tx.$executeRaw`UPDATE entries SET created_at = '2026-01-01 12:00:00.123456'::timestamp, published_at = CASE WHEN published_at IS NULL THEN NULL ELSE '2026-01-01 12:00:00.123456'::timestamp END WHERE round_id = ${round.id}`
      await tx.$executeRaw`UPDATE replies SET created_at = '2026-01-01 12:00:00.123456'::timestamp, published_at = CASE WHEN published_at IS NULL THEN NULL ELSE '2026-01-01 12:00:00.123456'::timestamp END WHERE user_id = ${user.id}`
      const replies = await tx.reply.findMany({ where: { user_id: user.id }, orderBy: { id: "desc" } })
      const actual: string[] = []
      let cursor: string | undefined
      do {
        const page = await readRoomParticipation(tx, room.id, user.id, { limit: 7, cursor })
        expect(page.items.length).toBeLessThanOrEqual(7)
        for (const item of page.items) {
          expect(item.contribution.occurredAt).toBe("2026-01-01T12:00:00.123456Z")
          if (item.contribution.kind === "submission") expect(item.contribution).toMatchObject({ replyCount: 1 })
          actual.push(item.id)
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      expect(actual).toEqual([...replies.map(reply => `1:${reply.id}`), ...posts.map(post => `0:${post.id}`)])
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
