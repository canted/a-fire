import { canManageEntryDraft } from "@server/api/v1/entries/entry-draft-access"
import { assertRoomEntrySource } from "@server/api/v1/entries/room-entry-policy"
import type { PrismaService } from "@server/prisma/prisma.service"
import { InboxService } from "@server/api/v1/inbox/inbox.service"
import "reflect-metadata"
import { BoardsDetailService } from "@server/api/v1/boards/boards.detail.service"
import { RoomAccessService, type RoomAccessContext } from "@server/api/v1/rooms/room-access.service"
import { PrismaClient, type Entry } from "@prisma/client"
import { expect, it } from "vitest"
import { recentRoomMemberEntryIds, roomMemberEntryHistoryWhere } from "@server/api/v1/entries/room-entry-history"

it("selects independent Room history and current member entries without depending on source availability", async () => {
  const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] }), now = new Date(), rollback = new Error("Rollback member history")
  const captured: Array<{ query: string; params: string }> = []
  prisma.$on("query", event => { if (event.query.includes("CROSS JOIN LATERAL")) captured.push(event) })
  try {
    await prisma.$transaction(async tx => {
      const author = await tx.user.create({ data: { username: "Author", email: `${crypto.randomUUID()}@member-history.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { user_id: author.id, creation_origin: "project_material", status: "deleted", created_at: now, updated_at: now } })
      const copies: Entry[] = []
      for (let index = 0; index < 5; index++) copies.push(await tx.entry.create({ data: { user_id: author.id, room_id: room.id, source_entry_id: source.id, status: "published", created_at: now, updated_at: now, published_at: new Date(now.getTime() + index) } }))
      for (const data of [
        { source_entry_id: null, status: "published" },
        { source_entry_id: source.id, status: "draft" },
        { source_entry_id: source.id, status: "deleted" },
        { source_entry_id: source.id, status: "published", creation_origin: "chat_attachment" },
        { source_entry_id: source.id, status: "published", room_id: null },
      ]) await tx.entry.create({ data: { user_id: author.id, room_id: room.id, created_at: now, updated_at: now, published_at: new Date(now.getTime() + 100), ...data } })
      await tx.entry.createMany({ data: Array.from({ length: 500 }, (_, index) => ({
        user_id: author.id, room_id: room.id, source_entry_id: source.id, status: "published",
        created_at: now, updated_at: now, published_at: new Date(now.getTime() - index - 1),
      })) })
      await tx.$executeRaw`ANALYZE entries`
      const members = [{ roomId: room.id, userId: author.id }]
      expect(await recentRoomMemberEntryIds(tx, members, 3)).toEqual(copies.slice(-3).reverse().map(copy => copy.id))
      expect(await recentRoomMemberEntryIds(tx, [...members, ...members], 1)).toEqual([copies[4].id])
      const membership = await tx.roomMembership.create({ data: { user_id: author.id, room_id: room.id, created_at: now, updated_at: now } })
      const reader = await tx.user.create({ data: { username: "Reader", email: `${crypto.randomUUID()}@member-history.test`, created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { user_id: reader.id, room_id: room.id, created_at: now, updated_at: now } })
      const inbox = new InboxService()
      Object.assign(inbox, { prisma: tx })
      const access = { room: { ...room, porosity: "masked" }, kind: "visitor", source: "knock", membershipId: null, canManage: false, canCreateSideCircle: false, canViewNotes: false, canWriteWall: false, canParticipateActivities: false } satisfies RoomAccessContext
      const policy = new RoomAccessService()
      Object.assign(policy, { prisma: tx, require: async () => access })
      const home = new BoardsDetailService()
      Object.assign(home, { prisma: tx, circleAccess: policy, activityLifecycle: { reconcileCircle: async () => false } })
      const verifyVisible = async (id: number) => {
        const result = await home.fetchRoomHome(room.id, author.id)
        const tasks = (await inbox.inbox(reader.id)).respond
        expect(tasks.find(task => task.entryId === String(id))?.reasons).toContain("current work")
        expect(result.members).toHaveLength(1)
        expect(result.members[0]).toMatchObject({ membershipId: String(membership.id), userId: String(author.id), latestEntry: { id: String(id) } })
        expect(result.members[0].recentEntries!.map(post => post.id)).toEqual([String(id)])
        for (const copy of copies) expect(await policy.canReadPublishedPostWithRoomHistory(await tx.entry.findUniqueOrThrow({ where: { id: copy.id } }), access, tx)).toBe(copy.id === id)
      }
      await verifyVisible(copies[4].id)
      for (const audience of [
        { ...access, kind: "member" as const, canWriteWall: true },
        { ...access, room: { ...access.room, porosity: "open" as const } },
      ]) {
        Object.assign(policy, { require: async () => audience })
        const result = await home.fetchRoomHome(room.id, reader.id)
        expect(result.members[0].recentEntries!.map(post => post.id)).toEqual([String(copies[4].id)])
        expect(result.viewer_access.entry_history).toBe("all")
        expect(await policy.canReadPublishedPostWithRoomHistory(copies[0], audience, tx)).toBe(true)
      }
      Object.assign(policy, { require: async () => access })
      const statement = captured[0]
      const plan = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`EXPLAIN (FORMAT JSON) ${statement.query}`, ...JSON.parse(statement.params))
      expect(JSON.stringify(plan)).toContain('"Node Type":"Index Only Scan"')
      expect(JSON.stringify(plan)).toContain('"Node Type":"Limit"')
      const indexes = await tx.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='index_entries_on_room_member_history'`
      expect(indexes).toHaveLength(1)
      expect(indexes[0].indexdef).toContain("(room_id, user_id, published_at DESC, created_at DESC, id DESC)")
      const expected = copies.slice(-3).reverse().map(copy => copy.id)
      expect((await tx.entry.findMany({ where: roomMemberEntryHistoryWhere(room.id, author.id), orderBy: [{ published_at: "desc" }, { created_at: "desc" }, { id: "desc" }], take: 3 })).map(post => post.id)).toEqual(expected)
      expect(await policy.isCurrentPublishedPost(copies[4], tx)).toBe(true)
      const draft = await tx.entry.create({ data: { user_id: author.id, room_id: room.id, source_entry_id: source.id, status: "draft", created_at: now, updated_at: now } })
      const realAccess = new RoomAccessService(); Object.assign(realAccess, { prisma: tx })
      expect(await canManageEntryDraft(tx as unknown as PrismaService, realAccess, draft, author.id)).toBe(true)
      expect(await canManageEntryDraft(tx as unknown as PrismaService, realAccess, draft, reader.id)).toBe(false)
      await expect(assertRoomEntrySource(tx, draft)).rejects.toThrow("private source entry is unavailable")
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      expect(await canManageEntryDraft(tx as unknown as PrismaService, realAccess, draft, author.id)).toBe(false)
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: false } })
      const privateProject = await tx.project.create({ data: { owner_id: author.id, name: "Private", created_at: now, updated_at: now } })
      for (const invalid of [{ project_id: privateProject.id }]) {
        await tx.$executeRawUnsafe("SAVEPOINT invalid_provenance")
        await expect(tx.entry.update({ where: { id: copies[4].id }, data: invalid })).rejects.toThrow()
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_provenance")
      }
      expect(await recentRoomMemberEntryIds(tx, members, 3)).toEqual(expected)

      await tx.entry.update({ where: { id: copies[4].id }, data: { status: "deleted" } })
      expect(await recentRoomMemberEntryIds(tx, members, 1)).toEqual([copies[3].id])
      await verifyVisible(copies[3].id)
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
      expect((await home.fetchRoomHome(room.id, author.id)).members).toEqual([])
      expect(await policy.canReadPublishedPostWithRoomHistory(copies[3], access, tx)).toBe(false)
      expect(await recentRoomMemberEntryIds(tx, [], 3)).toEqual([])
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
