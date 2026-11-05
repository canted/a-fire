import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RoomMemberProfilesService } from "@server/api/v1/rooms/room-member-profiles.service"
import { IntroductionsService } from "@server/api/v1/introductions/introductions.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("reads Board-free member history through Room authority and denies private originals", async () => {
  const prisma = new PrismaService(), rollback = new Error("rollback member profile fixture")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date()
      const users = await tx.user.createManyAndReturn({ data: Array.from({ length: 4 }, () => ({ email: `${crypto.randomUUID()}@profile.test`, username: "Fixture", created_at: now, updated_at: now })) })
      const [author, viewer, outsider, introducer] = users
      const room = await tx.room.create({ data: { name: "Room", owner_id: author.id, porosity: "closed", created_at: now, updated_at: now } })
      await tx.roomMembership.createMany({ data: [author, viewer, introducer].map(user => ({ room_id: room.id, user_id: user.id, created_at: now, updated_at: now })) })
      const source = await tx.entry.create({ data: { user_id: author.id, status: "draft", created_at: now, updated_at: now } })
      const entry = await tx.entry.create({ data: { user_id: author.id, room_id: room.id, source_entry_id: source.id, status: "published", published_at: now, created_at: now, updated_at: now } })
      const emptyBody = { type: "doc", content: [{ type: "paragraph", content: [] }] }
      await tx.document.create({ data: { docable_type: "Post", docable_id: entry.id, content: emptyBody, created_at: now, updated_at: now } })
      const circleAccess = withTestDependencies(new RoomAccessService(), { prisma: tx })
      const introductions = withTestDependencies(new IntroductionsService(), { prisma: tx })
      const profiles = withTestDependencies(new RoomMemberProfilesService(), { prisma: tx, circleAccess, introductions, projects: { listForUser: async () => [] } })
      const otherRoom = await tx.room.create({ data: { name: "Private", created_at: now, updated_at: now } })
      const notes = await tx.page.createManyAndReturn({ data: [room.id, otherRoom.id].map(community_id => ({ room_id: community_id, title: community_id === room.id ? "Visible" : "Private title", created_at: now, updated_at: now })) })
      await tx.reflection.createMany({ data: notes.map(note => ({ page_id: note.id, reflectable_type: "Post", reflectable_id: entry.id, user_id: author.id, created_at: now, updated_at: now })) })
      const profile = await profiles.fetchRoomMemberPosts(room.id, author.id, viewer.id, 1)
      expect((profile.entries[0].reflections ?? []).map(item => item.pageTitle)).toEqual(["Visible"])
      expect(profile.entries[0].content).toEqual(emptyBody)
      expect(profile.id).toBe(`${room.id}:${author.id}`)
      expect(profile.entries.map(post => post.id)).toEqual([String(entry.id)])
      expect(profile.viewer_access).toEqual({ kind: "member", entry_history: "all" })
      expect((await profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id)).introductions).toEqual([])
      const introduction = await tx.introduction.create({ data: {
        room_id: room.id, created_by_id: introducer.id, note: "Shared interests",
        created_at: now, updated_at: now,
        recipients: { create: [author, viewer].map(user => ({ user_id: user.id, created_at: now, updated_at: now })) },
      } })
      const membership = await tx.roomMembership.findFirstOrThrow({ where: { room_id: room.id, user_id: author.id } })
      const blobs = await tx.activeStorageBlob.createManyAndReturn({ data: Array.from({ length: 3 }, () => ({ key: crypto.randomUUID(), filename: "avatar", byte_size: 1, service_name: "test", created_at: now })) })
      await tx.activeStorageAttachment.createMany({ data: Array.from({ length: 1000 }, () => ({ blob_id: blobs[0].id, record_type: "CircleMembership", record_id: membership.id, name: "avatar", created_at: now })) })
      await tx.activeStorageAttachment.create({ data: { blob_id: blobs[1].id, record_type: "CircleMembership", record_id: membership.id, name: "avatar", created_at: now } })
      await tx.activeStorageAttachment.create({ data: { blob_id: blobs[2].id, record_type: "User", record_id: viewer.id, name: "avatar", created_at: now } })
      {
        const result = await profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id)
        expect(result.introductions.map(item => item.id)).toEqual([String(introduction.id)])
        expect(result.introductions[0].participants.map(item => item.id).sort()).toEqual([String(author.id), String(viewer.id)].sort())
        expect(result.introductions[0].viewerIsRecipient).toBe(true)
        expect(result.introductions[0].participants.every(item => item.squareId === null)).toBe(true)
        expect(result.introductions[0].participants.find(item => item.id === String(author.id))?.avatarUrl).toBe(`/api/v1/uploads/${blobs[1].id}/variants/avatarStripe40`)
        expect(result.introductions[0].participants.find(item => item.id === String(viewer.id))?.avatarUrl).toBe(`/api/v1/uploads/${blobs[2].id}/variants/avatarStripe40`)
        expect(result.introductions[0].createdBy.avatarUrl).toBeNull()
        expect(await tx.activeStorageAttachment.count({ where: { record_type: "CircleMembership", record_id: membership.id } })).toBe(1001)
      }
      const history = await tx.introduction.createManyAndReturn({ data: Array.from({ length: 60 }, () => ({ room_id: room.id, created_by_id: introducer.id, note: "Older introduction", created_at: now, updated_at: now })) })
      await tx.introductionRecipient.createMany({ data: history.flatMap(item => [author, viewer].map(user => ({ introduction_id: item.id, user_id: user.id, created_at: now, updated_at: now }))) })
      await tx.introductionRecipient.updateMany({ where: { introduction_id: history[0].id, user_id: viewer.id }, data: { hidden_at: now } })
      await tx.introduction.update({ where: { id: history[1].id }, data: { retracted_at: now } })
      await tx.introductionRecipient.updateMany({ where: { introduction_id: history[2].id, user_id: viewer.id }, data: { seen_at: now } })
      const profileOverview = (await profiles.fetchRoomMemberPosts(room.id, author.id, viewer.id, 1)).introductionOverview!
      expect(profileOverview.count).toBe(59)
      expect(profileOverview.unseenCount).toBe(58)
      expect(profileOverview.authors.map(item => item.id)).toEqual([String(introducer.id)])
      expect(profileOverview.remainingAuthorCount).toBe(0)
      expect(profileOverview.unseenIntroductions.map(item => item.id)).toEqual(history.slice(-3).reverse().map(item => String(item.id)))
      const otherCreators = await tx.user.createManyAndReturn({ data: Array.from({ length: 4 }, () => ({ email: `${crypto.randomUUID()}@overview.test`, username: "Introducer", created_at: now, updated_at: now })) })
      for (const creator of otherCreators) await tx.introduction.create({ data: { room_id: room.id, created_by_id: creator.id, note: "Another author", created_at: now, updated_at: now,
        recipients: { create: [author, viewer].map(user => ({ user_id: user.id, created_at: now, updated_at: now })) },
      } })
      const manyAuthors = (await profiles.fetchRoomMemberPosts(room.id, author.id, viewer.id, 1)).introductionOverview!
      expect(manyAuthors.count).toBe(63)
      expect(manyAuthors.unseenCount).toBe(62)
      expect(manyAuthors.authors.map(item => item.id)).toEqual(otherCreators.slice(-3).reverse().map(user => String(user.id)))
      expect(manyAuthors.remainingAuthorCount).toBe(2)
      expect(manyAuthors.unseenIntroductions).toHaveLength(3)
      const first = await profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id)
      expect(first.introductions).toHaveLength(30)
      const second = await profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id, { cursor: first.nextCursor! })
      expect(second.introductions).toHaveLength(30)
      const third = await profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id, { cursor: second.nextCursor! })
      expect(third.introductions).toHaveLength(3)
      expect(third.nextCursor).toBeNull()
      expect(new Set([...first.introductions, ...second.introductions, ...third.introductions].map(item => item.id)).size).toBe(63)
      await tx.introduction.update({ where: { id: Number(first.nextCursor) }, data: { retracted_at: now } })
      const afterRetraction = await profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id, { cursor: first.nextCursor! })
      expect(afterRetraction.introductions.map(item => item.id)).toEqual(second.introductions.map(item => item.id))
      const targeted = await profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id, { target: String(introduction.id) })
      expect(targeted.introductions).toHaveLength(31)
      expect(targeted.introductions.at(-1)?.id).toBe(String(introduction.id))
      const hiddenTarget = await profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id, { target: String(history[0].id) })
      expect(hiddenTarget.introductions.some(item => item.id === String(history[0].id))).toBe(false)
      await expect(profiles.fetchRoomMemberIntroductions(room.id, author.id, viewer.id, { cursor: "bad" })).rejects.toThrow("Invalid introduction")
      expect((await profiles.fetchRoomMemberPosts(room.id, author.id, viewer.id, 2)).introductionOverview).toBeNull()
      await expect(profiles.fetchRoomMemberPosts(room.id, author.id, outsider.id, 1)).rejects.toThrow("Forbidden")
      await expect(profiles.fetchRoomMemberIntroductions(room.id, author.id, outsider.id)).rejects.toThrow("Forbidden")
      await tx.roomMembership.updateMany({ where: { room_id: room.id, user_id: author.id }, data: { disabled: true } })
      expect((await profiles.fetchRoomMemberPosts(room.id, author.id, viewer.id, 1)).entries).toHaveLength(1)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
