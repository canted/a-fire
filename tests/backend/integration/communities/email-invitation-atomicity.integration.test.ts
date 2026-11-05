import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each([
  { failure: "consumption", inviteType: 0 },
  { failure: "consumption", inviteType: 1 },
  { failure: "expiry", inviteType: 0 },
  { failure: "deletion", inviteType: 0 },
])("preserves atomic email admission on $failure for invite type $inviteType", async ({ failure, inviteType }) => {
  const prisma = new PrismaService()
  const now = new Date()
  const email = `${crypto.randomUUID()}@email-admission.test`
  const owner = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@email-owner.test`, username: "Owner", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: owner.id, name: "Room", created_at: now, updated_at: now } })
  const invite = await prisma.invite.create({ data: { email, token: crypto.randomUUID(), invite_type: inviteType, room_id: inviteType === 0 ? room.id : null, invited_by_id: owner.id, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })
  try {
    let changed = false
    const extended = prisma.$extends({ query: { invite: {
      async findFirst({ args, query }) {
        const result = await query(args)
        if (!changed && !args.where?.id && failure !== "consumption") {
          changed = true
          if (failure === "expiry") await prisma.invite.update({ where: { id: invite.id }, data: { expires_at: new Date(0) } })
          else await withTestDependencies(new RoomsService(), { prisma }).deleteRoom(room.id, owner.id)
        }
        return result
      },
      async update({ args, query }) {
        const result = await query(args)
        if (failure === "consumption") throw new Error("after invitation consumption")
        return result
      },
    } } })
    const failing = withTestDependencies(new AuthService(), { prisma: extended })
    await expect(failing.acceptInvite(invite.token)).rejects.toThrow(failure === "consumption" ? "after invitation consumption" : failure === "expiry" ? "expired" : "Community not found")
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    expect(await prisma.roomMembership.count({ where: { room_id: room.id } })).toBe(0)
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).used_at).toBeNull()
    if (failure === "consumption") {
      const service = withTestDependencies(new AuthService(), { prisma })
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => service.acceptInvite(invite.token)))
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
      const recipient = await prisma.user.findUniqueOrThrow({ where: { email } })
      expect((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).used_at).not.toBeNull()
      expect(await prisma.roomMembership.count({ where: { room_id: room.id, user_id: recipient.id } })).toBe(inviteType === 0 ? 1 : 0)
      await expect(service.acceptInvite(invite.token, recipient.id)).resolves.toMatchObject({ success: true, userId: recipient.id })
      await expect(service.acceptInvite(invite.token, owner.id)).rejects.toThrow("already been used")
    }
  } finally {
    await prisma.invite.delete({ where: { id: invite.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { OR: [{ id: owner.id }, { email }] } })
    await prisma.$disconnect()
  }
})

it("serializes first-account creation across distinct invitations for the same email", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const email = `${crypto.randomUUID()}@parallel-invites.test`
  const owner = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@parallel-owner.test`, username: "Owner", created_at: now, updated_at: now } })
  const invites = await Promise.all([0, 1].map(() => prisma.invite.create({ data: { email, token: crypto.randomUUID(), invite_type: 1, invited_by_id: owner.id, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })))
  try {
    let arrivals = 0
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const extended = prisma.$extends({ query: { user: { async findFirst({ args, query }) {
      const result = await query(args)
      if (args.where?.email === email && !result && arrivals < 2) {
        arrivals++
        if (arrivals === 2) release()
        await barrier
      }
      return result
    } } } })
    const service = withTestDependencies(new AuthService(), { prisma: extended })
    const results = await Promise.allSettled(invites.map(invite => service.acceptInvite(invite.token)))
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult
    expect(rejected.reason.message).toContain("Sign in with the email")
    expect(await prisma.user.count({ where: { email } })).toBe(1)
    expect(await prisma.invite.count({ where: { id: { in: invites.map(invite => invite.id) }, used_at: { not: null } } })).toBe(1)
    const recipient = await prisma.user.findUniqueOrThrow({ where: { email } })
    const unused = await prisma.invite.findFirstOrThrow({ where: { id: { in: invites.map(invite => invite.id) }, used_at: null } })
    await expect(service.acceptInvite(unused.token, recipient.id)).resolves.toMatchObject({ success: true, userId: recipient.id })
    expect(await prisma.user.count({ where: { email } })).toBe(1)
  } finally {
    await prisma.invite.deleteMany({ where: { id: { in: invites.map(invite => invite.id) } } })
    await prisma.user.deleteMany({ where: { OR: [{ id: owner.id }, { email }] } })
    await prisma.$disconnect()
  }
})
