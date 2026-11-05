import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { MentionsService } from "@server/api/v1/mentions/mentions.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("discovers only visitor-visible mention targets without renewing admission", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback visitor discovery fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const [visitor, author, hidden] = await tx.user.createManyAndReturn({ data: Array.from({ length: 3 }, () => ({ email: `${crypto.randomUUID()}@mention-discovery.test`, username: "Fixture", created_at: now, updated_at: now })) })
      const parent = await tx.room.create({ data: { name: "Parent", created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { name: "Room", parent_id: parent.id, porosity: "open", created_at: now, updated_at: now } })
      await tx.roomMembership.createMany({ data: [
        { room_id: parent.id, user_id: visitor.id, created_at: now, updated_at: now },
        ...[author, hidden].map(user => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })),
      ] })
      const project = await tx.project.create({ data: { owner_id: author.id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { user_id: author.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
      const entry = await tx.entry.create({ data: { room_id: room.id, source_entry_id: source.id, user_id: author.id, status: "published", published_at: now, created_at: now, updated_at: now } })
      await tx.page.create({ data: { room_id: room.id, title: "Private Note", created_at: now, updated_at: now } })
      const rounds = await tx.round.createManyAndReturn({ data: ["draft", "active", "archived", "cancelled"].map(status => ({ room_id: room.id, host_id: author.id, name: status, status, created_at: now, updated_at: now })) })
      const access = withTestDependencies(new RoomAccessService(), { prisma: tx })
      const service = withTestDependencies(new MentionsService(), { prisma: tx, circleAccess: access })
      await expect(service.listTargets(room.id, visitor.id)).rejects.toThrow("Forbidden")
      await access.visit(room.id, visitor.id)
      const leaseBefore = await tx.roomVisit.findMany({ where: { room_id: room.id, user_id: visitor.id } })
      const open = await service.listTargets(room.id, visitor.id)
      expect(open.targets.filter(target => target.target_type === "user").map(target => Number(target.target_id)).sort()).toEqual([author.id, hidden.id].sort())
      expect(open.targets.filter(target => target.target_type === "note")).toEqual([])
      expect(open.targets.filter(target => target.target_type === "round").map(target => target.label).sort()).toEqual(["active", "archived"])
      expect(open.targets.some(target => target.id === `circle:${room.id}`)).toBe(true)
      await tx.room.update({ where: { id: room.id }, data: { porosity: "masked" } })
      const limited = await service.listTargets(room.id, visitor.id)
      expect(limited.targets.filter(target => target.target_type === "user").map(target => target.target_id)).toEqual([String(author.id)])
      expect(limited.targets.filter(target => target.target_type === "round").map(target => target.target_id)).toEqual([String(rounds.find(round => round.status === "active")!.id)])
      const suggestedUsers = async () => (await service.listTargets(room.id, visitor.id)).targets
        .filter(target => target.target_type === "user").map(target => Number(target.target_id)).sort()
      const feedback = await tx.reply.create({ data: { entry_id: entry.id, user_id: hidden.id, status: "draft", created_at: now, updated_at: now } })
      expect(await suggestedUsers()).toEqual([author.id])
      await tx.reply.update({ where: { id: feedback.id }, data: { status: "published", published_at: now } })
      expect(await suggestedUsers()).toEqual([author.id, hidden.id].sort())
      await tx.reply.update({ where: { id: feedback.id }, data: { status: "deleted" } })
      expect(await suggestedUsers()).toEqual([author.id])
      const message = { room_id: room.id, body: "Visible text", masked_alias: "", created_at: now, updated_at: now, fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000) }
      await tx.chatMessage.create({ data: { ...message, author_id: hidden.id } })
      expect(await suggestedUsers()).toEqual([author.id, hidden.id].sort())
      await tx.chatMessage.createMany({ data: Array.from({ length: 10 }, () => ({ ...message, author_id: author.id })) })
      expect(await suggestedUsers()).toEqual([author.id])
      expect(await tx.roomVisit.findMany({ where: { room_id: room.id, user_id: visitor.id } })).toEqual(leaseBefore)
      await tx.roomMembership.updateMany({ where: { room_id: parent.id, user_id: visitor.id }, data: { disabled: true } })
      await expect(service.listTargets(room.id, visitor.id)).rejects.toThrow("Forbidden")
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
