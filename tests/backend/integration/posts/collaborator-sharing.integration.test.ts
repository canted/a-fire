import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { canManageEntryDraft } from "@server/api/v1/entries/entry-draft-access"
import { assertRoomEntrySource } from "@server/api/v1/entries/room-entry-policy"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("permits an accepted collaborator's own source, but rejects other authors and revoked access", async () => {
  const prisma = new PrismaService()
  const rollback = new Error("Roll back sharing fixtures")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await Promise.all(["Owner", "Collaborator"].map(username => tx.user.create({ data: { username, email: `${crypto.randomUUID()}@collaborator.test`, created_at: now, updated_at: now } })))
      const [owner, collaborator] = users
      const project = await tx.project.create({ data: { owner_id: owner.id, name: "Shared private project", created_at: now, updated_at: now } })
      const participation = await tx.projectParticipation.create({ data: { project_id: project.id, user_id: collaborator.id, invited_by_id: owner.id, status: "accepted", invited_at: now, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { owner_id: owner.id, name: "Destination", created_at: now, updated_at: now } })
      await tx.roomMembership.createMany({ data: users.map(user => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
      const entry = await tx.entry.create({ data: { user_id: collaborator.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
      await tx.document.create({ data: { docable_type: "Post", docable_id: entry.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Collaborator's work" }] }] }, created_at: now, updated_at: now } })
      const access = withTestDependencies(new RoomAccessService(), { prisma: tx })
      const service = withTestDependencies(new ProjectEntriesService(), { prisma: tx, circleAccess: access })
      const source = { user_id: collaborator.id, source_entry_id: entry.id }
      await expect(service.shareSelection(project.id, entry.id, collaborator.id, room.id)).resolves.toMatchObject({ units: expect.any(Array) })
      await expect(assertRoomEntrySource(tx, source)).resolves.toBeUndefined()
      await expect(service.shareSelection(project.id, entry.id, owner.id, room.id)).rejects.toThrow("your own")
      await expect(assertRoomEntrySource(tx, { ...source, user_id: owner.id })).rejects.toThrow("unavailable")
      await tx.projectParticipation.update({ where: { id: participation.id }, data: { status: "declined" } })
      await expect(service.shareSelection(project.id, entry.id, collaborator.id, room.id)).rejects.toThrow("your own")
      await expect(assertRoomEntrySource(tx, source)).rejects.toThrow("unavailable")
      await tx.projectParticipation.update({ where: { id: participation.id }, data: { status: "accepted" } })

      const draft = await tx.entry.create({ data: { user_id: collaborator.id, room_id: room.id, source_entry_id: entry.id, created_at: now, updated_at: now } })
      const posts = withTestDependencies(new EntriesService(), { prisma: tx, circleAccess: access })
      const uploads = withTestDependencies(new UploadsService(), { prisma: tx, circleAccess: access })
      await expect(canManageEntryDraft(tx as unknown as PrismaService, access as unknown as RoomAccessService, draft, collaborator.id)).resolves.toBe(true)
      await tx.roomMembership.updateMany({ where: { room_id: room.id, user_id: collaborator.id }, data: { disabled: true } })
      await expect(posts.fetchDraft(draft.id, collaborator.id)).rejects.toThrow("Forbidden")
      await expect(posts.saveContent(draft.id, collaborator.id, { type: "doc", content: [] })).rejects.toThrow("Forbidden")
      await expect(posts.publish(draft.id, collaborator.id)).rejects.toThrow("Forbidden")
      const file = { originalname: "blocked.txt", mimetype: "text/plain", size: 2, buffer: Buffer.from("no") } as Express.Multer.File
      await expect(uploads.createUpload(collaborator.id, file, { entry_id: draft.id })).rejects.toThrow("Forbidden")
      expect(await tx.document.count({ where: { docable_type: "Post", docable_id: draft.id } })).toBe(0)
      expect((await tx.entry.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft")

      await expect(service.shareSelection(project.id, entry.id, collaborator.id, room.id)).rejects.toThrow()
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  } finally {
    await prisma.$disconnect()
  }
})
