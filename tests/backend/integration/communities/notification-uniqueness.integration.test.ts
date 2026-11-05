import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"

it("rejects duplicate scoped and Global preferences while allowing distinct scope types", async () => {
  const prisma = new PrismaClient()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@preference.test`, username: "Preference", created_at: now, updated_at: now } })
  try {
    const base = { user_id: user.id, created_at: now, updated_at: now }
    for (const scope of [{ scope_type: "Global", scope_id: null }, { scope_type: "Circle", scope_id: 42 }, { scope_type: "Post", scope_id: 42 }]) {
      await prisma.notificationPreference.create({ data: { ...base, ...scope } })
      await expect(prisma.notificationPreference.create({ data: { ...base, ...scope } })).rejects.toMatchObject({ code: "P2002" })
    }
    expect(await prisma.notificationPreference.count({ where: { user_id: user.id } })).toBe(3)
  } finally {
    await prisma.notificationPreference.deleteMany({ where: { user_id: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})
