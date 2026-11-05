import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { CommittedIdChangeListener } from "@server/realtime/committed-id-change-listener"

it.each([false, true])("withdraws Room copies with current authority, retained content and one committed refresh (legacy=%s)", async legacy => {
  const prisma = new PrismaService(), now = new Date(), users: number[] = [], posts: number[] = [], replyDocuments: number[] = []
  for (const name of ["Owner", "Author", "Member"]) users.push((await prisma.user.create({ data: { username: name, email: `${crypto.randomUUID()}@withdraw.test`, created_at: now, updated_at: now } })).id)
  const [owner, author, member] = users
  const room = await prisma.room.create({ data: { name: "Room", owner_id: owner, porosity: "closed", created_at: now, updated_at: now } })
  await prisma.roomMembership.createMany({ data: users.map(user_id => ({ user_id, room_id: room.id, created_at: now, updated_at: now })) })
  const access = new RoomAccessService(); Object.assign(access, { prisma })
  const service = new EntriesService(); Object.assign(service, { prisma, circleAccess: access })
  const withdraw = async (id: number, actor: number) => {
    if (!legacy) return service.withdrawRoomEntry(id, actor)
    const { success, ...result } = await service.deleteLockedChatPost(id, actor)
    expect(success).toBe(true)
    return result
  }
  const hints: number[] = []
  const listener = new CommittedIdChangeListener("afire_room_changes", "afire-withdraw-test", process.env.DATABASE_URL!, id => hints.push(id), () => {}, () => {})
  try {
    await listener.start()
    const source = await prisma.entry.create({ data: { user_id: author, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } }); posts.push(source.id)
    const sourceDocument = await prisma.document.create({ data: { docable_type: "Post", docable_id: source.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Private original" }] }] }, created_at: now, updated_at: now } })
    const older = await prisma.entry.create({ data: { user_id: author, room_id: room.id, source_entry_id: source.id, status: "published", published_at: now, created_at: now, updated_at: now } }); posts.push(older.id)
    const entry = await prisma.entry.create({ data: { user_id: author, room_id: room.id, source_entry_id: source.id, status: "published", published_at: new Date(now.getTime() + 1000), created_at: now, updated_at: now } }); posts.push(entry.id)
    const document = await prisma.document.create({ data: { docable_type: "Post", docable_id: entry.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Retained shared body" }] }] }, created_at: now, updated_at: now } })
    const reply = await prisma.reply.create({ data: { user_id: member, entry_id: entry.id, status: "published", created_at: now, updated_at: now } })
    const replyDocument = await prisma.document.create({ data: { docable_type: "Reply", docable_id: reply.id, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Retained feedback" }] }] }, created_at: now, updated_at: now } }); replyDocuments.push(replyDocument.id)
    await expect(withdraw(entry.id, member)).rejects.toThrow("Only the sharer or Room owner")
    await expect(withdraw(source.id, author)).rejects.toThrow("Room Entry unavailable")
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: author }, data: { disabled: true } })
    await expect(withdraw(entry.id, author)).rejects.toThrow("Members only")
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: author }, data: { disabled: false } })
    const failed = prisma.$extends({ query: { entry: { async update({ args, query }) { await query(args); throw new Error("Withdrawal interrupted") } } } })
    Object.assign(service, { prisma: failed })
    await expect(withdraw(entry.id, author)).rejects.toThrow("Withdrawal interrupted")
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: entry.id } })).toEqual(entry)
    Object.assign(service, { prisma })
    const results = await Promise.all([withdraw(entry.id, author), withdraw(entry.id, author)])
    expect(results).toEqual(Array(2).fill({ entry_id: entry.id, room_id: room.id, current_entry_id: older.id }))
    const sentinel = Number.MAX_SAFE_INTEGER - room.id
    await prisma.$queryRaw`SELECT pg_notify('afire_room_changes', ${String(sentinel)})::text`
    await vi.waitFor(() => expect(hints).toContain(sentinel))
    expect(hints.filter(id => id === room.id)).toEqual([room.id])
    expect(await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).toEqual(document)
    expect(await prisma.reply.findUniqueOrThrow({ where: { id: reply.id } })).toEqual(reply)
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source)
    expect(await prisma.document.findUniqueOrThrow({ where: { id: sourceDocument.id } })).toEqual(sourceDocument)
    expect(await prisma.document.findUniqueOrThrow({ where: { id: replyDocument.id } })).toEqual(replyDocument)
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: author }, data: { disabled: true } })
    expect(await withdraw(entry.id, owner)).toMatchObject({ current_entry_id: null })
    expect(await withdraw(older.id, owner)).toMatchObject({ current_entry_id: null })
    expect(await prisma.entry.count({ where: { id: { in: [entry.id, older.id] }, status: "deleted" } })).toBe(2)
  } finally {
    await listener.stop()
    await prisma.document.deleteMany({ where: { id: { in: replyDocuments } } })
    await prisma.reply.deleteMany({ where: { entry_id: { in: posts } } })
    await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: { in: posts } } })
    await prisma.entry.deleteMany({ where: { id: { in: posts } } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  }
})
