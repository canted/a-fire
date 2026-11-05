import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RoomRelationshipsService } from "@server/api/v1/rooms/room-relationships.service"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("atomically reviews join requests with durable notifications and idempotent retries", async () => {
  const prisma = new PrismaService()
  const boss = new BossService()
  await boss.start()
  const now = new Date()
  const users = await Promise.all(["Owner", "Requester"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@join-atomic.test`, username, created_at: now, updated_at: now } })))
  const [owner, target] = users
  const room = await prisma.room.create({ data: { name: "Room", owner_id: owner.id, created_at: now, updated_at: now } })
  const jobIds: string[] = []
  const persistJob = boss.enqueueInTransaction.bind(boss)
  let fail = true
  const enqueue = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
    const id = await persistJob(...args)
    jobIds.push(id)
    if (fail) throw new Error("after queue insertion")
    return id
  })
  try {
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: owner.id, created_at: now, updated_at: now } })
    const request = await prisma.roomJoinRequest.create({ data: { room_id: room.id, user_id: target.id, status: "pending", created_at: now, updated_at: now } })
    const circleAccess = withTestDependencies(new RoomAccessService(), { prisma })
    const service = withTestDependencies(new RoomRelationshipsService(), { prisma, circleAccess, boss })
    await expect(service.reviewJoinRequest(room.id, request.id, owner.id, "approved")).rejects.toThrow("after queue insertion")
    expect(await prisma.roomMembership.count({ where: { room_id: room.id, user_id: target.id } })).toBe(0)
    expect((await prisma.roomJoinRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("pending")
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(0)
    for (const id of jobIds) expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${id}::uuid`).toEqual([])
    fail = false
    enqueue.mockClear()
    await Promise.all(Array.from({ length: 5 }, () => service.reviewJoinRequest(room.id, request.id, owner.id, "approved")))
    expect(await prisma.roomMembership.count({ where: { room_id: room.id, user_id: target.id, disabled: false } })).toBe(1)
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${jobIds.at(-1)!}::uuid`).toHaveLength(1)
    const failing = prisma.$extends({ query: { roomJoinRequest: { async update() { throw new Error("review write failed") } } } })
    const failingService = withTestDependencies(new RoomRelationshipsService(), { prisma: failing, circleAccess, boss })
    await expect(failingService.reviewJoinRequest(room.id, request.id, owner.id, "declined")).rejects.toThrow("review write failed")
    expect(await prisma.roomMembership.count({ where: { room_id: room.id, user_id: target.id, disabled: false } })).toBe(1)
    expect((await prisma.roomJoinRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("approved")
    await service.reviewJoinRequest(room.id, request.id, owner.id, "declined")
    expect(await prisma.roomMembership.count({ where: { room_id: room.id, user_id: target.id, disabled: false } })).toBe(0)
    await service.reviewJoinRequest(room.id, request.id, owner.id, "approved")
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(2)
    const membership = await prisma.roomMembership.findFirstOrThrow({ where: { room_id: room.id, user_id: target.id } })
    await withTestDependencies(new RoomsService(), { prisma }).removeMember(room.id, owner.id, membership.id)
    await service.reviewJoinRequest(room.id, request.id, owner.id, "approved")
    expect((await prisma.roomMembership.findUniqueOrThrow({ where: { id: membership.id } })).disabled).toBe(true)
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(2)
  } finally {
    enqueue.mockRestore()
    for (const id of jobIds) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.notificationEvent.deleteMany({ where: { room_id: room.id } })
    await prisma.roomJoinRequest.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await boss.onModuleDestroy()
    await prisma.$disconnect()
  }
})

it("rolls back invitation creation and reissue when durable notification insertion fails", async () => {
  const prisma = new PrismaService()
  const boss = new BossService()
  await boss.start()
  const now = new Date()
  const users = await Promise.all(["Inviter", "Recipient"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@invitation-outbox.test`, username, created_at: now, updated_at: now } })))
  const [owner, target] = users
  const parent = await prisma.room.create({ data: { name: "Parent", owner_id: owner.id, created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Child", parent_id: parent.id, porosity: "closed", owner_id: owner.id, created_at: now, updated_at: now } })
  const jobs: string[] = []
  const persist = boss.enqueueInTransaction.bind(boss)
  let fail = true
  const enqueue = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
    const id = await persist(...args)
    jobs.push(id)
    if (fail) throw new Error("after invitation job insertion")
    return id
  })
  try {
    await prisma.roomMembership.createMany({ data: [
      { room_id: parent.id, user_id: owner.id, created_at: now, updated_at: now },
      { room_id: parent.id, user_id: target.id, created_at: now, updated_at: now },
      { room_id: room.id, user_id: owner.id, created_at: now, updated_at: now },
    ] })
    const circleAccess = withTestDependencies(new RoomAccessService(), { prisma })
    const service = withTestDependencies(new RoomRelationshipsService(), { prisma, circleAccess, boss })
    await expect(service.inviteExistingUser(room.id, target.id, owner.id)).rejects.toThrow("after invitation job insertion")
    expect(await prisma.roomMemberInvitation.count({ where: { room_id: room.id } })).toBe(0)
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(0)
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${jobs[0]}::uuid`).toEqual([])
    fail = false
    const { invitation } = await service.inviteExistingUser(room.id, target.id, owner.id)
    const saved = await prisma.roomMemberInvitation.findFirstOrThrow({ where: { room_id: room.id } })
    await prisma.roomMemberInvitation.update({ where: { id: saved.id }, data: { status: "declined", responded_at: now } })
    fail = true
    await expect(service.inviteExistingUser(room.id, target.id, owner.id)).rejects.toThrow("after invitation job insertion")
    expect(await prisma.roomMemberInvitation.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ status: "declined", responded_at: now })
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(1)
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${jobs.at(-1)!}::uuid`).toEqual([])
    expect(invitation).toMatchObject({ status: "pending" })
    fail = false
    await service.inviteExistingUser(room.id, target.id, owner.id)
    expect(await prisma.roomMemberInvitation.count({ where: { room_id: room.id, status: "pending" } })).toBe(1)
    expect(await prisma.notificationEvent.count({ where: { room_id: room.id } })).toBe(2)
    expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${jobs.at(-1)!}::uuid`).toHaveLength(1)
  } finally {
    enqueue.mockRestore()
    for (const id of jobs) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.notificationEvent.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMemberInvitation.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: { in: [room.id, parent.id] } } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.room.delete({ where: { id: parent.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await boss.onModuleDestroy()
    await prisma.$disconnect()
  }
})
