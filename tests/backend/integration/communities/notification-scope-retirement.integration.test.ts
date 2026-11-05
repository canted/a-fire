import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it.each(["Board", "Square", "unknown"])("rejects %s notification scopes in the final schema", async scope => {
  const prisma = new PrismaClient(), rollback = new Error("rollback scope fixture"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: `${crypto.randomUUID()}@scope.test`, username: "Scope", created_at: now, updated_at: now } })
      await tx.$executeRawUnsafe("SAVEPOINT invalid_scope")
      await expect(tx.$executeRaw`INSERT INTO notification_preferences(user_id,scope_type,scope_id,created_at,updated_at) VALUES (${user.id},${scope},42,now(),now())`).rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } })
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_scope")
      expect(await tx.notificationPreference.count({ where: { user_id: user.id } })).toBe(0)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
