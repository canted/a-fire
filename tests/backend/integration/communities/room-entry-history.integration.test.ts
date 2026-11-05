import { PagesService } from "@server/api/v1/pages/pages.service"
import { PagesWriteService } from "@server/api/v1/pages/pages.write.service"
import { MentionsService } from "@server/api/v1/mentions/mentions.service"
import { RoomBannersService } from "@server/api/v1/rooms/room-banners.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { recentRoomMemberEntryIds } from "@server/api/v1/entries/room-entry-history"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import "reflect-metadata"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RoomMemberProfilesService } from "@server/api/v1/rooms/room-member-profiles.service"

it("paginates shared Room entries for Open visits and immediately applies narrower access", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@entry-history.test`, username: "History", created_at: now, updated_at: now } })
  const author = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@entry-author.test`, username: "Author", created_at: now, updated_at: now } })
  const parent = await prisma.room.create({ data: { name: "Parent", porosity: "open", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: author.id, parent_id: parent.id, porosity: "open", created_at: now, updated_at: now } })
  const project = await prisma.project.create({ data: { owner_id: author.id, name: "Private", created_at: now, updated_at: now } })
  const source = await prisma.entry.create({ data: { user_id: author.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } })
  const access = new RoomAccessService()
  Object.assign(access, { prisma })
  const communities = new RoomsService()
  Object.assign(communities, { prisma, circleAccess: access })
  const service = new RoomMemberProfilesService()
  Object.assign(service, { prisma, circleAccess: access })
  const ids: number[] = []
  let childId: number | undefined
  let identityBlobId: number | undefined
  const invitedEmail = `${crypto.randomUUID()}@deleted-room.test`
  try {
    await prisma.roomMembership.create({ data: { room_id: parent.id, user_id: user.id, disabled: false, created_at: now, updated_at: now } })
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: author.id, disabled: false, created_at: now, updated_at: now } })
    await access.visit(room.id, user.id)
    for (let index = 0; index < 22; index++) {
      const date = new Date(now.getTime() - index * 1000)
      const post = await prisma.entry.create({ data: { room_id: room.id, source_entry_id: source.id, user_id: author.id, status: "published", created_at: date, updated_at: date, published_at: date } })
      ids.push(post.id)
    }
    expect(await recentRoomMemberEntryIds(prisma, [{ roomId: room.id, userId: author.id }], 3)).toEqual(ids.slice(0, 3))
    expect(await recentRoomMemberEntryIds(prisma, [{ roomId: room.id, userId: author.id }], 1)).toEqual([ids[0]])
    expect(await recentRoomMemberEntryIds(prisma, [], 3)).toEqual([])
    // An original Chat attachment is not an independently shared Room entry.
    await prisma.entry.create({ data: { room_id: room.id, user_id: author.id, status: "published", creation_origin: "chat_attachment", created_at: now, updated_at: now, published_at: now } })
    expect((await communities.listMembers(room.id, user.id)).members.map(member => member.user_id)).toEqual([author.id])
    await prisma.reply.createMany({ data: Array.from({ length: 200 }, () => ({ entry_id: ids[0], user_id: author.id, status: "published", created_at: now, updated_at: now, published_at: now })) })
    await prisma.reply.createMany({ data: ["draft", "deleted"].map(status => ({ entry_id: ids[0], user_id: author.id, status, created_at: now, updated_at: now })) })
    const countRead = vi.spyOn(prisma.entry, "count").mockRejectedValue(new Error("Pagination must not count full Entry history"))
    const first = await service.fetchRoomMemberPosts(room.id, author.id, user.id, 1)
    const second = await service.fetchRoomMemberPosts(room.id, author.id, user.id, 2)
    expect((await service.fetchRoomMemberPosts(room.id, author.id, user.id, 1)).entries).toEqual(first.entries)
    expect((await service.fetchRoomMemberPosts(room.id, author.id, user.id, 2)).entries).toEqual(second.entries)
    expect(first.entries.map(post => post.id)).toEqual(ids.slice(0, 20).map(String))
    expect(first.entries[0].replyCount).toBe(200)
    expect(first.entries.slice(1).every(post => post.replyCount === 0)).toBe(true)
    const cursorFirst = await service.fetchRoomMemberPosts(room.id, author.id, user.id, 1, "")
    expect(cursorFirst.entries).toEqual(first.entries)
    expect(cursorFirst.pagination.nextPage).toBeNull()
    expect(cursorFirst.pagination.nextCursor).toBeTruthy()
    const cursorSecond = await service.fetchRoomMemberPosts(room.id, author.id, user.id, 1, cursorFirst.pagination.nextCursor!)
    expect(cursorSecond.entries).toEqual(second.entries)
    expect(cursorSecond.pagination.nextCursor).toBeNull()
    expect((await service.fetchRoomMemberPosts(room.id, author.id, user.id, 1, "")).entries).toEqual(cursorFirst.entries)
    expect(first.pagination.nextPage).toBe(2)
    expect(second.entries.map(post => post.id)).toEqual(ids.slice(20).map(String))
    expect(second.pagination.nextPage).toBeNull()
    await prisma.entry.updateMany({ where: { id: { in: ids.slice(20) } }, data: { status: "draft" } })
    const exactPage = await service.fetchRoomMemberPosts(room.id, author.id, user.id, 1)
    expect(exactPage.entries).toHaveLength(20)
    expect(exactPage.pagination.nextPage).toBeNull()
    expect((await service.fetchRoomMemberPosts(room.id, author.id, user.id, 2)).entries).toEqual([])
    await prisma.entry.updateMany({ where: { id: { in: ids.slice(20) } }, data: { status: "published" } })
    expect(countRead).not.toHaveBeenCalled()
    countRead.mockRestore()
    expect(first.viewer_access).toEqual({ kind: "visitor", entry_history: "all" })
    expect(first.projects).toEqual([])
    for (const post of first.entries) expect(post.reflections).toEqual([])
    await prisma.room.update({ where: { id: room.id }, data: { porosity: "masked" } })
    await expect(communities.listMembers(room.id, user.id)).rejects.toThrow("Forbidden")
    expect((await communities.listMembersForChat(room.id, user.id)).members).toEqual([])
    await prisma.chatMessage.create({ data: { room_id: room.id, author_id: author.id, body: "Visible author", masked_alias: "", created_at: now, updated_at: now, fire_at: new Date(now.getTime() + 7 * 86400000), expires_at: new Date(now.getTime() + 14 * 86400000) } })
    expect((await communities.listMembersForChat(room.id, user.id)).members.map(member => member.user_id)).toEqual([author.id])
    const limited = await service.fetchRoomMemberPosts(room.id, author.id, user.id, 2)
    expect((await service.fetchRoomMemberPosts(room.id, author.id, user.id, 2)).entries).toEqual(limited.entries)
    expect(limited.entries.map(post => post.id)).toEqual([String(ids[0])])
    expect(limited.viewer_access.entry_history).toBe("current_only")
    expect(limited.pagination.nextPage).toBeNull()
    const downgradedCursor = await service.fetchRoomMemberPosts(room.id, author.id, user.id, 1, cursorFirst.pagination.nextCursor!)
    expect(downgradedCursor.entries).toEqual(limited.entries)
    expect(downgradedCursor.pagination.nextCursor).toBeNull()

    const post = await prisma.entry.findUniqueOrThrow({ where: { id: ids[0] } })
    const limitedAccess = await access.require(room.id, user.id)
    expect(await access.canReadPublishedPostWithRoomHistory(post, limitedAccess)).toBe(true)
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: author.id }, data: { disabled: true } })
    expect(await access.canReadPublishedPostWithRoomHistory(post, limitedAccess)).toBe(false)
    await expect(service.fetchRoomMemberPosts(room.id, author.id, user.id, 1)).rejects.toThrow("Not Found")
    await expect(service.fetchRoomMemberPosts(room.id, author.id, user.id, 1)).rejects.toThrow("Not Found")
    await prisma.room.update({ where: { id: room.id }, data: { porosity: "open" } })
    expect((await service.fetchRoomMemberPosts(room.id, author.id, user.id, 1)).entries).toHaveLength(20)
    expect(await access.canReadPublishedPostWithRoomHistory(post, await access.require(room.id, user.id))).toBe(true)
    await prisma.roomMembership.updateMany({ where: { room_id: parent.id, user_id: user.id }, data: { disabled: true } })
    await expect(service.fetchRoomMemberPosts(room.id, author.id, user.id, 1)).rejects.toThrow("Forbidden")
    await expect(service.fetchRoomMemberPosts(room.id, author.id, user.id, 1)).rejects.toThrow("Forbidden")
    await prisma.roomMembership.updateMany({ where: { room_id: parent.id, user_id: user.id }, data: { disabled: false } })
    expect((await access.require(room.id, user.id)).kind).toBe("visitor")
    const child = await prisma.room.create({ data: { name: "Independent child", parent_id: room.id, owner_id: user.id, porosity: "closed", created_at: now, updated_at: now } })
    childId = child.id
    await prisma.roomMembership.create({ data: { room_id: child.id, user_id: user.id, disabled: false, created_at: now, updated_at: now } })
    const identityBlob = await prisma.activeStorageBlob.create({ data: { key: crypto.randomUUID(), filename: "room.png", content_type: "image/png", service_name: "test", byte_size: 1, created_at: now } })
    identityBlobId = identityBlob.id
    await prisma.activeStorageAttachment.createMany({ data: [
      { blob_id: identityBlob.id, record_type: "Circle", record_id: room.id, name: "avatar", created_at: now },
    ] })
    const uploads = new UploadsService()
    Object.assign(uploads, { prisma, circleAccess: access })
    const identityImage = { type: "image", attrs: { src: `/api/v1/uploads/${identityBlob.id}` } }
    await expect(uploads.assertContentMediaAccess(author.id, identityImage, null)).resolves.toBeUndefined()
    const failingDeletion = new RoomsService()
    Object.assign(failingDeletion, { prisma: prisma.$extends({ query: { roomVisit: { async updateMany() { throw new Error("lease write failed") } } } }) })
    await expect(failingDeletion.deleteRoom(room.id, author.id)).rejects.toThrow("lease write failed")
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).deleted_at).toBeNull()
    expect((await prisma.room.findUniqueOrThrow({ where: { id: child.id } })).parent_id).toBe(room.id)
    expect((await access.require(room.id, user.id)).kind).toBe("visitor")
    await communities.deleteRoom(room.id, author.id)
    expect(await access.resolve(room.id, user.id)).toBeNull()
    expect(await access.resolveAdmission(room.id, user.id)).toBeNull()
    expect(await access.resolve(room.id, author.id)).toBeNull()
    await expect(communities.updateRoom(room.id, author.id, { name: "Revived" })).rejects.toThrow("Forbidden")
    await expect(communities.listNotificationDeliveries(room.id, author.id)).rejects.toThrow("Forbidden")
    await expect(uploads.assertContentMediaAccess(author.id, identityImage, null)).rejects.toThrow("Not Found")
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).deleted_at).not.toBeNull()
    const staleInvite = await prisma.invite.create({ data: { email: invitedEmail, room_id: room.id, invite_type: 0, token: crypto.randomUUID(), invited_by_id: author.id, expires_at: new Date(Date.now() + 86400000), created_at: now, updated_at: now } })
    const auth = new AuthService()
    Object.assign(auth, { prisma })
    await expect(auth.acceptInvite(staleInvite.token)).rejects.toThrow("Community not found")
    expect(await prisma.user.count({ where: { email: invitedEmail } })).toBe(0)
    expect((await prisma.invite.findUniqueOrThrow({ where: { id: staleInvite.id } })).used_at).toBeNull()

    expect(await prisma.entry.count({ where: { room_id: room.id } })).toBe(23)
    expect((await prisma.room.findUniqueOrThrow({ where: { id: child.id } })).parent_id).toBeNull()
    expect((await access.require(child.id, user.id)).kind).toBe("member")
    await communities.deleteRoom(room.id, author.id)

    // A stale or concurrently reactivated membership cannot bypass the Room tombstone.
    await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: author.id }, data: { disabled: false } })
    const note = await prisma.page.create({ data: { room_id: room.id, title: "Retained Note", created_at: now, updated_at: now } })
    const pages = new PagesService()
    const writes = new PagesWriteService()
    const mentions = new MentionsService()
    Object.assign(mentions, { circleAccess: access })
    const banners = new RoomBannersService()
    for (const target of [pages, writes, mentions, banners]) Object.assign(target, { prisma })
    await expect(pages.fetchPage(note.id, author.id)).rejects.toThrow("Forbidden")
    await expect(pages.fetchTree(room.id, author.id)).rejects.toThrow("Forbidden")
    await expect(writes.createPage(author.id, { room_id: room.id })).rejects.toThrow("Forbidden")
    await expect(writes.updatePage(note.id, author.id, { title: "Changed" })).rejects.toThrow("Forbidden")
    await expect(writes.saveContent(note.id, author.id, {}, 0)).rejects.toThrow("Community not found")
    await expect(writes.deletePage(note.id, author.id)).rejects.toThrow("Forbidden")
    await expect(mentions.listTargets(room.id, author.id)).rejects.toThrow("Forbidden")
    await expect(banners.listFirstPostPrompts(room.id, author.id)).rejects.toThrow("Not Found")
    expect((await prisma.page.findUniqueOrThrow({ where: { id: note.id } })).deleted_at).toBeNull()

  } finally {
    await prisma.page.deleteMany({ where: { room_id: room.id } })
    if (identityBlobId) {
      await prisma.activeStorageAttachment.deleteMany({ where: { blob_id: identityBlobId } })
      await prisma.activeStorageBlob.delete({ where: { id: identityBlobId } })
    }
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.reply.deleteMany({ where: { entry_id: { in: ids } } })
    await prisma.entry.deleteMany({ where: { room_id: room.id } })
    await prisma.entry.delete({ where: { id: source.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    if (childId) {
      await prisma.roomMembership.deleteMany({ where: { room_id: childId } })
      await prisma.room.delete({ where: { id: childId } })
    }
    await prisma.invite.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: parent.id } })
    await prisma.room.delete({ where: { id: parent.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.user.delete({ where: { id: author.id } })
    await prisma.user.deleteMany({ where: { email: invitedEmail } })
    await prisma.$disconnect()
  }
})
