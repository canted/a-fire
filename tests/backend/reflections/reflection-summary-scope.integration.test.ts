import "reflect-metadata"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { ReflectionsService } from "@server/api/v1/reflections/reflections.service"

it("does not expose historical cross-Room Note titles in source reflection summaries", async () => {
  const prisma = new PrismaClient(), now = new Date(), rollback = new Error("rollback reflection summaries")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@reflection-scope.test`, username: "Member", created_at: now, updated_at: now } })
      const rooms = await tx.room.createManyAndReturn({ data: ["Source", "Other"].map(name => ({ name, created_at: now, updated_at: now })) })
      await tx.roomMembership.create({ data: { user_id: user.id, room_id: rooms[0].id, created_at: now, updated_at: now } })
      const notes = await tx.page.createManyAndReturn({ data: [
        { title: "Visible", room_id: rooms[0].id },
        { title: "Private other Room", room_id: rooms[1].id },
        { title: "Deleted", room_id: rooms[0].id, deleted_at: now },
        { title: "Unscoped history", room_id: null },
      ].map(data => ({ ...data, created_at: now, updated_at: now })) })
      await tx.reflection.createMany({ data: notes.map(page => ({ page_id: page.id, reflectable_type: "Post", reflectable_id: 42, user_id: user.id, created_at: now, updated_at: now })) })
      const service = new ReflectionsService()
      Object.assign(service, { prisma: tx })
      const read = () => (service as any).listForReflectable("Post", 42, user.id, rooms[0].id)
      expect((await read()).map((row: { page_title: string }) => row.page_title)).toEqual(["Visible"])
      await tx.page.update({ where: { id: notes[0].id }, data: { room_id: rooms[1].id } })
      expect(await read()).toEqual([])
      expect(await tx.reflection.count({ where: { page_id: { in: notes.map(note => note.id) } } })).toBe(4)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
