import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["login", "invite"])("atomically consumes a %s code once and rolls back failures", async purpose => {
  const prisma = new PrismaService()
  const now = new Date(), expires = new Date(now.getTime() + 60000)
  const email = `${crypto.randomUUID()}@otp-atomic.test`
  const existing = purpose === "login" ? await prisma.user.create({ data: { email, username: "User", created_at: now, updated_at: now } }) : null
  const sender = existing ?? await prisma.user.create({ data: { email: `${crypto.randomUUID()}@otp-sender.test`, username: "Sender", created_at: now, updated_at: now } })
  const invite = purpose === "invite" ? await prisma.invite.create({ data: { email, invited_by_id: sender.id, invite_type: 1, token: crypto.randomUUID(), expires_at: expires, created_at: now, updated_at: now } }) : null
  const olderCode = await prisma.oneTimeToken.create({ data: { email, token: "123456", user_id: existing?.id, invite_id: invite?.id, purpose, expires_at: expires, created_at: now, updated_at: now } })
  const code = await prisma.oneTimeToken.create({ data: { email, token: "123456", user_id: existing?.id, invite_id: invite?.id, purpose, expires_at: expires, created_at: now, updated_at: now } })
  try {
    const failing = prisma.$extends({ query: { oneTimeToken: { async update({ args, query }) {
      await query(args)
      throw new Error("after code consumption")
    } } } })
    await expect(withTestDependencies(new AuthService(), { prisma: failing }).verifyOtp(email, code.token)).rejects.toThrow("after code consumption")
    expect(await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({ consumed_at: null, attempt_count: 0 })
    if (!existing) expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    const auth = withTestDependencies(new AuthService(), { prisma })
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => auth.verifyOtp(email, code.token)))
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1)
    expect((await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: olderCode.id } })).consumed_at).toBeNull()
    await expect(auth.verifyOtp(email, code.token)).rejects.toThrow("Invalid or expired code")
    expect(await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({ consumed_at: expect.any(Date), attempt_count: 1 })
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    if (invite) expect((await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).used_at).toBeNull()
    const refresh = await prisma.oneTimeToken.create({ data: { email, token: crypto.randomUUID(), user_id: user.id, purpose: "refresh", expires_at: expires, created_at: now, updated_at: now } })
    await expect(auth.verifyOtp(email, refresh.token)).rejects.toThrow("Invalid or expired code")
    expect((await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: refresh.id } })).consumed_at).toBeNull()
  } finally {
    await prisma.oneTimeToken.deleteMany({ where: { email } })
    if (invite) await prisma.invite.delete({ where: { id: invite.id } })
    await prisma.user.deleteMany({ where: { OR: [{ email }, { id: sender.id }] } })
    await prisma.$disconnect()
  }
})

it.each(["expiry", "deletion", "email mismatch", "used", "valid"])("checks invited Room context: %s", async change => {
  const prisma = new PrismaService()
  const now = new Date(), expires = new Date(now.getTime() + 60000)
  const email = `${crypto.randomUUID()}@otp-room.test`
  const owner = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@otp-owner.test`, username: "Owner", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { owner_id: owner.id, name: "Room", created_at: now, updated_at: now } })
  const invite = await prisma.invite.create({ data: { email: change === "email mismatch" ? `other-${email}` : email, room_id: room.id, invited_by_id: owner.id, invite_type: 0, token: crypto.randomUUID(), expires_at: expires, created_at: now, updated_at: now } })
  const code = await prisma.oneTimeToken.create({ data: { email, token: "123456", invite_id: invite.id, purpose: "invite", expires_at: expires, created_at: now, updated_at: now } })
  try {
    let changed = false
    const database = prisma.$extends({ query: { invite: { async findUnique({ args, query }) {
      const result = await query(args)
      if (!changed) {
        changed = true
        if (change === "expiry") await prisma.invite.update({ where: { id: invite.id }, data: { expires_at: new Date(0) } })
        if (change === "used") await prisma.invite.update({ where: { id: invite.id }, data: { used_at: new Date() } })
        if (change === "deletion") await withTestDependencies(new RoomsService(), { prisma }).deleteRoom(room.id, owner.id)
      }
      return result
    } } } })
    const verification = withTestDependencies(new AuthService(), { prisma: database }).verifyOtp(email, code.token)
    if (change === "valid") {
      await expect(verification).resolves.toMatchObject({ redirect: "/app" })
      expect((await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: code.id } })).consumed_at).not.toBeNull()
      expect(await prisma.user.count({ where: { email } })).toBe(1)
      expect(await prisma.roomMembership.count({ where: { room_id: room.id } })).toBe(0)
    } else {
      await expect(verification).rejects.toThrow(change === "deletion" ? "Community not found" : "Invalid or expired invitation")
      expect(await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({ consumed_at: null, attempt_count: 0 })
      expect(await prisma.user.count({ where: { email: { in: [email, invite.email] } } })).toBe(0)
    }

  } finally {
    await prisma.oneTimeToken.delete({ where: { id: code.id } })
    await prisma.invite.delete({ where: { id: invite.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { OR: [{ id: owner.id }, { email }] } })
    await prisma.$disconnect()
  }
})
