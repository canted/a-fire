import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["opposite writer", "membership revocation"] as const)("orders a Room access set against an overlapping $0", async operation => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@access-set.test`, username: "Writer", created_at: now, updated_at: now } })
  const rooms = await prisma.room.createManyAndReturn({ data: ["First", "Second"].map(name => ({ name, created_at: now, updated_at: now })) })
  const ids = rooms.map(room => room.id).sort((a, b) => a - b)
  const access = withTestDependencies(new RoomAccessService(), { prisma })
  let release!: () => void, signal!: () => void, identify!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const locked = new Promise<void>(resolve => { signal = resolve })
  const waitingPid = new Promise<number>(resolve => { identify = resolve })
  let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined
  try {
    await prisma.roomMembership.createMany({ data: ids.map(community_id => ({ room_id: community_id, user_id: user.id, created_at: now, updated_at: now })) })
    first = prisma.$transaction(async tx => {
      const contexts = await access.requireAccessesInTransaction(tx, [...ids].reverse(), user.id, [ids[0]])
      expect([...contexts.keys()]).toEqual(ids)
      expect([...contexts.values()].map(context => context.kind)).toEqual(["member", "member"])
      // Existing destination authority may be reacquired without upgrading a shared lock.
      await access.requireMemberInTransaction(tx, ids[0], user.id)
      signal(); await gate
    })
    await Promise.race([locked, first])
    second = prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
      identify(row.pid)
      if (operation === "membership revocation") {
        await tx.roomMembership.updateMany({ where: { room_id: ids[1], user_id: user.id }, data: { disabled: true } })
      } else {
        await access.requireAccessesInTransaction(tx, ids, user.id, [ids[1]])
        await access.requireMemberInTransaction(tx, ids[1], user.id)
      }
    })
    const pid = await Promise.race([waitingPid, second.then(() => { throw new Error("Expected an overlapping transaction") })])
    await expect.poll(async () => {
      const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::integer)) > 0 AS blocked`
      return row.blocked
    }, { timeout: 2000 }).toBe(true)
    release()
    await Promise.all([first, second])
    if (operation === "membership revocation") await expect(prisma.$transaction(tx => access.requireAccessesInTransaction(tx, ids, user.id))).rejects.toThrow("Forbidden")
  } finally {
    release()
    await Promise.allSettled([first, second].filter(Boolean))
    await prisma.roomMembership.deleteMany({ where: { room_id: { in: ids } } })
    await prisma.room.deleteMany({ where: { id: { in: ids } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
