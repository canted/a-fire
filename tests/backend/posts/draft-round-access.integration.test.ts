import "reflect-metadata"
import { withTestDependencies } from "@tests/backend/helpers/service"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"

it("prevents a departed author changing a Room draft's Round", async () => {
  const prisma = new PrismaClient(), rollback = new Error("rollback"), now = new Date()
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Author", email: `${crypto.randomUUID()}@round-access.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: user.id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { source_entry_id: source.id, room_id: room.id, user_id: user.id, status: "draft", created_at: now, updated_at: now } })
      const access = withTestDependencies(new RoomAccessService(), { prisma: tx })
      const service = withTestDependencies(new EntriesService(), {
        prisma: { entry: tx.entry, $transaction: (run: (client: typeof tx) => unknown) => run(tx) },
        circleAccess: access,
      })
      await expect(service.updateDraftActivity(post.id, user.id, null)).rejects.toThrow("Members only")
      expect(await tx.entry.findUniqueOrThrow({ where: { id: post.id } })).toEqual(post)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
