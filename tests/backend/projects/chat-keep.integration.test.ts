import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ForbiddenException, NotFoundException } from "@nestjs/common"
import { PrismaService } from "@server/prisma/prisma.service"
import { StorageService } from "@server/storage/storage.service"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { AudioAssetsService } from "@server/api/v1/audio-assets/audio-assets.service"
import { VideoAssetsService } from "@server/api/v1/video-assets/video-assets.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("keeps chat text, attribution and media independently, without changing historic pins/replies or widening source access", async () => {
  const prisma = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-chat-keep-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const images = withTestDependencies(new ImageVariantsService(), { prisma, storage })
  const circleAccess = withTestDependencies(new RoomAccessService(), { prisma })
  const uploads = withTestDependencies(new UploadsService(), { prisma, storage, images, circleAccess, boss: { enqueue: vi.fn() } })
  const entries = withTestDependencies(new ProjectEntriesService(), { prisma, uploads, circleAccess })
  const audio = withTestDependencies(new AudioAssetsService(), { prisma, storage, circleAccess })
  const video = withTestDependencies(new VideoAssetsService(), { prisma, storage, circleAccess })
  const now = new Date(), suffix = crypto.randomUUID()
  const userIds: number[] = [], blobIds: number[] = []
  let projectId: number | undefined, targetRoomId: number | undefined, messageId: number | undefined
  try {
    const users = await Promise.all(["saver", "author", "collaborator", "pending"].map(role => prisma.user.create({ data: { email: `${role}-${suffix}@chat-keep.test`, username: role, created_at: now, updated_at: now } })))
    userIds.push(...users.map(user => user.id))
    const [saver, author, collaborator, pending] = users
    const circle = await prisma.room.create({ data: { name: "Chat keep circle", owner_id: saver.id, created_at: now, updated_at: now } })
    targetRoomId = circle.id
    await prisma.roomMembership.createMany({ data: [saver, author].map(user => ({ room_id: circle.id, user_id: user.id, username_override: user.id === author.id ? "Circle artist" : null, disabled: false, created_at: now, updated_at: now })) })
    const project = await prisma.project.create({ data: { name: "Chat keeps", owner_id: saver.id, created_at: now, updated_at: now } })
    projectId = project.id
    await prisma.projectParticipation.createMany({ data: [collaborator, pending].map(user => ({ project_id: project.id, user_id: user.id, invited_by_id: saver.id, status: user.id === collaborator.id ? "accepted" : "pending", invited_at: now, created_at: now, updated_at: now })) })
    const message = await prisma.chatMessage.create({ data: { room_id: circle.id, author_id: author.id, body: "Leave room for the cello", masked_alias: "artist", pinned_at: now, pinned_by_id: saver.id, fire_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })
    messageId = message.id
    const historicalReply = await prisma.reply.create({ data: { chat_message_id: message.id, user_id: saver.id, status: "published", created_at: now, updated_at: now } })
    const makeBlob = async (name: string) => {
      const key = `chat-keep-${suffix}-${name}`
      await storage.put(key, Buffer.from(name))
      const blob = await prisma.activeStorageBlob.create({ data: { key, filename: name, content_type: name === "image" ? "image/png" : `${name}/mp4`, byte_size: name.length, service_name: "test", created_at: now } })
      blobIds.push(blob.id)
      await prisma.activeStorageAttachment.create({ data: { record_type: "ChatMessage", record_id: message.id, blob_id: blob.id, name, created_at: now } })
      return blob
    }
    const imageBlob = await makeBlob("image"), audioBlob = await makeBlob("audio"), videoBlob = await makeBlob("video")
    const base = { owner_id: author.id, source_type: "ChatMessage", source_id: message.id, title: "Cello idea", original_filename: "idea.mp4", processing_status: "ready", created_at: now, updated_at: now }
    const sourceAudio = await prisma.audioAsset.create({ data: { ...base, blob_id: audioBlob.id, waveform_peaks: [0.2, 0.7], duration_ms: 1800 } })
    const sourceVideo = await prisma.videoAsset.create({ data: { ...base, blob_id: videoBlob.id, width: 640, height: 360, duration_ms: 1800 } })
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: message.body }] }, { type: "image", attrs: { src: `/api/v1/uploads/${imageBlob.id}` } }, { type: "audio", attrs: { audioAssetId: sourceAudio.id } }, { type: "video", attrs: { videoAssetId: sourceVideo.id, thumbnailUrl: `/api/v1/video-assets/${sourceVideo.id}/poster` } }] }
    await prisma.chatMessage.update({ where: { id: message.id }, data: { content } })

    await expect(entries.keepChatMessage(project.id, pending.id, message.id)).rejects.toBeInstanceOf(NotFoundException)
    // Historical collaboration does not make this an owned save destination.
    await expect(entries.keepChatMessage(project.id, collaborator.id, message.id)).rejects.toBeInstanceOf(NotFoundException)
    const transact = prisma.$transaction.bind(prisma)
    for (const change of ["membership", "room", "ownership"]) {
      const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
        if (change === "membership") await prisma.roomMembership.updateMany({ where: { room_id: circle.id, user_id: saver.id }, data: { disabled: true } })
        if (change === "room") await prisma.room.update({ where: { id: circle.id }, data: { deleted_at: new Date() } })
        if (change === "ownership") await prisma.project.update({ where: { id: project.id }, data: { owner_id: author.id } })
        return transact(callback)
      })
      try {
        await expect(entries.keepChatMessage(project.id, saver.id, message.id)).rejects.toThrow(change === "membership" ? "Members only" : change === "room" ? "Community not found" : "Project access is required")
        expect(transactionSpy).toHaveBeenCalledOnce()
        expect(await prisma.entry.count({ where: { project_id: project.id } })).toBe(0)
      } finally {
        transactionSpy.mockRestore()
        await prisma.roomMembership.updateMany({ where: { room_id: circle.id, user_id: saver.id }, data: { disabled: false } })
        await prisma.room.update({ where: { id: circle.id }, data: { deleted_at: null } })
        await prisma.project.update({ where: { id: project.id }, data: { owner_id: saver.id } })
      }
    }
    for (const change of ["content", "expiry", "age", "deletion"]) {
      const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
        await prisma.chatMessage.update({ where: { id: message.id }, data:
          change === "content" ? { body: "Changed during preparation" } :
          change === "expiry" ? { expires_at: new Date(Date.now() - 1) } :
          change === "age" ? { created_at: new Date(Date.now() - 15 * 86400000) } : { status: "deleted" },
        })
        return transact(callback)
      })
      try {
        await expect(entries.keepChatMessage(project.id, saver.id, message.id)).rejects.toThrow(change === "content" ? "This message changed before saving" : "Message not found")
        expect(transactionSpy).toHaveBeenCalledOnce()
        expect(await prisma.entry.count({ where: { project_id: project.id } })).toBe(0)
      } finally {
        transactionSpy.mockRestore()
        await prisma.chatMessage.update({ where: { id: message.id }, data: { body: message.body, expires_at: message.expires_at, created_at: message.created_at, status: message.status } })
      }
    }
    const linked = await prisma.entry.create({ data: { user_id: author.id, room_id: circle.id, status: "published", creation_origin: "chat_attachment", created_at: now, updated_at: now } })
    try {
      await prisma.document.create({ data: { docable_type: "Post", docable_id: linked.id, content, version: 1, created_at: now, updated_at: now } })
      await prisma.chatMessage.update({ where: { id: message.id }, data: { entry_id: linked.id } })
      for (const change of ["document", "withdrawal"]) {
        const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
          if (change === "document") await prisma.document.update({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: linked.id } }, data: { content: { type: "doc", content: [] } } })
          else await prisma.entry.update({ where: { id: linked.id }, data: { status: "deleted" } })
          return transact(callback)
        })
        try {
          await expect(entries.keepChatMessage(project.id, saver.id, message.id)).rejects.toThrow("This message changed before saving")
          expect(transactionSpy).toHaveBeenCalledOnce()
          expect(await prisma.entry.count({ where: { project_id: project.id } })).toBe(0)
        } finally {
          transactionSpy.mockRestore()
          await prisma.entry.update({ where: { id: linked.id }, data: { status: "published" } })
          await prisma.document.update({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: linked.id } }, data: { content } })
        }
      }
    } finally {
      await prisma.chatMessage.update({ where: { id: message.id }, data: { entry_id: null } })
      await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: linked.id } })
      await prisma.entry.delete({ where: { id: linked.id } })
    }
    const attemptedIds: number[] = []
    const failingDatabase = prisma.$extends({ query: {
      entry: { async create({ args, query }) { const row = await query(args); if (row.id === undefined) throw new Error("Missing created identity"); attemptedIds.push(row.id); return row } },
      project: { async update({ args, query }) { await query(args); throw new Error("Snapshot commit interrupted") } },
    } })
    const failingEntries = withTestDependencies(new ProjectEntriesService(), { prisma: failingDatabase, uploads, circleAccess })
    await expect(failingEntries.keepChatMessage(project.id, saver.id, message.id)).rejects.toThrow("Snapshot commit interrupted")
    expect(attemptedIds).toHaveLength(1)
    expect(await prisma.entry.count({ where: { project_id: project.id } })).toBe(0)
    expect(await prisma.document.count({ where: { docable_type: "Post", docable_id: { in: attemptedIds } } })).toBe(0)
    expect(await prisma.activeStorageAttachment.count({ where: { record_type: "Post", record_id: { in: attemptedIds } } })).toBe(0)
    expect(await prisma.audioAsset.count({ where: { source_type: "Post", source_id: { in: attemptedIds } } })).toBe(0)
    expect(await prisma.videoAsset.count({ where: { source_type: "Post", source_id: { in: attemptedIds } } })).toBe(0)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).updated_at).toEqual(now)
    // Simultaneous requests must return one published snapshot; the unique index is the final arbiter.
    const [saved, repeated] = await Promise.all([entries.keepChatMessage(project.id, saver.id, message.id), entries.keepChatMessage(project.id, saver.id, message.id)])
    expect(repeated.id).toBe(saved.id)
    expect(await prisma.entry.count({ where: { project_id: project.id, source_chat_message_id: message.id, status: "published" } })).toBe(1)
    expect(saved).toMatchObject({ kind: "feedback", source_author_name: "Circle artist", can_edit: false, can_share: false, source_available: true, source_room_id: circle.id })
    const savedAudio = await prisma.audioAsset.findFirstOrThrow({ where: { source_type: "Post", source_id: saved.id } })
    const savedVideo = await prisma.videoAsset.findFirstOrThrow({ where: { source_type: "Post", source_id: saved.id } })
    expect(savedAudio.id).not.toBe(sourceAudio.id)
    expect(savedVideo.id).not.toBe(sourceVideo.id)
    expect(await prisma.entry.findUniqueOrThrow({ where: { id: saved.id } })).not.toHaveProperty("content")
    expect(JSON.stringify(saved.content)).toContain(`/api/v1/video-assets/${savedVideo.id}/poster`)
    expect(await prisma.chatMessage.findUnique({ where: { id: message.id } })).toMatchObject({ body: message.body, content, pinned_at: now, pinned_by_id: saver.id })
    expect(await prisma.reply.findUnique({ where: { id: historicalReply.id } })).toMatchObject({ status: "published" })
    await expect(entries.show(project.id, saved.id, author.id)).rejects.toBeInstanceOf(NotFoundException)
    await expect(entries.show(project.id, saved.id, collaborator.id)).resolves.toMatchObject({ source_available: false, source_room_id: null })
    await expect(audio.getAudioAssetForUser(savedAudio.id, collaborator.id)).resolves.toMatchObject({ source_id: saved.id })

    await prisma.chatMessage.update({ where: { id: message.id }, data: { status: "deleted", body: "Changed later", content: { type: "doc", content: [] } } })
    await prisma.activeStorageAttachment.deleteMany({ where: { record_type: "ChatMessage", record_id: message.id } })
    await Promise.all(blobIds.map(id => images.purgeOrphan(id)))
    const retained = await entries.keepChatMessage(project.id, saver.id, message.id)
    expect(retained).toMatchObject({ id: saved.id, content: saved.content, source_author_name: "Circle artist", source_available: false })
    expect(await prisma.activeStorageBlob.count({ where: { id: { in: blobIds } } })).toBe(3)
    await expect(audio.getAudioAssetForUser(savedAudio.id, saver.id)).resolves.toMatchObject({ waveform_peaks: [0.2, 0.7] })
    await expect(video.getVideoAssetForUser(savedVideo.id, saver.id)).resolves.toMatchObject({ width: 640 })
    expect(await storage.exists(imageBlob.key)).toBe(true)
    await prisma.projectParticipation.deleteMany({ where: { project_id: project.id, user_id: collaborator.id } })
    await expect(entries.show(project.id, saved.id, collaborator.id)).rejects.toBeInstanceOf(NotFoundException)
    await expect(audio.getAudioAssetForUser(savedAudio.id, collaborator.id)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(video.getVideoAssetForUser(savedVideo.id, collaborator.id)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(uploads.streamUpload(imageBlob.id, collaborator.id)).rejects.toBeInstanceOf(NotFoundException)
  } finally {
    const postIds = projectId ? (await prisma.entry.findMany({ where: { project_id: projectId }, select: { id: true } })).map(post => post.id) : []
    const sources = [{ source_type: "Post", source_id: { in: postIds } }, ...(messageId ? [{ source_type: "ChatMessage", source_id: messageId }] : [])]
    await prisma.activeStorageAttachment.deleteMany({ where: { OR: [{ record_type: "Post", record_id: { in: postIds } }, ...(messageId ? [{ record_type: "ChatMessage", record_id: messageId }] : [])] } })
    await prisma.audioAsset.deleteMany({ where: { OR: sources } })
    await prisma.videoAsset.deleteMany({ where: { OR: sources } })
    await prisma.document.deleteMany({ where: { docable_type: "Post", docable_id: { in: postIds } } })
    await prisma.entry.deleteMany({ where: { id: { in: postIds } } })
    if (messageId) { await prisma.reply.deleteMany({ where: { chat_message_id: messageId } }); await prisma.chatMessage.delete({ where: { id: messageId } }) }
    if (projectId) await prisma.project.delete({ where: { id: projectId } })
    if (targetRoomId) { await prisma.roomMembership.deleteMany({ where: { room_id: targetRoomId } }); await prisma.room.delete({ where: { id: targetRoomId } }) }
    await prisma.activeStorageBlob.deleteMany({ where: { id: { in: blobIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await Promise.all([prisma.$disconnect(), rm(root, { recursive: true, force: true })])
  }
}, 30_000)

it("keeps visible Chat text without following a malformed private Project link", async () => {
  const prisma = new PrismaService(), now = new Date(), rollback = Error("rollback private chat link")
  try {
    await prisma.$transaction(async tx => {
      const database = new Proxy(tx, { get(target, key) { return key === "$transaction" ? (callback: (client: typeof tx) => unknown) => callback(tx) : Reflect.get(target, key) } })
      const users = await tx.user.createManyAndReturn({ data: ["saver", "author"].map(username => ({ username, email: `${crypto.randomUUID()}@private-chat-link.test`, created_at: now, updated_at: now })) })
      const [saver, author] = users
      const room = await tx.room.create({ data: { name: "Visible Room", owner_id: saver.id, created_at: now, updated_at: now } })
      await tx.roomMembership.create({ data: { user_id: saver.id, room_id: room.id, created_at: now, updated_at: now } })
      const destination = await tx.project.create({ data: { name: "Saved", owner_id: saver.id, created_at: now, updated_at: now } })
      const privateProject = await tx.project.create({ data: { name: "Private", owner_id: author.id, created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { project_id: privateProject.id, user_id: author.id, status: "published", creation_origin: "project_material", created_at: now, updated_at: now } })
      const secret = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Private material" }] }] }
      const sourceDocument = await tx.document.create({ data: { docable_type: "Post", docable_id: source.id, content: secret, created_at: now, updated_at: now } })
      const message = await tx.chatMessage.create({ data: { room_id: room.id, author_id: author.id, entry_id: source.id, body: "Visible discussion", masked_alias: "author", fire_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })
      const access = new RoomAccessService(); Object.assign(access, { prisma: database })
      const uploads = new UploadsService(); Object.assign(uploads, { prisma: database, circleAccess: access })
      const entries = new ProjectEntriesService(); Object.assign(entries, { prisma: database, circleAccess: access, uploads })
      const saved = await entries.keepChatMessage(destination.id, saver.id, message.id)
      expect(saved.source_shared_entry_id).toBeNull()
      expect(JSON.stringify(saved.content)).toContain("Visible discussion")
      expect(JSON.stringify(saved.content)).not.toContain("Private material")
      expect(await tx.document.findUniqueOrThrow({ where: { id: sourceDocument.id } })).toEqual(sourceDocument)
      expect(await tx.entry.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source)
      throw rollback
    })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
