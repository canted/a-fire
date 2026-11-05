import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { grantRoomVisit } from "@server/api/v1/rooms/room-visit-lease"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("holds visitor ancestry, admission and lease authority until the caller commits", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { username: "Visitor", email: `${crypto.randomUUID()}@access-lock.test`, created_at: now, updated_at: now } })
  const parent = await prisma.room.create({ data: { name: "Parent", porosity: "open", created_at: now, updated_at: now } })
  const child = await prisma.room.create({ data: { name: "Child", parent_id: parent.id, porosity: "closed", created_at: now, updated_at: now } })
  await prisma.roomMembership.create({ data: { room_id: parent.id, user_id: user.id, created_at: now, updated_at: now } })
  await prisma.roomKnock.create({ data: { room_id: child.id, user_id: user.id, status: "admitted", created_at: now, updated_at: now } })
  await grantRoomVisit(prisma, child.id, user.id, "knock", now)
  const access = withTestDependencies(new RoomAccessService(), { prisma })
  try {
    await prisma.$transaction(async tx => {
      expect(await access.requireAccessInTransaction(tx, child.id, user.id)).toMatchObject({ kind: "visitor", source: "knock" })
      for (const change of ["parent", "membership", "knock", "lease"]) {
        await expect(prisma.$transaction(async other => {
          await other.$executeRaw`SET LOCAL lock_timeout = '100ms'`
          if (change === "parent") await other.room.update({ where: { id: parent.id }, data: { deleted_at: now } })
          if (change === "membership") await other.roomMembership.updateMany({ where: { room_id: parent.id }, data: { disabled: true } })
          if (change === "knock") await other.roomKnock.updateMany({ where: { room_id: child.id }, data: { status: "pending" } })
          if (change === "lease") await other.roomVisit.updateMany({ where: { room_id: child.id }, data: { expires_at: now } })
        })).rejects.toThrow(/lock timeout/)
      }
    })
    await prisma.roomMembership.updateMany({ where: { room_id: parent.id }, data: { disabled: true } })
    await expect(prisma.$transaction(tx => access.requireAccessInTransaction(tx, child.id, user.id))).rejects.toThrow("Forbidden")
    // Independent child membership remains sufficient after parent access is lost.
    await prisma.roomMembership.create({ data: { room_id: child.id, user_id: user.id, created_at: now, updated_at: now } })
    await expect(prisma.$transaction(tx => access.requireAccessInTransaction(tx, child.id, user.id))).resolves.toMatchObject({ kind: "member" })
  } finally {
    await prisma.roomVisit.deleteMany({ where: { user_id: user.id } })
    await prisma.roomKnock.deleteMany({ where: { user_id: user.id } })
    await prisma.roomMembership.deleteMany({ where: { user_id: user.id } })
    await prisma.room.delete({ where: { id: child.id } })
    await prisma.room.delete({ where: { id: parent.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})

it("locks independent membership without ancestors and rejects revocation before lock acquisition", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { username: "Independent", email: `${crypto.randomUUID()}@access-anchor.test`, created_at: now, updated_at: now } })
  const parent = await prisma.room.create({ data: { name: "Parent", porosity: "open", created_at: now, updated_at: now } })
  const child = await prisma.room.create({ data: { name: "Child", parent_id: parent.id, porosity: "open", created_at: now, updated_at: now } })
  const access = withTestDependencies(new RoomAccessService(), { prisma })
  try {
    await prisma.roomMembership.createMany({ data: [parent, child].map(room => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
    await grantRoomVisit(prisma, child.id, user.id, "porosity", now)
    await prisma.$transaction(async tx => {
      await expect(access.requireAccessInTransaction(tx, child.id, user.id)).resolves.toMatchObject({ kind: "member" })
      // Parent changes are independent, while the actual membership stays locked.
      await prisma.$transaction(async other => {
        await other.$executeRaw`SET LOCAL lock_timeout = '100ms'`
        await other.room.update({ where: { id: parent.id }, data: { deleted_at: now } })
      })
      await expect(prisma.$transaction(async other => {
        await other.$executeRaw`SET LOCAL lock_timeout = '100ms'`
        await other.roomMembership.updateMany({ where: { room_id: child.id, user_id: user.id }, data: { disabled: true } })
      })).rejects.toThrow(/lock timeout/)
    })
    await prisma.room.update({ where: { id: parent.id }, data: { deleted_at: null } })
    let revoked = false
    await expect(prisma.$transaction(async tx => {
      const intercepted = new Proxy(tx, { get(target, key) {
        if (key !== "$queryRaw") return Reflect.get(target, key, target)
        return async (...args: Parameters<typeof tx.$queryRaw>) => {
          if (!revoked) {
            expect(String(args[0])).toContain("SELECT parent_id FROM rooms")
            revoked = true
            await prisma.roomMembership.updateMany({ where: { room_id: child.id, user_id: user.id }, data: { disabled: true } })
          }
          return tx.$queryRaw(...args)
        }
      } })
      return access.requireAccessInTransaction(intercepted, child.id, user.id)
    })).rejects.toThrow("Forbidden")
    expect(revoked).toBe(true)
    // A fresh request may discover and lock the now-required visitor ancestry.
    await expect(prisma.$transaction(tx => access.requireAccessInTransaction(tx, child.id, user.id))).resolves.toMatchObject({ kind: "visitor" })
  } finally {
    await prisma.roomVisit.deleteMany({ where: { user_id: user.id } })
    await prisma.roomMembership.deleteMany({ where: { user_id: user.id } })
    await prisma.room.delete({ where: { id: child.id } })
    await prisma.room.delete({ where: { id: parent.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
