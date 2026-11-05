import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { readParticipationPreviews } from "@server/api/v1/entries/participation-previews"

it("projects exact late feedback and public copies without loading private sources or unrelated reply bodies", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback previews")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await tx.user.createManyAndReturn({ data: ["Viewer", "Author"].map(username => ({ username, email: `${crypto.randomUUID()}@participation-preview.test`, created_at: now, updated_at: now })) })
      const room = await tx.room.create({ data: { name: "Room", created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { room_id: room.id, user_id: users[0].id, username_override: "Room name", created_at: now, updated_at: now } })
      const project = await tx.project.create({ data: { owner_id: users[1].id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { project_id: project.id, user_id: users[1].id, status: "published", creation_origin: "project_material", created_at: now, updated_at: now } })
      const post = await tx.entry.create({ data: { room_id: room.id, source_entry_id: source.id, user_id: users[1].id, status: "published", created_at: now, updated_at: now } })
      const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
      await tx.document.create({ data: { docable_type: "Post", docable_id: source.id, content: doc("Private original"), created_at: now, updated_at: now } })
      await tx.document.create({ data: { docable_type: "Post", docable_id: post.id, content: doc("Shared copy"), created_at: now, updated_at: now } })
      await tx.reply.createMany({ data: Array.from({ length: 205 }, () => ({ entry_id: post.id, user_id: users[1].id, status: "published", published_at: now, created_at: now, updated_at: now })) })
      const reply = await tx.reply.create({ data: { entry_id: post.id, user_id: users[0].id, status: "published", published_at: new Date(now.getTime() + 1000), created_at: now, updated_at: now } })
      await tx.document.create({ data: { docable_type: "Reply", docable_id: reply.id, content: doc("My late feedback"), created_at: now, updated_at: now } })
      const previews = await readParticipationPreviews(tx, room.id, users[0].id, [{ entryId: String(post.id), replyId: String(reply.id) }, { entryId: String(source.id) }])
      expect(previews.size).toBe(1)
      const preview = previews.get(post.id)!
      expect(preview.entry.content).toEqual(doc("Shared copy"))
      expect(preview.entry).not.toHaveProperty("source_entry_id")
      expect(preview.replies).toEqual([expect.objectContaining({ id: reply.id, content: doc("My late feedback"), user: expect.objectContaining({ display_username: "Room name" }) })])
      expect(preview.participants.map(user => user.id)).toEqual([users[1].id])
      expect((await readParticipationPreviews(tx, room.id, users[1].id, [{ entryId: String(post.id), replyId: String(reply.id) }])).get(post.id)?.replies).toEqual([])
      expect((await readParticipationPreviews(tx, room.id + 100000, users[0].id, [{ entryId: String(post.id) }])).size).toBe(0)
      await tx.entry.update({ where: { id: post.id }, data: { status: "deleted" } })
      expect((await readParticipationPreviews(tx, room.id, users[0].id, [{ entryId: String(post.id) }])).size).toBe(0)
      await expect(readParticipationPreviews(tx, room.id, users[0].id, Array.from({ length: 101 }, () => ({ entryId: String(post.id) })))).rejects.toThrow("100")
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
