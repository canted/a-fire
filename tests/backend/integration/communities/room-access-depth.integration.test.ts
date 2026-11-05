import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("bounds ancestor-dependent read and admission checks at the existing transaction limit", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback depth fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@room-depth.test`, username: "Visitor", created_at: now, updated_at: now } })
      const rooms: number[] = []
      for (let depth = 0; depth < 129; depth++) {
        const room = await tx.room.create({ data: { name: "Nested", parent_id: rooms.at(-1), porosity: "open", created_at: now, updated_at: now } })
        rooms.push(room.id)
      }
      await tx.roomMembership.create({ data: { room_id: rooms[0], user_id: user.id, created_at: now, updated_at: now } })
      await tx.roomVisit.createMany({ data: rooms.slice(1).map(room_id => ({ room_id, user_id: user.id, source: "porosity", last_activity_at: now, expires_at: new Date(now.getTime() + 86400000) })) })
      const service = new RoomAccessService(); Object.assign(service, { prisma: tx })
      const reads = vi.spyOn(tx.room, "findUnique")
      try {
        await expect(service.resolve(rooms[127], user.id, now)).resolves.toMatchObject({ kind: "visitor" })
        expect(reads).toHaveBeenCalledTimes(128)
        await expect(service.requireAccessInTransaction(tx, rooms[127], user.id)).resolves.toMatchObject({ kind: "visitor" })
        reads.mockClear()
        await expect(service.resolve(rooms[128], user.id, now)).resolves.toBeNull()
        expect(reads).toHaveBeenCalledTimes(128)
        reads.mockClear()
        await expect(service.resolveAdmission(rooms[128], user.id, now)).resolves.toBeNull()
        expect(reads).toHaveBeenCalledTimes(128)
        await expect(service.requireAccessInTransaction(tx, rooms[128], user.id)).rejects.toThrow("Invalid Room access path")
        // Independent membership must not require a readable parent path.
        await tx.roomMembership.create({ data: { room_id: rooms[128], user_id: user.id, created_at: now, updated_at: now } })
        reads.mockClear()
        await expect(service.resolve(rooms[128], user.id, now)).resolves.toMatchObject({ kind: "member" })
        expect(reads).toHaveBeenCalledOnce()
        reads.mockClear()
        await expect(service.requireAccessInTransaction(tx, rooms[128], user.id)).resolves.toMatchObject({ kind: "member" })
        expect(reads).toHaveBeenCalledTimes(2)
      } finally { reads.mockRestore() }
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
