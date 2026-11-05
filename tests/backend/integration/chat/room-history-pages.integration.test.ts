import type { Prisma } from "@prisma/client"
import { roomRoundScope } from "@server/api/v1/rounds/round-scope"
import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("pages mixed history at microsecond precision and reauthorizes each page", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback history pages")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@history-pages.test`, username: "Member", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "History", owner_id: user.id, porosity: "closed", created_at: now, updated_at: now } })
      const member = await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const base = { room_id: room.id, host_id: user.id, name: "Completed", status: "archived", closed_at: now, created_at: now, updated_at: now }
      const rounds = []
      for (let i = 0; i < 4; i++) rounds.push(await tx.round.create({ data: base }))
      await tx.$executeRaw`UPDATE rounds SET closed_at = '2026-01-01 12:00:00.123456'::timestamp WHERE room_id = ${room.id}`
      await tx.$executeRaw`UPDATE rounds SET closed_at = '2026-01-01 12:00:00.123455'::timestamp WHERE id = ${rounds[0].id}`
      await tx.$executeRaw`UPDATE room_memberships SET created_at = '2026-01-01 12:00:00.123456'::timestamp WHERE id = ${member.id}`
      await tx.round.create({ data: { ...base, status: "draft", name: "Not history" } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: tx })
      const service = new RoundsService(); Object.assign(service, { prisma: { $transaction: (fn: (transaction: Prisma.TransactionClient) => unknown) => fn(tx) }, circleAccess: access })
      const first = await service.historyForRoom(room.id, user.id, { limit: 2 })
      expect(first.items).toHaveLength(2)
      expect(first.nextCursor).not.toBeNull()
      const items = [...first.items]
      let cursor = first.nextCursor
      while (cursor) {
        const page = await service.historyForRoom(room.id, user.id, { limit: 2, cursor })
        expect(page.items.length).toBeLessThanOrEqual(2)
        items.push(...page.items); cursor = page.nextCursor
      }
      expect(items.map(item => item.id)).toEqual([
        ...rounds.slice(1).reverse().map(round => `activity:${round.id}`), `member:${member.id}`, `activity:${rounds[0].id}`,
      ])
      expect(items.at(-1)?.occurredAt).toBe("2026-01-01T12:00:00.123455Z")
      expect(new Set(items.map(item => item.id)).size).toBe(5)
      await expect(service.historyForRoom(room.id, user.id, { limit: 101 })).rejects.toThrow("limit")
      await expect(service.historyForRoom(room.id, user.id, { cursor: "bad" })).rejects.toThrow("cursor")
      const wrongRoom = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()), room: room.id + 1 })).toString("base64url")
      await expect(service.historyForRoom(room.id, user.id, { cursor: wrongRoom })).rejects.toThrow("cursor")
      const elsewhere = await tx.room.create({ data: { name: "Elsewhere", owner_id: user.id, created_at: now, updated_at: now } })
      await tx.round.create({ data: { ...base, room_id: elsewhere.id, name: "Other Room" } })
      await tx.round.create({ data: { ...base, closed_at: null, name: "Fallback direct" } })
      const expected = await tx.round.findMany({ where: { ...roomRoundScope(room.id), status: "archived" }, select: { id: true } })
      const scoped = await service.historyForRoom(room.id, user.id, { limit: 100 })
      expect(scoped.items.flatMap(item => "roundId" in item ? [Number(item.roundId)] : []).sort((a, b) => a - b))
        .toEqual(expected.map(round => round.id).sort((a, b) => a - b))
      const walked: string[] = []
      let position: string | undefined
      do {
        const page = await service.historyForRoom(room.id, user.id, { limit: 1, cursor: position })
        walked.push(...page.items.map(item => item.id))
        position = page.nextCursor ?? undefined
      } while (position)
      expect(walked).toEqual(scoped.items.map(item => item.id))
      const invalidDate = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()), at: "2026-02-31T12:00:00.123456Z" })).toString("base64url")
      await expect(service.historyForRoom(room.id, user.id, { cursor: invalidDate })).rejects.toThrow("cursor")
      await tx.roomMembership.update({ where: { id: member.id }, data: { disabled: true } })
      await expect(service.historyForRoom(room.id, user.id, { cursor: first.nextCursor! })).rejects.toThrow("Forbidden")
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it.each(["open", "masked", "closed"])("enforces %s visitor history without renewing the visit", async porosity => {
  const prisma = new PrismaService(), now = new Date(), rollback = new Error("rollback visitor history")
  try {
    await prisma.$transaction(async tx => {
      const users = await Promise.all(["Host", "Visitor"].map(username => tx.user.create({ data: { email: `${crypto.randomUUID()}@history-visitor.test`, username, created_at: now, updated_at: now } })))
      const parent = await tx.room.create({ data: { name: "Parent", porosity: "closed", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Child", parent_id: parent.id, porosity, created_at: now, updated_at: now } })
      const parentMember = await tx.roomMembership.create({ data: { room_id: parent.id, user_id: users[1].id, created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: users[0].id, created_at: now, updated_at: now } })
      await tx.round.create({ data: { room_id: room.id, host_id: users[0].id, name: "Archived", status: "archived", closed_at: now, created_at: now, updated_at: now } })
      if (porosity === "closed") await tx.roomKnock.create({ data: { room_id: room.id, user_id: users[1].id, status: "admitted", reviewed_by_id: users[0].id, reviewed_at: now, created_at: now, updated_at: now } })
      const lease = await tx.roomVisit.create({ data: { room_id: room.id, user_id: users[1].id, source: porosity === "closed" ? "knock" : "porosity", last_activity_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: tx })
      let historyReads = 0
      const historyDatabase = new Proxy(tx, { get(target, key) {
        if (key === "$queryRaw") return (...args: Parameters<typeof tx.$queryRaw>) => {
          if ("sql" in args[0] && args[0].sql.includes("WITH events")) historyReads++
          return tx.$queryRaw(...args)
        }
        return Reflect.get(target, key)
      } })
      const service = new RoundsService(); Object.assign(service, { prisma: { $transaction: (fn: (transaction: Prisma.TransactionClient) => unknown) => fn(historyDatabase) }, circleAccess: access })
      const lifecycle = new RoundLifecycleService(); Object.assign(lifecycle, { prisma: tx })
      Object.assign(service, { activityLifecycle: lifecycle })
      const overview = await service.overviewForRoom(room.id, users[1].id)
      expect(overview.roomHistory).toHaveLength(porosity === "open" ? 2 : 0)
      expect(overview.participationPreview).toEqual([])
      expect(overview.nextRound).toBeNull()
      expect(overview.viewerAccess).toEqual({ kind: "visitor", canParticipate: false, scope: porosity === "open" ? "all" : "active_published_only" })
      historyReads = 0
      await expect(service.participationForRoom(room.id, users[1].id)).rejects.toThrow("Members only")
      if (porosity === "open") {
        const first = await service.historyForRoom(room.id, users[1].id, { limit: 1 })
        expect(first.items).toHaveLength(1)
        expect(first.nextCursor).not.toBeNull()
        const second = await service.historyForRoom(room.id, users[1].id, { cursor: first.nextCursor!, limit: 1 })
        expect(second.items).toHaveLength(1)
        expect(second.nextCursor).toBeNull()
        await tx.roomMembership.update({ where: { id: parentMember.id }, data: { disabled: true } })
        await expect(service.historyForRoom(room.id, users[1].id, { cursor: first.nextCursor! })).rejects.toThrow("Forbidden")
        expect(historyReads).toBe(2)
      } else {
        await expect(service.historyForRoom(room.id, users[1].id)).rejects.toThrow("history is unavailable")
        expect(historyReads).toBe(0)
      }
      expect(await tx.roomVisit.findUniqueOrThrow({ where: { room_id_user_id: { room_id: room.id, user_id: users[1].id } } })).toEqual(lease)
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
