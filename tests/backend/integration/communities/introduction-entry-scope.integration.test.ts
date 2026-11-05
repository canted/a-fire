import "reflect-metadata"
import { expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "@server/prisma/prisma.service"
import { IntroductionsService } from "@server/api/v1/introductions/introductions.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("rejects other-Room and private Entry context before allocating introductions", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback introduction scope fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await tx.user.createManyAndReturn({ data: Array.from({ length: 3 }, () => ({ email: `${crypto.randomUUID()}@introduction-scope.test`, username: "Fixture", created_at: now, updated_at: now })) })
      const rooms = await tx.room.createManyAndReturn({ data: ["Target", "Other"].map(name => ({ name, created_at: now, updated_at: now })) })
      await tx.roomMembership.createMany({ data: users.map(user => ({ room_id: rooms[0].id, user_id: user.id, created_at: now, updated_at: now })) })
      const project = await tx.project.create({ data: { name: "Private", owner_id: users[0].id, created_at: now, updated_at: now } })
      const enqueueInTransaction = vi.fn()
      const service = withTestDependencies(new IntroductionsService(), {
        prisma: { $transaction: (operation: (database: Prisma.TransactionClient) => Promise<unknown>) => operation(tx) },
        boss: { enqueueInTransaction },
      })
      for (const extra of [{ room_id: rooms[1].id }, { room_id: null, project_id: project.id, creation_origin: "project_material" }]) {
        const post = await tx.entry.create({ data: { ...extra, user_id: users[0].id, status: "published", created_at: now, updated_at: now, published_at: now } })
        await expect(service.create(users[0].id, { room_id: rooms[0].id, recipient_user_ids: users.slice(1).map(user => user.id), note: "Shared interests", entry_id: post.id })).rejects.toThrow("Post context must belong to this circle")
        expect(await tx.introduction.count({ where: { room_id: rooms[0].id } })).toBe(0)
        expect(await tx.notificationEvent.count({ where: { room_id: rooms[0].id } })).toBe(0)
        expect(enqueueInTransaction).not.toHaveBeenCalled()
        expect(await tx.entry.findUnique({ where: { id: post.id } })).not.toBeNull()
      }
      const source = await tx.entry.findFirstOrThrow({ where: { project_id: project.id } })
      const copy = await tx.entry.create({ data: { room_id: rooms[0].id, source_entry_id: source.id, user_id: users[0].id, status: "published", created_at: now, updated_at: now, published_at: now } })
      const result = await service.create(users[0].id, { room_id: rooms[0].id, recipient_user_ids: users.slice(1).map(user => user.id), note: "Shared copy", entry_id: copy.id })
      expect(await tx.introduction.findUnique({ where: { id: Number(result.introduction.id) } })).toMatchObject({ entry_id: copy.id })
      expect(await tx.notificationEvent.count({ where: { room_id: rooms[0].id, entry_id: copy.id } })).toBe(2)
      expect(enqueueInTransaction).toHaveBeenCalledTimes(2)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
