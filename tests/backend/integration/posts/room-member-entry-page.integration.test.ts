import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { roomMemberEntryPage } from "@server/api/v1/entries/room-member-entry-page"
import { roomMemberEntryHistoryWhere } from "@server/api/v1/entries/room-entry-history"

it("continues Room history across null dates, microsecond ties and deleted anchors without scope reuse", async () => {
  const prisma = new PrismaClient(), now = new Date(), rollback = new Error("rollback cursor fixture")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@room-page.test`, username: "Author", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "History", created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Private source", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { project_id: project.id, user_id: user.id, status: "published", creation_origin: "project_material", created_at: now, updated_at: now } })
      const entries = await tx.entry.createManyAndReturn({ data: Array.from({ length: 45 }, (_, index) => ({ user_id: user.id, room_id: room.id, source_entry_id: source.id, status: "published", published_at: index < 22 ? null : now, created_at: now, updated_at: now })) })
      for (const [index, entry] of entries.entries()) await tx.$executeRaw`UPDATE entries SET created_at=${now}::timestamp + ${index} * interval '1 microsecond' WHERE id=${entry.id}`
      const expected = await tx.entry.findMany({ where: roomMemberEntryHistoryWhere(room.id, user.id), orderBy: [{ published_at: "desc" }, { created_at: "desc" }, { id: "desc" }], select: { id: true } })
      expect(expected).toHaveLength(45)
      const first = await roomMemberEntryPage(tx, room.id, user.id, user.id)
      expect(first.ids).toEqual(expected.slice(0, 20).map(row => row.id))
      expect(first.nextCursor).not.toBeNull()
      await tx.entry.delete({ where: { id: first.ids.at(-1)! } })
      const second = await roomMemberEntryPage(tx, room.id, user.id, user.id, first.nextCursor!)
      expect(second.ids).toEqual(expected.slice(20, 40).map(row => row.id))
      const third = await roomMemberEntryPage(tx, room.id, user.id, user.id, second.nextCursor!)
      expect(third.ids).toEqual(expected.slice(40).map(row => row.id))
      expect(third.nextCursor).toBeNull()
      for (const scope of [[room.id + 1, user.id, user.id], [room.id, user.id + 1, user.id], [room.id, user.id, user.id + 1]]) {
        await expect(roomMemberEntryPage(tx, scope[0], scope[1], scope[2], first.nextCursor!)).rejects.toThrow("Invalid Room history cursor")
      }
      await expect(roomMemberEntryPage(tx, room.id, user.id, user.id, "invalid")).rejects.toThrow("Invalid Room history cursor")
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
