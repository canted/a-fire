import "reflect-metadata"
import { expect, it } from "vitest"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("orders history reads against parent revocation using the canonical access locks", async () => {
  const prisma = new PrismaService(), now = new Date()
  const users = await Promise.all(["Host", "Visitor"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@history-race.test`, username, created_at: now, updated_at: now } })))
  const parent = await prisma.room.create({ data: { name: "Parent", porosity: "closed", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Child", parent_id: parent.id, porosity: "open", created_at: now, updated_at: now } })
  let release!: () => void, locked!: () => void, identify!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const accessLocked = new Promise<void>(resolve => { locked = resolve })
  const revokerPid = new Promise<number>(resolve => { identify = resolve })
  let reading: Promise<unknown> | undefined, revoking: Promise<unknown> | undefined
  try {
    const membership = await prisma.roomMembership.create({ data: { room_id: parent.id, user_id: users[1].id, created_at: now, updated_at: now } })
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: users[0].id, created_at: now, updated_at: now } })
    await prisma.roomVisit.create({ data: { room_id: room.id, user_id: users[1].id, source: "porosity", last_activity_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now } })
    const access = new RoomAccessService(); Object.assign(access, { prisma })
    const service = new RoundsService()
    Object.assign(service, { prisma, circleAccess: {
      async requireAccessInTransaction(tx: Prisma.TransactionClient, roomId: number, userId: number) {
        const result = await access.requireAccessInTransaction(tx, roomId, userId)
        locked(); await gate
        return result
      },
    } })
    reading = service.historyForRoom(room.id, users[1].id)
    await accessLocked
    revoking = prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      identify(row.pid)
      await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
    })
    const pid = await revokerPid
    await expect.poll(async () => {
      const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::integer)) > 0 AS blocked`
      return row.blocked
    }, { timeout: 2000 }).toBe(true)
    release()
    expect(await reading).toMatchObject({ items: [{ id: expect.stringMatching(/^member:/) }], nextCursor: null })
    await revoking
    await expect(service.historyForRoom(room.id, users[1].id)).rejects.toThrow("Forbidden")
  } finally {
    release()
    await Promise.allSettled([reading, revoking].filter(Boolean))
    await prisma.roomVisit.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: { in: [room.id, parent.id] } } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.room.delete({ where: { id: parent.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await prisma.$disconnect()
  }
})
