import { BossService } from "@server/queue/boss.service"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ForbiddenException, NotFoundException } from "@nestjs/common"
import { PrismaService } from "@server/prisma/prisma.service"
import { StorageService } from "@server/storage/storage.service"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { AudioAssetsService } from "@server/api/v1/audio-assets/audio-assets.service"
import { VideoAssetsService } from "@server/api/v1/video-assets/video-assets.service"
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs"
import { withTestDependencies } from "@tests/backend/helpers/service"

it("retains snapshot media after source deletion and revokes all private media when a member leaves", async () => {
  loadTestEnvironment({ requireDatabase: true })
  const prisma = new PrismaService()
  const root = await mkdtemp(path.join(os.tmpdir(), "afire-project-snapshot-"))
  const storage = withTestDependencies(new StorageService(), { localRoot: root, useS3: false })
  const images = withTestDependencies(new ImageVariantsService(), { prisma, storage })
  const circleAccess = { resolve: vi.fn(async () => ({ kind: "member" })) }
  const boss = new BossService()
  const jobIds: string[] = []
  const uploads = withTestDependencies(new UploadsService(), { prisma, storage, images, circleAccess, boss })
  const audio = withTestDependencies(new AudioAssetsService(), { prisma, storage, circleAccess })
  const video = withTestDependencies(new VideoAssetsService(), { prisma, storage, circleAccess })
  const now = new Date(), suffix = crypto.randomUUID()
  let projectId: number | undefined
  const userIds: number[] = [], postIds: number[] = [], blobIds: number[] = []
  try {
    const owner = await prisma.user.create({ data: { email: `snapshot-owner-${suffix}@example.test`, username: `owner-${suffix}`, created_at: now, updated_at: now } })
    const member = await prisma.user.create({ data: { email: `snapshot-member-${suffix}@example.test`, username: `member-${suffix}`, created_at: now, updated_at: now } })
    userIds.push(owner.id, member.id)
    const project = await prisma.project.create({ data: { name: "Snapshot retention", owner_id: owner.id, created_at: now, updated_at: now } })
    projectId = project.id
    const participation = await prisma.projectParticipation.create({ data: { project_id: project.id, user_id: member.id, invited_by_id: owner.id, status: "accepted", invited_at: now, created_at: now, updated_at: now } })
    const source = await prisma.entry.create({ data: { project_id: project.id, user_id: member.id, status: "published", creation_origin: "project_material", format: "mixed_media", created_at: now, updated_at: now } })
    const target = await prisma.entry.create({ data: { project_id: project.id, user_id: owner.id, status: "draft", creation_origin: "project_feedback", format: "mixed_media", created_at: now, updated_at: now } })
    postIds.push(source.id, target.id)
    const makeBlob = async (name: string) => {
      const key = `snapshot-${suffix}-${name}`
      await storage.put(key, Buffer.from(name))
      const blob = await prisma.activeStorageBlob.create({ data: { key, filename: name, content_type: name === "image" ? "image/png" : `${name}/mp4`, byte_size: name.length, service_name: "test", created_at: now } })
      blobIds.push(blob.id)
      await prisma.activeStorageAttachment.create({ data: { record_type: "Post", record_id: source.id, blob_id: blob.id, name, created_at: now } })
      return blob
    }
    const imageBlob = await makeBlob("image"), audioBlob = await makeBlob("audio"), videoBlob = await makeBlob("video")
    const base = { owner_id: member.id, source_type: "Post", source_id: source.id, title: "Practice", original_filename: "practice.mp4", processing_status: "ready", created_at: now, updated_at: now }
    const sourceAudio = await prisma.audioAsset.create({ data: { ...base, blob_id: audioBlob.id, waveform_peaks: [0.2, 0.7], duration_ms: 1800 } })
    const sourceVideo = await prisma.videoAsset.create({ data: { ...base, blob_id: videoBlob.id, width: 640, height: 360, duration_ms: 1800 } })
    const content = { type: "doc", content: [{ type: "image", attrs: { src: `/api/v1/uploads/${imageBlob.id}` } }, { type: "audio", attrs: { audioAssetId: sourceAudio.id } }, { type: "video", attrs: { videoAssetId: sourceVideo.id, thumbnailUrl: `/api/v1/video-assets/${sourceVideo.id}/poster` } }] }
    await boss.start()
    const enqueue = boss.enqueueInTransaction.bind(boss)
    const fault = vi.spyOn(boss, "enqueueInTransaction").mockImplementation(async (...args) => {
      const id = await enqueue(...args)
      jobIds.push(id)
      throw new Error("Snapshot queue failure")
    })
    try {
      for (const kind of ["audio", "video"] as const) {
        const sourceAsset = kind === "audio" ? sourceAudio : sourceVideo
        if (kind === "audio") await prisma.audioAsset.update({ where: { id: sourceAsset.id }, data: { processing_status: "pending" } })
        else await prisma.videoAsset.update({ where: { id: sourceAsset.id }, data: { processing_status: "pending" } })
        const selected = { type: "doc", content: [{ type: kind, attrs: { [kind === "audio" ? "audioAssetId" : "videoAssetId"]: sourceAsset.id } }] }
        await expect(uploads.copyContentSnapshot(owner.id, { sourceType: "Post", sourceId: source.id }, target.id, selected, null)).rejects.toThrow("Snapshot queue failure")
        expect(await prisma.audioAsset.count({ where: { source_type: "Post", source_id: target.id } })).toBe(0)
        expect(await prisma.videoAsset.count({ where: { source_type: "Post", source_id: target.id } })).toBe(0)
        expect(await prisma.activeStorageAttachment.count({ where: { record_type: "Post", record_id: target.id } })).toBe(0)
        expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${jobIds.at(-1)}::uuid`).toEqual([])
        if (kind === "audio") await prisma.audioAsset.update({ where: { id: sourceAsset.id }, data: { processing_status: "ready" } })
        else await prisma.videoAsset.update({ where: { id: sourceAsset.id }, data: { processing_status: "ready" } })
      }
      await prisma.audioAsset.update({ where: { id: sourceAudio.id }, data: { processing_status: "pending" } })
      await prisma.videoAsset.update({ where: { id: sourceVideo.id }, data: { processing_status: "pending" } })
      fault.mockImplementation(async (...args) => {
        const id = await enqueue(...args)
        jobIds.push(id)
        if (args[1] === "uploads.video") throw new Error("Second asset failed")
        return id
      })
      await expect(uploads.copyContentSnapshot(owner.id, { sourceType: "Post", sourceId: source.id }, target.id, content, null)).rejects.toThrow("Second asset failed")
      expect(await prisma.audioAsset.count({ where: { source_type: "Post", source_id: target.id } })).toBe(0)
      expect(await prisma.videoAsset.count({ where: { source_type: "Post", source_id: target.id } })).toBe(0)
      expect(await prisma.activeStorageAttachment.count({ where: { record_type: "Post", record_id: target.id } })).toBe(0)
      for (const id of jobIds) expect(await prisma.$queryRaw`SELECT id FROM pgboss.job WHERE id = ${id}::uuid`).toEqual([])
      await prisma.audioAsset.update({ where: { id: sourceAudio.id }, data: { processing_status: "ready" } })
      await prisma.videoAsset.update({ where: { id: sourceVideo.id }, data: { processing_status: "ready" } })
    } finally { fault.mockRestore() }
    const copied = await uploads.copyContentSnapshot(owner.id, { sourceType: "Post", sourceId: source.id }, target.id, content, { audio_asset_id: sourceAudio.id, video_asset_id: sourceVideo.id })
    const format = copied.formatData as { audio_asset_id: number; video_asset_id: number }
    expect(format.audio_asset_id).not.toBe(sourceAudio.id)
    expect(format.video_asset_id).not.toBe(sourceVideo.id)
    expect(JSON.stringify(copied.content)).toContain(`/api/v1/video-assets/${format.video_asset_id}/poster`)
    await prisma.entry.update({ where: { id: target.id }, data: { status: "published" } })
    await expect(audio.getAudioAssetForUser(sourceAudio.id, member.id)).resolves.toHaveProperty("id", sourceAudio.id)
    await prisma.projectParticipation.delete({ where: { id: participation.id } })
    await expect(audio.getAudioAssetForUser(sourceAudio.id, member.id)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(video.getVideoAssetForUser(sourceVideo.id, member.id)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(uploads.streamUpload(imageBlob.id, member.id)).rejects.toBeInstanceOf(NotFoundException)
    await prisma.entry.update({ where: { id: source.id }, data: { status: "deleted" } })
    await prisma.activeStorageAttachment.deleteMany({ where: { record_type: "Post", record_id: source.id } })
    await Promise.all(blobIds.map(id => images.purgeOrphan(id)))
    expect(await prisma.activeStorageBlob.count({ where: { id: { in: blobIds } } })).toBe(3)
    await expect(audio.getAudioAssetForUser(format.audio_asset_id, owner.id)).resolves.toMatchObject({ source_id: target.id, waveform_peaks: [0.2, 0.7] })
    await expect(video.getVideoAssetForUser(format.video_asset_id, owner.id)).resolves.toMatchObject({ source_id: target.id, width: 640 })
    expect(await storage.exists(imageBlob.key)).toBe(true)
  } finally {
    await boss.onModuleDestroy()
    for (const id of jobIds) await prisma.$executeRaw`DELETE FROM pgboss.job WHERE id = ${id}::uuid`
    await prisma.activeStorageAttachment.deleteMany({ where: { record_type: "Post", record_id: { in: postIds } } })
    await prisma.audioAsset.deleteMany({ where: { source_type: "Post", source_id: { in: postIds } } })
    await prisma.videoAsset.deleteMany({ where: { source_type: "Post", source_id: { in: postIds } } })
    await prisma.entry.deleteMany({ where: { id: { in: postIds } } })
    if (projectId) await prisma.project.delete({ where: { id: projectId } })
    await prisma.activeStorageBlob.deleteMany({ where: { id: { in: blobIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await Promise.all([prisma.$disconnect(), rm(root, { recursive: true, force: true })])
  }
}, 30_000)
