import { recentRoomMemberEntryIds } from "@server/api/v1/entries/room-entry-history"
import { InboxService } from "@server/api/v1/inbox/inbox.service"
import "reflect-metadata"
import { PrismaClient, type Entry } from "@prisma/client"
import { expect, it, vi } from "vitest"
import { RoomAccessService, type RoomAccessContext } from "@server/api/v1/rooms/room-access.service"
import { BoardsDetailService } from "@server/api/v1/boards/boards.detail.service"
import { RoomMemberProfilesService } from "@server/api/v1/rooms/room-member-profiles.service"

it("uses published order consistently for Room display, limited history and direct access", async () => {
  const prisma = new PrismaClient(), rollback = new Error("Rollback current selection"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Author", email: `${crypto.randomUUID()}@current-selection.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", porosity: "masked", created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { project_id: project.id, user_id: user.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
      const posts: Entry[] = []
      for (const [index, status] of ["published", "published", "draft", "deleted"].entries()) posts.push(await tx.entry.create({ data: {
        room_id: room.id, source_entry_id: source.id, user_id: user.id, status,
        created_at: new Date(now.getTime() + index), published_at: new Date(now.getTime() + index), updated_at: now,
      } }))
      const reader = await tx.user.create({ data: { username: "Reader", email: `${crypto.randomUUID()}@current-selection.test`, created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: reader.id, created_at: now, updated_at: now } })
      const differentRoom = await tx.room.create({ data: { name: "Different Room", created_at: now, updated_at: now } })
      const excludedRecords: Array<{ id: number }> = []
      for (const data of [
        { room_id: room.id, user_id: user.id, creation_origin: "chat_attachment" },
        { room_id: differentRoom.id, user_id: user.id, source_entry_id: source.id },
      ]) excludedRecords.push(await tx.entry.create({ data: { ...data, status: "published", published_at: new Date(now.getTime() + 100), created_at: now, updated_at: now } }))
      excludedRecords.push(source)
      const unpositioned = await tx.user.create({ data: { username: "No position", email: `${crypto.randomUUID()}@current-selection.test`, created_at: now, updated_at: now } })
      const unpositionedMembership = await tx.roomMembership.create({ data: { room_id: room.id, user_id: unpositioned.id, created_at: now, updated_at: now } })
      const inbox = new InboxService()
      Object.assign(inbox, { prisma: tx })
      const access: RoomAccessContext = { room: { ...room, porosity: "masked" }, kind: "visitor", source: "porosity", membershipId: null, canManage: false, canCreateSideCircle: false, canViewNotes: false, canWriteWall: false, canParticipateActivities: false }
      const policy = new RoomAccessService()
      Object.assign(policy, { prisma: tx, require: async () => access })
      const boardService = new BoardsDetailService()
      Object.assign(boardService, { prisma: tx, circleAccess: policy, activityLifecycle: { reconcileBoard: async () => false, reconcileCircle: async () => false } })
      const history = new RoomMemberProfilesService()
      Object.assign(history, { prisma: tx, circleAccess: policy })
      const verify = async (expected: number, excluded: number) => {
        expect((await recentRoomMemberEntryIds(tx, [{ roomId: room.id, userId: user.id }], 1))[0] ?? null).toBe(expected)
        const tasks = (await inbox.inbox(reader.id)).respond
        expect(tasks.find(task => task.entryId === String(expected))?.reasons).toContain("current work")
        expect(tasks.find(task => task.entryId === String(excluded))?.reasons ?? []).not.toContain("current work")
        for (const porosity of ["masked", "closed"] as const) {
          access.room.porosity = porosity
          await expect(history.fetchRoomMemberPosts(room.id, reader.id, user.id, 1)).rejects.toThrow("Not Found")
          const result = await boardService.fetchRoomHome(room.id, user.id)
          expect(result.members.map(member => member.username)).toEqual(["Author"])
          expect(result.members[0].latestEntry?.id).toBe(String(expected))
        }
        access.room.porosity = "open"
        expect((await history.fetchRoomMemberPosts(room.id, reader.id, user.id, 1)).entries).toEqual([])
        const open = await boardService.fetchRoomHome(room.id, user.id)
        expect(open.members.map(member => member.username).sort()).toEqual(["Author", "No position", "Reader"])
        expect(open.members.find(member => member.userId === String(unpositioned.id))).toEqual({ membershipId: String(unpositionedMembership.id), userId: String(unpositioned.id), username: "No position", avatarUrl: null, latestEntry: null, recentEntries: [] })
        access.room.porosity = "masked"
        expect((await history.fetchRoomMemberPosts(room.id, user.id, user.id, 1)).entries.map(post => post.id)).toEqual([String(expected)])
        for (const id of [expected, excluded, ...excludedRecords.map(post => post.id)]) {
          const post = await tx.entry.findUniqueOrThrow({ where: { id } })
          expect(await policy.canReadPublishedPostWithRoomHistory(post, access, tx)).toBe(id === expected)
        }
      }
      await verify(posts[1].id, posts[0].id)
      await tx.entry.update({ where: { id: posts[1].id }, data: { status: "deleted" } })
      await verify(posts[0].id, posts[1].id)
      const originalFind = tx.entry.findFirst.bind(tx.entry)
      const hydration = vi.spyOn(tx.entry, "findFirst").mockImplementationOnce((async (args: Parameters<typeof originalFind>[0]) => {
        await tx.entry.update({ where: { id: posts[0].id }, data: { status: "deleted" } })
        return originalFind(args)
      }) as typeof originalFind)
      try {
        await expect(history.fetchRoomMemberPosts(room.id, user.id, user.id, 1)).rejects.toThrow("Not Found")
        expect(hydration).toHaveBeenCalledTimes(1)
      } finally { hydration.mockRestore() }
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
