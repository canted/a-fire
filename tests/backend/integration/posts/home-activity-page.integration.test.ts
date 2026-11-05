import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { homeRoundPage } from "@server/api/v1/projects/home-activity-page"

it("pages private Home activity without duplicates and survives deletion of the cursor source", async () => {
  const prisma = new PrismaService(), rollback = new Error("Rollback Home feed")
  const at = new Date("2026-01-01T00:00:00Z"), now = new Date("2026-01-02T00:00:00Z")
  try {
    await expect(prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'America/Los_Angeles'`
      const user = await tx.user.create({ data: { username: "Feed", email: `${crypto.randomUUID()}@feed.test`, created_at: at, updated_at: at } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Feed", created_at: at, updated_at: at } })
      const posts = await tx.entry.createManyAndReturn({ data: Array.from({ length: 123 }, () => ({ user_id: user.id, project_id: project.id, status: "published", creation_origin: "project_material", created_at: at, updated_at: at, published_at: at })) })
      // More precision than JavaScript Date: cursor must retain the database value.
      await tx.$executeRaw`UPDATE entries SET published_at='2026-01-01 00:00:00.000001'::timestamp WHERE project_id=${project.id}`
      await tx.entry.update({ where: { id: posts[1].id }, data: { published_at: null } })
      const first = await homeRoundPage(tx, user.id, undefined, now)
      expect(first.items).toHaveLength(50)
      expect(first.items[0].id).toBe(posts.at(-1)!.id)
      expect(JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()).at).toBe("2026-01-01T00:00:00.000001Z")
      expect(first.nextCursor).toBeTypeOf("string")
      await tx.entry.delete({ where: { id: first.items.at(-1)!.id } })
      const second = await homeRoundPage(tx, user.id, first.nextCursor!, now)
      const third = await homeRoundPage(tx, user.id, second.nextCursor!, now)
      expect(second.items).toHaveLength(50)
      expect(third.items).toHaveLength(23)
      expect(third.nextCursor).toBeNull()
      expect(third.items.at(-1)?.id).toBe(posts[1].id)
      expect(new Set([...first.items, ...second.items, ...third.items].map(p => p.id)).size).toBe(123)
      const peer = await tx.user.create({ data: { username: "New owner", email: `${crypto.randomUUID()}@feed.test`, created_at: at, updated_at: at } })
      await tx.project.update({ where: { id: project.id }, data: { owner_id: peer.id } })
      expect(await homeRoundPage(tx, user.id, first.nextCursor!, now)).toEqual({ items: [], nextCursor: null })
      await expect(homeRoundPage(tx, user.id + 1, first.nextCursor!, now)).rejects.toThrow("Invalid Home activity cursor")
      await expect(homeRoundPage(tx, user.id, "malformed", now)).rejects.toThrow("Invalid Home activity cursor")
      throw rollback
    })).rejects.toBe(rollback)
  } finally { await prisma.$disconnect() }
})
