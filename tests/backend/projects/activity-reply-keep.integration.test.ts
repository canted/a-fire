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

it("keeps activity feedback into an unrelated project without exposing its private source, retaining media independently", async () => {
  const prisma = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-reply-keep-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const images = withTestDependencies(new ImageVariantsService(), { prisma, storage })
  const circleAccess = withTestDependencies(new RoomAccessService(), { prisma })
  const uploads = withTestDependencies(new UploadsService(), { prisma, storage, images, circleAccess, boss: { enqueue: vi.fn() } })
  const entries = withTestDependencies(new ProjectEntriesService(), { prisma, uploads, circleAccess })
  const audio = withTestDependencies(new AudioAssetsService(), { prisma, storage, circleAccess })
  const video = withTestDependencies(new VideoAssetsService(), { prisma, storage, circleAccess })
  const now = new Date(), suffix = crypto.randomUUID()
  const userIds: number[] = [], blobIds: number[] = [], projectIds: number[] = [], postIds: number[] = []
  let targetRoomId: number | undefined, replyId: number | undefined
  try {
    const users = await Promise.all(["saver", "author", "pending", "collaborator"].map(role => prisma.user.create({ data: { email: `${role}-${suffix}@reply-keep.test`, username: role, created_at: now, updated_at: now } })))
    userIds.push(...users.map(user => user.id))
    const [saver, author, pending, collaborator] = users
    const circle = await prisma.room.create({ data: { name: "Activity circle", owner_id: author.id, created_at: now, updated_at: now } })
    targetRoomId = circle.id
    await prisma.roomMembership.createMany({ data: [saver, author].map(user => ({ room_id: circle.id, user_id: user.id, username_override: user.id === author.id ? "Circle musician" : null, disabled: false, created_at: now, updated_at: now })) })
    const sourceProject = await prisma.project.create({ data: { name: "Private source", owner_id: author.id, created_at: now, updated_at: now } })
    const targetProject = await prisma.project.create({ data: { name: "Saved ideas", owner_id: saver.id, created_at: now, updated_at: now } })
    projectIds.push(sourceProject.id, targetProject.id)
    await prisma.projectParticipation.createMany({ data: [pending, collaborator].map(user => ({ project_id: targetProject.id, user_id: user.id, invited_by_id: saver.id, status: user.id === pending.id ? "pending" : "accepted", invited_at: now, created_at: now, updated_at: now })) })
    const original = await prisma.entry.create({ data: { project_id: sourceProject.id, user_id: author.id, creation_origin: "project_material", status: "published", project_intent: "Private title", created_at: now, updated_at: now } })
    const copy = await prisma.entry.create({ data: { room_id: circle.id, source_entry_id: original.id, user_id: author.id, status: "published", created_at: now, updated_at: now } })
    postIds.push(original.id, copy.id)
    const reply = await prisma.reply.create({ data: { entry_id: copy.id, user_id: author.id, status: "published", created_at: now, updated_at: now } })
    replyId = reply.id
    const makeBlob = async (name: string) => {
      const key = `reply-keep-${suffix}-${name}`
      await storage.put(key, Buffer.from(name))
      const blob = await prisma.activeStorageBlob.create({ data: { key, filename: name, content_type: name === "image" ? "image/png" : `${name}/mp4`, byte_size: name.length, service_name: "test", created_at: now } })
      blobIds.push(blob.id)
      await prisma.activeStorageAttachment.create({ data: { record_type: "Reply", record_id: reply.id, blob_id: blob.id, name, created_at: now } })
      return blob
    }
    const imageBlob = await makeBlob("image"), audioBlob = await makeBlob("audio"), videoBlob = await makeBlob("video")
    const base = { owner_id: author.id, source_type: "Reply", source_id: reply.id, title: "Feedback", original_filename: "idea.mp4", processing_status: "ready", created_at: now, updated_at: now }
    const sourceAudio = await prisma.audioAsset.create({ data: { ...base, blob_id: audioBlob.id, waveform_peaks: [0.2, 0.7] } })
    const sourceVideo = await prisma.videoAsset.create({ data: { ...base, blob_id: videoBlob.id, width: 640, height: 360 } })
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Give this phrase more room" }] }, { type: "image", attrs: { src: `/api/v1/uploads/${imageBlob.id}` } }, { type: "audio", attrs: { audioAssetId: sourceAudio.id } }, { type: "video", attrs: { videoAssetId: sourceVideo.id } }] }
    await prisma.document.create({ data: { docable_type: "Reply", docable_id: reply.id, content, version: 1, created_at: now, updated_at: now } })
    await expect(entries.show(sourceProject.id, original.id, saver.id)).rejects.toBeInstanceOf(NotFoundException)
    await expect(entries.keep(targetProject.id, pending.id, reply.id)).rejects.toBeInstanceOf(NotFoundException)
    await expect(entries.keep(targetProject.id, collaborator.id, reply.id)).rejects.toBeInstanceOf(ForbiddenException)
    const transact = prisma.$transaction.bind(prisma)
    for (const change of ["reply", "parent", "document"]) {
      const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
        if (change === "reply") await prisma.reply.update({ where: { id: reply.id }, data: { status: "deleted" } })
        if (change === "parent") await prisma.entry.update({ where: { id: copy.id }, data: { status: "deleted" } })
        if (change === "document") await prisma.document.update({ where: { docable_type_docable_id: { docable_type: "Reply", docable_id: reply.id } }, data: { content: { type: "doc", content: [] } } })
        return transact(callback)
      })
      try {
        await expect(entries.keep(targetProject.id, saver.id, reply.id)).rejects.toThrow(change === "document" ? "This feedback changed before saving" : "Feedback not found")
        expect(transactionSpy).toHaveBeenCalledOnce()
        expect(await prisma.entry.count({ where: { project_id: targetProject.id } })).toBe(0)
      } finally {
        transactionSpy.mockRestore()
        await prisma.reply.update({ where: { id: reply.id }, data: { status: "published" } })
        await prisma.entry.update({ where: { id: copy.id }, data: { status: "published" } })
        await prisma.document.update({ where: { docable_type_docable_id: { docable_type: "Reply", docable_id: reply.id } }, data: { content } })
      }
    }
    const historicalMessage = await prisma.chatMessage.create({ data: { room_id: circle.id, author_id: author.id, entry_id: copy.id, body: "Historical attachment", content, masked_alias: "artist", fire_at: now, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })
    try {
      await prisma.entry.update({ where: { id: copy.id }, data: { creation_origin: "chat_attachment" } })
      const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
        await prisma.chatMessage.update({ where: { id: historicalMessage.id }, data: { expires_at: new Date(Date.now() - 1) } })
        return transact(callback)
      })
      try {
        await expect(entries.keep(targetProject.id, saver.id, reply.id)).rejects.toThrow("Feedback not found")
        expect(transactionSpy).toHaveBeenCalledOnce()
        expect(await prisma.entry.count({ where: { project_id: targetProject.id } })).toBe(0)
      } finally { transactionSpy.mockRestore() }
    } finally {
      await prisma.chatMessage.delete({ where: { id: historicalMessage.id } })
      await prisma.entry.update({ where: { id: copy.id }, data: { creation_origin: copy.creation_origin } })
    }
    const [saved, repeated] = await Promise.all([entries.keep(targetProject.id, saver.id, reply.id), entries.keep(targetProject.id, saver.id, reply.id)])
    expect(repeated.id).toBe(saved.id)
    expect(saved).toMatchObject({ kind: "feedback", source_entry_id: null, source_shared_entry_id: copy.id, source_reply_id: reply.id, source_author_name: "Circle musician", source_available: true, can_edit: false })
    expect(JSON.stringify(saved)).not.toContain("Private title")
    const savedAudio = await prisma.audioAsset.findFirstOrThrow({ where: { source_type: "Post", source_id: saved.id } })
    const savedVideo = await prisma.videoAsset.findFirstOrThrow({ where: { source_type: "Post", source_id: saved.id } })
    expect(savedAudio.id).not.toBe(sourceAudio.id)
    expect(savedVideo.id).not.toBe(sourceVideo.id)
    await expect(entries.show(targetProject.id, saved.id, collaborator.id)).resolves.toMatchObject({ source_available: false })
    await expect(audio.getAudioAssetForUser(savedAudio.id, collaborator.id)).resolves.toMatchObject({ source_id: saved.id })
    await prisma.reply.update({ where: { id: reply.id }, data: { status: "deleted" } })
    await prisma.activeStorageAttachment.deleteMany({ where: { record_type: "Reply", record_id: reply.id } })
    await Promise.all(blobIds.map(id => images.purgeOrphan(id)))
    await expect(entries.keep(targetProject.id, saver.id, reply.id)).resolves.toMatchObject({ id: saved.id, content: saved.content, source_available: false })
    await expect(video.getVideoAssetForUser(savedVideo.id, saver.id)).resolves.toMatchObject({ width: 640 })
    expect(await storage.exists(imageBlob.key)).toBe(true)
    await prisma.projectParticipation.deleteMany({ where: { project_id: targetProject.id, user_id: collaborator.id } })
    await expect(audio.getAudioAssetForUser(savedAudio.id, collaborator.id)).rejects.toBeInstanceOf(ForbiddenException)
  } finally {
    const savedIds = projectIds.length ? (await prisma.entry.findMany({ where: { project_id: { in: projectIds } }, select: { id: true } })).map(post => post.id) : []
    const allPosts = [...new Set([...postIds, ...savedIds])]
    const sources = [{ source_type: "Post", source_id: { in: allPosts } }, ...(replyId ? [{ source_type: "Reply", source_id: replyId }] : [])]
    await prisma.activeStorageAttachment.deleteMany({ where: { OR: [{ record_type: "Post", record_id: { in: allPosts } }, ...(replyId ? [{ record_type: "Reply", record_id: replyId }] : [])] } })
    await prisma.audioAsset.deleteMany({ where: { OR: sources } })
    await prisma.videoAsset.deleteMany({ where: { OR: sources } })
    await prisma.document.deleteMany({ where: { OR: [{ docable_type: "Post", docable_id: { in: allPosts } }, ...(replyId ? [{ docable_type: "Reply", docable_id: replyId }] : [])] } })
    if (replyId) await prisma.reply.delete({ where: { id: replyId } })
    await prisma.entry.deleteMany({ where: { id: { in: allPosts } } })
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } })
    if (targetRoomId) { await prisma.roomMembership.deleteMany({ where: { room_id: targetRoomId } }); await prisma.room.delete({ where: { id: targetRoomId } }) }
    await prisma.activeStorageBlob.deleteMany({ where: { id: { in: blobIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await Promise.all([prisma.$disconnect(), rm(root, { recursive: true, force: true })])
  }
}, 30_000)
