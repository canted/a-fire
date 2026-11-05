import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RoomRelationshipsService } from "@server/api/v1/rooms/room-relationships.service"
import { activeRoomVisit, grantRoomVisit, VISIT_INACTIVITY_MS } from "@server/api/v1/rooms/room-visit-lease"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("renews explicit activity, leaves reads inert, and requires fresh approval after inactivity", async () => {
  const prisma = new PrismaService()
  const rollback = new Error("Rollback lease fixtures")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const [owner, visitor] = await Promise.all(["owner", "visitor"].map(username => tx.user.create({ data: { username, email: `${crypto.randomUUID()}@visit.test`, created_at: now, updated_at: now } })))
      const parent = await tx.room.create({ data: { owner_id: owner.id, name: "Parent", porosity: "open", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { owner_id: owner.id, parent_id: parent.id, name: "Closed child", porosity: "closed", created_at: now, updated_at: now } })
      await tx.roomMembership.createMany({ data: [
        { room_id: parent.id, user_id: visitor.id },
        { room_id: room.id, user_id: owner.id },
      ].map(data => ({ ...data, created_at: now, updated_at: now })) })
      const knock = await tx.roomKnock.create({ data: { room_id: room.id, user_id: visitor.id, status: "pending", created_at: now, updated_at: now } })
      const scoped = Object.assign(Object.create(tx), { $transaction: (callback: (db: typeof tx) => unknown) => callback(tx) })
      const access = withTestDependencies(new RoomAccessService(), { prisma: scoped })
      const relationships = withTestDependencies(new RoomRelationshipsService(), { prisma: scoped, circleAccess: access })
      await relationships.reviewKnock(room.id, knock.id, owner.id, "admitted", now)
      const initial = await activeRoomVisit(tx, room.id, visitor.id, now)
      expect(initial?.expires_at.getTime()).toBe(now.getTime() + VISIT_INACTIVITY_MS)
      await access.resolve(room.id, visitor.id)
      expect(await activeRoomVisit(tx, room.id, visitor.id, now)).toEqual(initial)
      const later = new Date(now.getTime() + 23 * 60 * 60 * 1000)
      await expect(access.visit(room.id, visitor.id, later)).resolves.toMatchObject({ expires_at: new Date(later.getTime() + VISIT_INACTIVITY_MS).toISOString() })
      // A delayed older activity must not shorten the live lease.
      await access.visit(room.id, visitor.id, now)
      expect((await activeRoomVisit(tx, room.id, visitor.id, later))?.last_activity_at).toEqual(later)
      const expiry = new Date(later.getTime() + VISIT_INACTIVITY_MS)
      expect(await activeRoomVisit(tx, room.id, visitor.id, expiry)).toBeNull()
      expect(await access.resolve(room.id, visitor.id, expiry)).toBeNull()
      await expect(access.visit(room.id, visitor.id, expiry)).rejects.toThrow("Knock again")
      expect((await relationships.listAdjacentRooms(parent.id, visitor.id, expiry)).adjacent_rooms.find(child => child.id === room.id)?.actions).toMatchObject({ enter: false, knock: true })
      await expect(relationships.knock(room.id, visitor.id, expiry)).resolves.toEqual({ state: "requested" })
      expect((await tx.roomKnock.findUniqueOrThrow({ where: { id: knock.id } })).status).toBe("pending")
      await relationships.reviewKnock(room.id, knock.id, owner.id, "admitted", expiry)
      await expect(access.visit(room.id, visitor.id, expiry)).resolves.toMatchObject({ kind: "visitor" })
      const openRoom = await tx.room.create({ data: { owner_id: owner.id, parent_id: parent.id, name: "Open child", porosity: "open", created_at: now, updated_at: now } })
      expect(await access.resolve(openRoom.id, visitor.id, now)).toBeNull()
      await expect(access.visit(openRoom.id, visitor.id, now)).resolves.toMatchObject({ kind: "visitor" })
      expect(await access.resolve(openRoom.id, visitor.id, now)).toMatchObject({ kind: "visitor" })
      const openExpiry = new Date(now.getTime() + VISIT_INACTIVITY_MS)
      expect(await access.resolve(openRoom.id, visitor.id, openExpiry)).toBeNull()
      await expect(access.visit(openRoom.id, visitor.id, openExpiry)).resolves.toMatchObject({ kind: "visitor" })
      await tx.roomMembership.updateMany({ where: { room_id: parent.id, user_id: visitor.id }, data: { disabled: true } })
      await expect(access.visit(room.id, visitor.id, expiry)).rejects.toThrow("unavailable")
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})

it("retains one lease and the latest activity under concurrent grants", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { username: "Visitor", email: `${crypto.randomUUID()}@visit.test`, created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: user.id, name: "Room", created_at: now, updated_at: now } })
  try {
    const later = new Date(now.getTime() + 1000)
    await Promise.all([grantRoomVisit(prisma, room.id, user.id, "porosity", later), grantRoomVisit(prisma, room.id, user.id, "porosity", now)])
    expect(await prisma.roomVisit.count({ where: { room_id: room.id, user_id: user.id } })).toBe(1)
    expect(await activeRoomVisit(prisma, room.id, user.id, now)).toMatchObject({ last_activity_at: later, expires_at: new Date(later.getTime() + VISIT_INACTIVITY_MS) })
  } finally {
    await prisma.roomVisit.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
