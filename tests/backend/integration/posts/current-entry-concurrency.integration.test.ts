import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { recentRoomMemberEntryIds } from "@server/api/v1/entries/room-entry-history"

it("derives the eligible fallback without changing the private source when publication races withdrawal of a newer Entry", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@projection.test`, username: "Projection", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Projection", created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
  const source = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
  const postIds: number[] = []
  try {
    const older = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, source_entry_id: source.id, status: "draft", created_at: now, updated_at: now } })
    postIds.push(older.id)
    const later = new Date(now.getTime() + 1000)
    const newer = await prisma.entry.create({ data: { user_id: user.id, room_id: room.id, source_entry_id: source.id, status: "published", published_at: later, created_at: later, updated_at: later } })
    postIds.push(newer.id)
    let arrivals = 0
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const synchronize = async () => {
      if (++arrivals === 2) release()
      await barrier
    }
    await Promise.all([
      prisma.$transaction(async tx => {
        await tx.entry.update({ where: { id: older.id }, data: { status: "published", published_at: now } })
        await synchronize()
      }),
      prisma.$transaction(async tx => {
        await tx.entry.update({ where: { id: newer.id }, data: { status: "deleted" } })
        await synchronize()
      }),
    ])
    expect((await recentRoomMemberEntryIds(prisma, [{ roomId: room.id, userId: user.id }], 1))[0] ?? null).toBe(older.id)
    await prisma.$transaction(async tx => {
      await tx.entry.update({ where: { id: older.id }, data: { status: "deleted" } })
      expect((await recentRoomMemberEntryIds(tx, [{ roomId: room.id, userId: user.id }], 1))[0] ?? null).toBeNull()
    })
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source)
  } finally {
    await prisma.entry.deleteMany({ where: { id: { in: postIds } } })
    await prisma.entry.delete({ where: { id: source.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
