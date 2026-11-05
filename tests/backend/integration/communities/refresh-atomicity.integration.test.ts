import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("rolls back a failed successor write and allows one concurrent refresh rotation", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@refresh-atomic.test`, username: "User", created_at: now, updated_at: now } })
  try {
    const service = withTestDependencies(new AuthService(), { prisma })
    const token = await service.issueRefreshToken(user.id)
    const original = await prisma.oneTimeToken.findFirstOrThrow({ where: { token } })
    const failing = prisma.$extends({ query: { oneTimeToken: { async create({ args, query }) {
      await query(args)
      throw new Error("after successor insertion")
    } } } })
    await expect(withTestDependencies(new AuthService(), { prisma: failing }).rotateRefreshToken(token)).rejects.toThrow("after successor insertion")
    expect((await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: original.id } })).consumed_at).toBeNull()
    expect(await prisma.oneTimeToken.count({ where: { user_id: user.id } })).toBe(1)
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => service.rotateRefreshToken(token)))
    const successes = attempts.filter(result => result.status === "fulfilled")
    expect(successes).toHaveLength(1)
    if (successes[0].status !== "fulfilled") throw new Error("Missing refresh result")
    const next = successes[0].value
    expect(service.verifyAccessToken(next.accessToken).userId).toBe(user.id)
    expect(next.refreshToken).not.toBe(token)
    expect(await prisma.oneTimeToken.count({ where: { user_id: user.id, purpose: "refresh" } })).toBe(2)
    expect(await prisma.oneTimeToken.count({ where: { user_id: user.id, purpose: "refresh", consumed_at: null } })).toBe(1)
    await expect(service.rotateRefreshToken(token)).rejects.toThrow("Invalid token")
    await expect(service.rotateRefreshToken(next.refreshToken)).resolves.toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) })
    const invalid = await prisma.oneTimeToken.create({ data: { email: user.email, user_id: user.id, token: crypto.randomUUID(), purpose: "login", expires_at: new Date(now.getTime() + 60000), created_at: now, updated_at: now } })
    await expect(service.rotateRefreshToken(invalid.token)).rejects.toThrow("Invalid token")
    expect((await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: invalid.id } })).consumed_at).toBeNull()
    await prisma.oneTimeToken.update({ where: { id: invalid.id }, data: { purpose: "refresh", expires_at: new Date(0) } })
    await expect(service.rotateRefreshToken(invalid.token)).rejects.toThrow("Token expired")
    expect((await prisma.oneTimeToken.findUniqueOrThrow({ where: { id: invalid.id } })).consumed_at).toBeNull()
  } finally {
    await prisma.oneTimeToken.deleteMany({ where: { user_id: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
