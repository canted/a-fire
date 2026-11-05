import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { ProjectEntriesService } from "@server/api/v1/projects/project-entries.service"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { ImageVariantsService } from "@server/uploads/images/image-variants.service"
import { AudioAssetsService } from "@server/api/v1/audio-assets/audio-assets.service"

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

it("persists selected copies, explicit feedback and immutable origins through the canonical snapshot owner", async () => {
  const prisma = new PrismaClient(), rollback = new Error("rollback sharing fixtures")
  try {
    await prisma.$transaction(async tx => {
      const now = new Date(), prefix = randomUUID()
      const owner = await tx.user.create({ data: { email: `${prefix}@example.test`, username: prefix, created_at: now, updated_at: now } })
      const reviewer = await tx.user.create({ data: { email: `${prefix}-reply@example.test`, username: "Reviewer", created_at: now, updated_at: now } })
      const circle = await tx.room.create({ data: { name: "Sharing test", owner_id: owner.id, created_at: now, updated_at: now } })
      await tx.roomMembership.createMany({ data: [owner, reviewer].map(user => ({ room_id: circle.id, user_id: user.id, disabled: false, created_at: now, updated_at: now })) })
      const project = await tx.project.create({ data: { owner_id: owner.id, name: "Private", created_at: now, updated_at: now } })
      const source = await tx.entry.create({ data: { user_id: owner.id, project_id: project.id, creation_origin: "project_material", status: "published", project_intent: "Do not share title", project_question: "Whole body", project_lyrics: "Lyrics", created_at: now, updated_at: now } })
      await tx.document.create({ data: { docable_type: "Post", docable_id: source.id, content: doc("Source text"), created_at: now, updated_at: now } })
      const priorCopy = await tx.entry.create({ data: { user_id: owner.id, room_id: circle.id, source_entry_id: source.id, status: "published", created_at: now, updated_at: now } })
      const reply = await tx.reply.create({ data: { entry_id: priorCopy.id, user_id: reviewer.id, status: "published", created_at: now, updated_at: now } })
      const image = await tx.activeStorageBlob.create({ data: { key: `${prefix}-image`, filename: "feedback.png", content_type: "image/png", byte_size: 32, service_name: "test", created_at: now } })
      const recording = await tx.activeStorageBlob.create({ data: { key: `${prefix}-audio`, filename: "feedback.mp4", content_type: "audio/mp4", byte_size: 64, service_name: "test", created_at: now } })
      await tx.activeStorageAttachment.createMany({ data: [image, recording].map(blob => ({ blob_id: blob.id, record_type: "Reply", record_id: reply.id, name: blob.id === image.id ? "image" : "audio", created_at: now })) })
      const originalAudio = await tx.audioAsset.create({ data: { blob_id: recording.id, owner_id: reviewer.id, source_type: "Reply", source_id: reply.id, title: "Feedback recording", original_filename: "feedback.mp4", processing_status: "ready", waveform_peaks: [0.2, 0.8], duration_ms: 1500, created_at: now, updated_at: now } })
      const feedback = { type: "doc", content: [...doc("Saved feedback").content, { type: "image", attrs: { src: `/api/v1/uploads/${image.id}` } }, { type: "audio", attrs: { audioAssetId: originalAudio.id } }] }
      await tx.document.create({ data: { docable_type: "Reply", docable_id: reply.id, content: feedback, created_at: now, updated_at: now } })
      const scoped = Object.assign(Object.create(tx), { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) })
      const access = new RoomAccessService(); Object.assign(access, { prisma: scoped })
      const images = new ImageVariantsService(); Object.assign(images, { prisma: scoped })
      const uploads = new UploadsService(); Object.assign(uploads, { prisma: scoped, circleAccess: access, images })
      const audio = new AudioAssetsService(); Object.assign(audio, { prisma: scoped, circleAccess: access })
      const entries = new ProjectEntriesService(); Object.assign(entries, { prisma: scoped, circleAccess: access, uploads })
      const kept = await entries.keep(project.id, owner.id, reply.id)
      expect(kept).toMatchObject({ source_entry_id: source.id, source_room_id: circle.id, source_author_id: reviewer.id })
      const keptAudio = await tx.audioAsset.findFirstOrThrow({ where: { source_type: "Post", source_id: kept.id } })
      expect(keptAudio.id).not.toBe(originalAudio.id)
      expect(keptAudio).toMatchObject({ owner_id: owner.id, blob_id: recording.id, waveform_peaks: [0.2, 0.8] })
      const forged = { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { targetType: "note", targetId: "2147483647", label: "Unavailable" } }] }] }
      for (const target of [source.id, kept.id]) {
        const original = await tx.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: target } } })
        await tx.document.update({ where: { id: original.id }, data: { content: forged } })
        const selection = await entries.shareSelection(project.id, source.id, owner.id, circle.id)
        const before = { entries: await tx.entry.count(), documents: await tx.document.count(), audio: await tx.audioAsset.count(), attachments: await tx.activeStorageAttachment.count() }
        await expect(entries.shareDraft(project.id, source.id, owner.id, { room_id: circle.id, source_revision: selection.revision, selected_unit_ids: [target === source.id ? "body" : `feedback:${kept.id}`], request_key: randomUUID() })).rejects.toThrow("Mention unavailable")
        expect({ entries: await tx.entry.count(), documents: await tx.document.count(), audio: await tx.audioAsset.count(), attachments: await tx.activeStorageAttachment.count() }).toEqual(before)
        await tx.document.update({ where: { id: original.id }, data: { content: original.content! } })
      }
      const manifest = await entries.shareSelection(project.id, source.id, owner.id, circle.id)
      const input = { room_id: circle.id, source_revision: manifest.revision, selected_unit_ids: ["body", `feedback:${kept.id}`], request_key: randomUUID(), room_statement: "Listen to this version" }
      expect(await entries.findShare(project.id, source.id, owner.id, input.request_key)).toBeNull()
      const first = await entries.shareDraft(project.id, source.id, owner.id, input)
      expect(await entries.shareDraft(project.id, source.id, owner.id, input)).toEqual(first)
      expect(await entries.findShare(project.id, source.id, owner.id, input.request_key)).toMatchObject({ entry_id: first.entry_id, room_id: circle.id })
      await expect(entries.findShare(project.id, source.id, reviewer.id, input.request_key)).rejects.toThrow()
      const copy = await tx.entry.findUniqueOrThrow({ where: { id: first.entry_id } })
      expect(copy).toMatchObject({ project_id: null, source_entry_id: source.id, room_statement: input.room_statement, format_data: {}, source_room_ids: [circle.id] })
      expect(copy.shared_feedback).toEqual([expect.objectContaining({ author_name: "Reviewer", source_reply_id: reply.id, source_room_id: circle.id, content: expect.objectContaining({ type: "doc" }) })])
      const sharedAudio = await tx.audioAsset.findFirstOrThrow({ where: { source_type: "Post", source_id: copy.id } })
      expect(sharedAudio.id).not.toBe(keptAudio.id)
      expect(JSON.stringify(copy.shared_feedback)).toContain(`"audioAssetId":${sharedAudio.id}`)
      expect(JSON.stringify(copy.shared_feedback)).not.toContain('"project_id"')
      expect(copy).not.toHaveProperty("content")
      const copyDocument = await tx.document.findUniqueOrThrow({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: copy.id } } })
      expect(JSON.stringify(copyDocument.content)).not.toContain("Do not share title")
      expect(JSON.stringify(copyDocument.content)).toContain("Lyrics")
      expect(await tx.entry.count({ where: { user_id: owner.id, share_request_key: input.request_key } })).toBe(1)
      await tx.reply.delete({ where: { id: reply.id } })
      await tx.activeStorageAttachment.deleteMany({ where: { record_type: "Reply", record_id: reply.id } })
      await tx.audioAsset.delete({ where: { id: originalAudio.id } })
      expect(await entries.show(project.id, kept.id, owner.id)).toMatchObject({ source_available: false, source_entry_id: source.id, source_author_name: "Reviewer", content: expect.objectContaining({ content: expect.arrayContaining([{ type: "audio", attrs: { audioAssetId: keptAudio.id } }]) }) })
      await expect(audio.getAudioAssetForUser(keptAudio.id, owner.id)).resolves.toMatchObject({ source_id: kept.id, waveform_peaks: [0.2, 0.8] })
      expect(await tx.activeStorageAttachment.count({ where: { record_type: "Post", record_id: kept.id, blob_id: { in: [image.id, recording.id] } } })).toBe(2)
      expect((await entries.keep(project.id, owner.id, reply.id)).id).toBe(kept.id)
      const changed = await entries.shareSelection(project.id, source.id, owner.id, circle.id)
      expect(changed.units.find(unit => unit.id === `feedback:${kept.id}`)?.eligible).toBe(false)
      throw rollback
    }, { timeout: 30_000 })
  } catch (error) { if (error !== rollback) throw error } finally { await prisma.$disconnect() }
}, 40_000)

it("recovers one private source for concurrent creation retries without moving or replacing it", async () => {
  const prisma = new PrismaClient(), now = new Date(), key = randomUUID()
  const users: number[] = [], projects: number[] = []
  try {
    const owner = await prisma.user.create({ data: { email: `${key}@example.test`, username: key, created_at: now, updated_at: now } })
    users.push(owner.id)
    for (const name of ["Original project", "Different project"]) {
      const project = await prisma.project.create({ data: { owner_id: owner.id, name, created_at: now, updated_at: now } })
      projects.push(project.id)
    }
    const entries = new ProjectEntriesService(); Object.assign(entries, { prisma })
    const input = { fresh: true, request_key: key }
    const [first, retried] = await Promise.all([entries.create(projects[0], owner.id, input), entries.create(projects[0], owner.id, input)])
    expect(first.id).toBe(retried.id)
    expect(await prisma.entry.count({ where: { user_id: owner.id, creation_request_key: key } })).toBe(1)
    await prisma.entry.update({ where: { id: first.id }, data: { status: "published", project_intent: "Persisted private title" } })
    expect(await entries.create(projects[0], owner.id, input)).toMatchObject({ id: first.id, intent: "Persisted private title", status: "published" })
    await expect(entries.create(projects[1], owner.id, input)).rejects.toThrow("no longer available")
    await prisma.entry.update({ where: { id: first.id }, data: { status: "deleted" } })
    await expect(entries.create(projects[0], owner.id, input)).rejects.toThrow("no longer available")
    expect(await prisma.entry.count({ where: { user_id: owner.id, creation_request_key: key } })).toBe(1)
  } finally {
    await prisma.entry.deleteMany({ where: { project_id: { in: projects } } })
    await prisma.project.deleteMany({ where: { id: { in: projects } } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  }
}, 30_000)
