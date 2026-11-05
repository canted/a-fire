import { roomEntryRoomId } from "../entries/room-entry-scope"
import { UPLOAD_ORPHAN_PURGE_QUEUE } from "../../../queue/queue-names"
import { lockActiveRoom } from "../rooms/room-membership-transaction"
import { canEditEntryReply } from "../replies/reply-access"
import { canManageEntryDraft, canReadRoundDraft } from "../entries/entry-draft-access";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import crypto from "node:crypto"
import { PrismaService } from "../../../prisma/prisma.service"
import { BossService } from "../../../queue/boss.service"
import { StorageService } from "../../../storage/storage.service"
import { parseMediaRange, type MediaStreamPayload } from "../../../storage/media-range"
import { isPassThroughAudioContentType, isSupportedAudioContentType } from "../../../uploads/audio/audio-formats"
import { imageVariantKey, imageVariantsForAttachment, isImageVariationDigest } from "../../../uploads/images/image-variants"
import { validateImageUpload } from "../../../uploads/images/image-policy"
import { ImageVariantsService, lockContentBlob } from "../../../uploads/images/image-variants.service"
import { RoomAccessService } from "../rooms/room-access.service"
import { mediaEtag, matchesMediaEtag } from "../../../storage/media-cache"
import { IMAGE_TRANSFORM_VERSION, IMAGE_UPLOAD_MAX_BYTES } from "../../../../types/image-policy"
import { SUPPORTED_VIDEO_CONTENT_TYPES } from "../../../uploads/video/video-formats"
import { videoProcessingJobExpireMinutes } from "../../../uploads/video/video-processing-options"
import { canReadProjectEntry, canViewProject, isProjectEntry } from "../projects/project-access"
import { extractPrivateUploadBlobIds, normalizePrivateUploadUrls } from "./upload-urls"
import type { Prisma } from "@prisma/client"

type UploadTarget = { entry_id?: number; reply_id?: number; page_id?: number; note_id?: number; chat_message_id?: number }
type UploadMetadataInput = { metadata?: string; width?: string; height?: string }
type AttachmentTarget = { record_type: string; record_id: number; name: string }
type ContentSource = { sourceType: "Post" | "Reply" | "Note" | "ChatMessage"; sourceId: number }
type BlobWithContentType = { id: number; content_type: string | null }

const DEFAULT_VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024

@Injectable()
export class UploadsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(BossService)
  private readonly boss!: BossService

  @Inject(StorageService)
  private readonly storage!: StorageService

  @Inject(ImageVariantsService)
  private readonly images!: ImageVariantsService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  /** Validate referenced media before accepting a document from a private project editor. */
  async assertContentMediaAccess(userId: number, content: unknown, formatData: unknown) {
    const references = snapshotReferences([content, formatData])
    for (const blobId of references.blobs) await this.assertCanAccessBlob(userId, blobId)
    for (const [type, ids] of [["audio", references.audio], ["video", references.video]] as const) {
      for (const id of ids) {
        const asset = type === "audio"
          ? await this.prisma.audioAsset.findUnique({ where: { id } })
          : await this.prisma.videoAsset.findUnique({ where: { id } })
        if (!asset || !(await this.canAccessAttachment(userId, { record_type: asset.source_type, record_id: asset.source_id, name: type }))) throw new NotFoundException("Media not found")
      }
    }
  }

  async discardChatDraftMedia(tx: Prisma.TransactionClient, messageId: number) {
    const attachments = await tx.activeStorageAttachment.findMany({ where: { record_type: "ChatMessage", record_id: messageId }, select: { blob_id: true } })
    const audio = await tx.audioAsset.findMany({ where: { source_type: "ChatMessage", source_id: messageId }, select: { blob_id: true } })
    const video = await tx.videoAsset.findMany({ where: { source_type: "ChatMessage", source_id: messageId }, select: { blob_id: true } })
    const blobs = [...new Set([...attachments, ...audio, ...video].map(row => row.blob_id))].sort((a, b) => a - b)
    for (const blob of blobs) await lockContentBlob(tx, blob)
    await tx.audioAsset.deleteMany({ where: { source_type: "ChatMessage", source_id: messageId } })
    await tx.videoAsset.deleteMany({ where: { source_type: "ChatMessage", source_id: messageId } })
    await tx.activeStorageAttachment.deleteMany({ where: { record_type: "ChatMessage", record_id: messageId } })
    return blobs
  }

  async purgeDiscardedBlobs(blobIds: number[]) {
    for (const blob of blobIds) await this.images.purgeOrphan(blob)
  }

  /** Promote the message's selected uploads into its Entry without changing playback IDs.
   * The message row lock and this transaction make publication and ownership indivisible. */
  async bindChatEntryMedia(tx: Prisma.TransactionClient, messageId: number, postId: number, content: unknown) {
    const references = snapshotReferences(content)
    const assets = [
      ...await tx.audioAsset.findMany({ where: { id: { in: [...references.audio] } } }).then(rows => rows.map(asset => ({ ...asset, kind: "audio" as const }))),
      ...await tx.videoAsset.findMany({ where: { id: { in: [...references.video] } } }).then(rows => rows.map(asset => ({ ...asset, kind: "video" as const }))),
    ]
    if (assets.length !== references.audio.size + references.video.size) throw new BadRequestException("Attachment is unavailable")
    for (const asset of assets) {
      if (!((asset.source_type === "ChatMessage" && asset.source_id === messageId) || (asset.source_type === "Post" && asset.source_id === postId))) throw new BadRequestException("Attachment does not belong to this message")
      references.blobs.add(asset.blob_id)
    }
    for (const blobId of [...references.blobs].sort((a, b) => a - b)) {
      await lockContentBlob(tx, blobId)
      const attached = await tx.activeStorageAttachment.findMany({ where: { blob_id: blobId, OR: [{ record_type: "ChatMessage", record_id: messageId }, { record_type: "Post", record_id: postId }] } })
      if (!attached.length) {
        const asset = assets.find(candidate => candidate.blob_id === blobId)
        if (!asset) throw new BadRequestException("Attachment does not belong to this message")
        // Audio/video ownership is canonical on the asset even before a processor
        // has produced attachment rows. The validated asset is sufficient proof.
        await tx.activeStorageAttachment.create({ data: { blob_id: blobId, record_type: "Post", record_id: postId, name: asset.kind, created_at: new Date() } })
      }
      await tx.activeStorageAttachment.updateMany({ where: { blob_id: blobId, record_type: "ChatMessage", record_id: messageId }, data: { record_type: "Post", record_id: postId } })
    }
    await tx.audioAsset.updateMany({ where: { id: { in: [...references.audio] }, source_type: "ChatMessage", source_id: messageId }, data: { source_type: "Post", source_id: postId } })
    await tx.videoAsset.updateMany({ where: { id: { in: [...references.video] }, source_type: "ChatMessage", source_id: messageId }, data: { source_type: "Post", source_id: postId } })
  }

  /** Copy only selected media; target ownership and retained attachments are independent of the source. */
  async copyContentSnapshot(userId: number, source: { sourceType: "Post" | "Reply" | "ChatMessage"; sourceId: number }, targetPostId: number, content: unknown, formatData: unknown, transaction?: Prisma.TransactionClient): Promise<{ content: unknown; formatData: unknown }> {
    if (!transaction) {
      return this.prisma.$transaction(tx => this.copyContentSnapshot(userId, source, targetPostId, content, formatData, tx), { timeout: 30_000, maxWait: 10_000 })
    }
    const db = transaction
    if (!(await this.canAccessAttachment(userId, { record_type: source.sourceType, record_id: source.sourceId, name: "snapshot" }))) throw new NotFoundException("Source not found")
    const target = await db.entry.findUnique({ where: { id: targetPostId } })
    const ownFeedbackDraft = target && isProjectEntry(target) && target.creation_origin === "project_feedback" && target.status === "draft" && target.user_id === userId && await canViewProject(this.prisma, target.project_id!, userId)
    if (!target || (!ownFeedbackDraft && !(await canManageEntryDraft(this.prisma, this.circleAccess, target, userId)))) throw new ForbiddenException("Forbidden")
    const normalizedContent = normalizePrivateUploadUrls(content).value
    const normalizedFormatData = normalizePrivateUploadUrls(formatData).value
    const references = snapshotReferences([normalizedContent, normalizedFormatData])
    // Every selected asset, attachment and processing job joins one transaction.
    // Lock the complete blob set in the same order as Chat publication.
    const audio = await db.audioAsset.findMany({ where: { id: { in: [...references.audio] } }, select: { blob_id: true } })
    const video = await db.videoAsset.findMany({ where: { id: { in: [...references.video] } }, select: { blob_id: true } })
    const blobIds = new Set([...references.blobs, ...audio.map(row => row.blob_id), ...video.map(row => row.blob_id)])
    for (const blobId of [...blobIds].sort((a, b) => a - b)) await lockContentBlob(transaction, blobId)
    const audioMap = new Map<number, number>()
    const videoMap = new Map<number, number>()
    const blobs = new Map<number, string>()
    for (const id of references.blobs) {
      const attachment = await db.activeStorageAttachment.findFirst({ where: { blob_id: id, OR: [{ record_type: "Post", record_id: targetPostId }, { record_type: source.sourceType, record_id: source.sourceId }] } })
      if (!attachment) throw new BadRequestException("Selected image is not attached to this material")
      if (attachment.record_type !== "Post" || attachment.record_id !== targetPostId) blobs.set(id, attachment.name)
    }
    for (const [type, ids, mapping] of [["audio", references.audio, audioMap], ["video", references.video, videoMap]] as const) {
      for (const id of ids) {
        const asset = type === "audio"
          ? await db.audioAsset.findUnique({ where: { id } })
          : await db.videoAsset.findUnique({ where: { id } })
        if (asset?.source_type === "Post" && asset.source_id === targetPostId) {
          blobs.delete(asset.blob_id)
          continue
        }
        if (!asset || asset.source_type !== source.sourceType || asset.source_id !== source.sourceId) throw new BadRequestException("Selected media is not attached to this material")
        const { id: _id, ...data } = asset
        const now = new Date()
        const common = { ...data, owner_id: userId, source_type: "Post", source_id: targetPostId, created_at: now, updated_at: now }
        if (!(await db.activeStorageBlob.findUnique({ where: { id: asset.blob_id } }))) throw new NotFoundException("Media not found")
        const copied = type === "audio"
          ? await db.audioAsset.create({ data: { ...common, waveform_peaks: (asset as { waveform_peaks?: unknown }).waveform_peaks as Prisma.InputJsonValue | undefined } })
          : await db.videoAsset.create({ data: common })
        await db.activeStorageAttachment.create({ data: { blob_id: asset.blob_id, record_type: "Post", record_id: targetPostId, name: type, created_at: now } })
        if (asset.processing_status !== "ready" && asset.processing_status !== "failed") {
          const queue = type === "audio" ? "uploads.audio" : "uploads.video"
          const payload = type === "audio" ? { audioAssetId: copied.id } : { videoAssetId: copied.id }
          await this.boss.enqueueInTransaction(db, queue, payload)
        }
        mapping.set(id, copied.id)
        blobs.delete(asset.blob_id)
      }
    }
    for (const [blobId, name] of blobs) {
      if (!(await db.activeStorageBlob.findUnique({ where: { id: blobId } }))) throw new NotFoundException("Media not found")
      const existing = await db.activeStorageAttachment.findFirst({ where: { blob_id: blobId, record_type: "Post", record_id: targetPostId } })
      if (!existing) await db.activeStorageAttachment.create({ data: { blob_id: blobId, record_type: "Post", record_id: targetPostId, name, created_at: new Date() } })
    }
    return { content: rewriteSnapshotMedia(normalizedContent, audioMap, videoMap), formatData: rewriteSnapshotMedia(normalizedFormatData, audioMap, videoMap) }
  }

  async createUpload(userId: number, file: Express.Multer.File, target: UploadTarget, metadataInput: UploadMetadataInput = {}) {
    if (!file) throw new BadRequestException("file is required")

    await this.verifyAccess(userId, target)
    this.assertSupportedUploadType(file)

    const metadata = await this.buildMetadata(metadataInput, file)
    const key = `uploads/${crypto.randomUUID()}`
    await this.storage.put(key, file.buffer, file.mimetype)

    const persist = async (tx: Prisma.TransactionClient) => {
      const blob = await tx.activeStorageBlob.create({
        data: {
          key,
          filename: file.originalname,
          content_type: file.mimetype || null,
          metadata,
          service_name: process.env.UPLOADS_SERVICE_NAME ?? "local",
          byte_size: file.buffer.length,
          checksum: null,
          created_at: new Date(),
        },
      })

      const payload = {
        id: blob.id,
        key: blob.key,
        filename: blob.filename,
        content_type: blob.content_type,
        byte_size: Number(blob.byte_size),
        ...(file.mimetype?.startsWith("image/") ? JSON.parse(metadata) : {}),
      }

      if (file.mimetype?.startsWith("audio/")) {
        const audioAsset = await this.createAudioAsset(userId, blob.id, file, target, tx)
        if (target.chat_message_id) await this.boss.enqueueInTransaction(tx, "uploads.audio", { audioAssetId: audioAsset.id })
        else await this.boss.enqueue("uploads.audio", { audioAssetId: audioAsset.id })
        return {
          ...payload,
          audio_asset: {
            id: audioAsset.id,
            processing_status: audioAsset.processing_status,
            title: audioAsset.title,
          },
        }
      }

      if (file.mimetype?.startsWith("video/")) {
        const videoAsset = await this.createVideoAsset(userId, blob.id, file, target, metadata, tx)
        const options = { expireInMinutes: videoProcessingJobExpireMinutes() }
        if (target.chat_message_id) await this.boss.enqueueInTransaction(tx, "uploads.video", { videoAssetId: videoAsset.id }, options)
        else await this.boss.enqueue("uploads.video", { videoAssetId: videoAsset.id }, options)
        return {
          ...payload,
          video_asset: {
            id: videoAsset.id,
            processing_status: videoAsset.processing_status,
            title: videoAsset.title,
            duration_ms: videoAsset.duration_ms,
            width: videoAsset.width,
            height: videoAsset.height,
          },
        }
      }

      await this.recordContentAttachment(blob.id, target, file.mimetype?.startsWith("image/") ? "image" : "file", tx)

      return payload
    }
    if (!target.chat_message_id) return persist(this.prisma)
    try {
      return await this.prisma.$transaction(async tx => {
        // Upload completion, explicit discard, and publication serialize on the same row.
        await tx.$queryRaw`SELECT id FROM chat_messages WHERE id = ${target.chat_message_id} FOR UPDATE`
        const draft = await tx.chatMessage.findUnique({ where: { id: target.chat_message_id } })
        if (!draft || draft.author_id !== userId || draft.status !== "draft") throw new ForbiddenException("Chat draft is no longer available")
        await this.circleAccess.requireMember(draft.room_id, userId)
        return persist(tx)
      })
    } catch (error) {
      await this.storage.delete(key)
      throw error
    }
  }

  async enqueuePostImageVariants(blob: BlobWithContentType, target: UploadTarget) {
    return this.enqueueImageVariants(blob, target)
  }

  private async enqueueImageVariants(blob: BlobWithContentType, target: UploadTarget | AttachmentTarget) {
    if (!blob.content_type?.startsWith("image/")) return

    const variationDigests = imageVariantsForAttachment("record_type" in target ? target : {})
    try {
      await this.boss.enqueue("uploads.variant", { blobId: Number(blob.id), variationDigests })
    } catch (error) {
      console.error(JSON.stringify({ event: "upload_variant_enqueue_failed", blob_id: blob.id, message: error instanceof Error ? error.message : String(error) }))
    }
  }

  async attachUpload(userId: number, blobId: number, target: AttachmentTarget) {
    const normalizedTarget = this.normalizeAttachmentTarget(target)
    const blob = await this.prisma.activeStorageBlob.findUnique({ where: { id: blobId } })
    if (!blob) throw new NotFoundException("Not Found")

    await this.verifyAttachmentAccess(userId, normalizedTarget)
    await this.assertCanAccessBlob(userId, blobId)
    if (!["Post", "Reply", "Note"].includes(normalizedTarget.record_type)) {
      if (Number(blob.byte_size) > IMAGE_UPLOAD_MAX_BYTES) throw new BadRequestException("Images must be 20 MB or smaller.")
      const buffer = await this.storage.getBuffer(blob.key)
      const metadata = await validateImageUpload({ buffer, size: buffer.length })
      await this.prisma.activeStorageBlob.update({ where: { id: blobId }, data: { content_type: metadata.contentType, metadata: JSON.stringify(metadata) } })
    }
    return this.replaceAttachment(blob.id, normalizedTarget, userId)
  }

  // Only called after source authorization, or with a blob just created by this request.
  private async replaceAttachment(blobId: number, normalizedTarget: AttachmentTarget, userId: number) {
    const replace = async (tx: Prisma.TransactionClient) => {
      const previousAttachments = await tx.activeStorageAttachment.findMany({
        where: { record_type: normalizedTarget.record_type, record_id: Number(normalizedTarget.record_id), name: normalizedTarget.name },
        select: { blob_id: true },
      })

      await tx.activeStorageAttachment.deleteMany({
        where: { record_type: normalizedTarget.record_type, record_id: Number(normalizedTarget.record_id), name: normalizedTarget.name },
      })

      await tx.activeStorageAttachment.create({
        data: {
          name: normalizedTarget.name,
          record_type: normalizedTarget.record_type,
          record_id: Number(normalizedTarget.record_id),
          blob_id: blobId,
          created_at: new Date(),
        },
      })

      return previousAttachments
    }
    const previousAttachments = normalizedTarget.record_type === "CircleMembership"
      ? await this.withMembershipAttachmentTransaction(userId, normalizedTarget.record_id, async tx => {
          await lockContentBlob(tx, blobId)
          return replace(tx)
        })
      : await this.images.withBlobLock(blobId, replace)

    const previousBlobIds = new Set(previousAttachments.map((attachment) => attachment.blob_id))
    previousBlobIds.delete(blobId)
    for (const previousBlobId of previousBlobIds) {
      await this.purgeOrphanedBlob(previousBlobId)
    }

    return { blob_id: blobId }
  }

  private async withMembershipAttachmentTransaction<T>(userId: number, membershipId: number, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      const source = await tx.roomMembership.findUnique({ where: { id: membershipId }, select: { room_id: true } })
      if (!source) throw new ForbiddenException("Forbidden")
      await lockActiveRoom(tx, source.room_id)
      const membership = await tx.roomMembership.findFirst({ where: { id: membershipId, user_id: userId, disabled: false } })
      if (!membership) throw new ForbiddenException("Forbidden")
      return operation(tx)
    })
  }

  async createAttachmentUpload(
    userId: number,
    file: Express.Multer.File,
    target: AttachmentTarget,
    _metadataInput: UploadMetadataInput = {},
  ) {
    const normalizedTarget = this.normalizeAttachmentTarget(target)
    if (!file) throw new BadRequestException("file is required")

    await this.verifyAttachmentAccess(userId, normalizedTarget)

    const image = await validateImageUpload(file)
    file.mimetype = image.contentType
    const metadata = JSON.stringify(image)
    const key = `uploads/${crypto.randomUUID()}`
    await this.storage.put(key, file.buffer, file.mimetype)

    const blob = await this.prisma.activeStorageBlob.create({
      data: {
        key,
        filename: file.originalname,
        content_type: file.mimetype || null,
        metadata,
        service_name: process.env.UPLOADS_SERVICE_NAME ?? "local",
        byte_size: file.buffer.length,
        checksum: null,
        created_at: new Date(),
      },
    })

    try {
      await this.replaceAttachment(Number(blob.id), normalizedTarget, userId)
    } catch (error) {
      // Only purge an unattached request-owned blob. The canonical blob lock
      // also protects uncertain commits: a retained attachment prevents purge.
      try {
        await this.purgeOrphanedBlob(Number(blob.id))
      } catch {
        const jobId = await this.boss.enqueue(UPLOAD_ORPHAN_PURGE_QUEUE, { blobId: Number(blob.id) })
        if (!jobId) throw new Error("Could not schedule upload cleanup", { cause: error })
      }
      throw error
    }
    await this.enqueueImageVariants({ id: blob.id, content_type: blob.content_type }, normalizedTarget)

    return {
      id: blob.id,
      key: blob.key,
      filename: blob.filename,
      content_type: blob.content_type,
      byte_size: Number(blob.byte_size),
    }
  }

  async removeAttachment(userId: number, target: AttachmentTarget) {
    const normalizedTarget = this.normalizeAttachmentTarget(target)
    await this.verifyAttachmentAccess(userId, normalizedTarget)

    const remove = async (tx: Prisma.TransactionClient) => {
      const previousAttachments = await tx.activeStorageAttachment.findMany({
        where: { record_type: normalizedTarget.record_type, record_id: Number(normalizedTarget.record_id), name: normalizedTarget.name },
        select: { blob_id: true },
      })

      await tx.activeStorageAttachment.deleteMany({
        where: { record_type: normalizedTarget.record_type, record_id: Number(normalizedTarget.record_id), name: normalizedTarget.name },
      })

      return previousAttachments
    }
    const previousAttachments = normalizedTarget.record_type === "CircleMembership"
      ? await this.withMembershipAttachmentTransaction(userId, normalizedTarget.record_id, remove)
      : await remove(this.prisma)

    const previousBlobIds = new Set(previousAttachments.map((attachment) => attachment.blob_id))
    for (const previousBlobId of previousBlobIds) {
      await this.purgeOrphanedBlob(previousBlobId)
    }
  }

  async requestVariant(blobId: number, variationDigest: string, userId: number) {
    if (!variationDigest) throw new BadRequestException("variation_digest is required")
    if (!isImageVariationDigest(variationDigest)) throw new BadRequestException("Unknown image variation digest")
    const blob = await this.prisma.activeStorageBlob.findUnique({ where: { id: blobId } })
    if (!blob) throw new NotFoundException("Not Found")
    await this.assertCanAccessBlob(userId, blobId)

    if (!blob.content_type?.startsWith("image/")) throw new BadRequestException("Image variants require an image upload")
    await this.boss.enqueue("uploads.variant", { blobId: Number(blobId), variationDigest })

    return { blobId, variationDigest }
  }

  async streamVariant(blobId: number, variationDigest: string, userId: number, ifNoneMatch?: string) {
    if (!isImageVariationDigest(variationDigest)) throw new BadRequestException("Unknown image variation digest")
    const blob = await this.prisma.activeStorageBlob.findUnique({ where: { id: blobId } })
    if (!blob) throw new NotFoundException("Not Found")
    if (!blob.content_type?.startsWith("image/")) throw new BadRequestException("Image variants require an image upload")
    await this.assertCanAccessBlob(userId, blobId)
    const etag = mediaEtag(`${blob.key}:v${IMAGE_TRANSFORM_VERSION}:${variationDigest}`)
    if (matchesMediaEtag(ifNoneMatch, etag)) return { notModified: true as const, etag }

    const key = imageVariantKey(blob.key, variationDigest)
    let payload = await this.storage.getStreamIfExists(key)
    const cacheHit = Boolean(payload)
    if (!payload) {
      await this.images.ensure(blobId, [variationDigest])
      payload = await this.storage.getStreamIfExists(key)
    }
    if (!payload || payload.byteSize === undefined) throw new NotFoundException("Not Found")
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "image_variant_served", blob_id: blobId, digest: variationDigest, storage_hit: cacheHit, bytes: payload.byteSize }))
    return { stream: payload.stream, filename: toWebpFilename(blob.filename), contentType: "image/webp", byteSize: payload.byteSize, etag }
  }

  private async buildMetadata(input: UploadMetadataInput, file?: Express.Multer.File) {
    if (file?.mimetype?.startsWith("image/")) {
      const image = await validateImageUpload(file)
      file.mimetype = image.contentType
      return JSON.stringify(image)
    }
    if (input.metadata) return input.metadata
    const width = input.width ? Number(input.width) : null
    const height = input.height ? Number(input.height) : null
    return width && height ? JSON.stringify({ width, height }) : "{}"
  }

  private async createAudioAsset(userId: number, blobId: number, file: Express.Multer.File, target: UploadTarget, tx: Prisma.TransactionClient = this.prisma) {
    const source = this.sourceFromTarget(target)
    const processingStatus = isPassThroughAudioContentType(file.mimetype) ? "ready" : "pending"

    return tx.audioAsset.create({
      data: {
        blob_id: blobId,
        owner_id: userId,
        source_type: source.sourceType,
        source_id: source.sourceId,
        title: file.originalname,
        original_filename: file.originalname,
        original_mime_type: file.mimetype || null,
        processing_status: processingStatus,
        waveform_peaks: [],
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
  }

  private async createVideoAsset(
    userId: number,
    blobId: number,
    file: Express.Multer.File,
    target: UploadTarget,
    metadata: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const source = this.sourceFromTarget(target)
    const dimensions = parseDimensionsMetadata(metadata)

    return tx.videoAsset.create({
      data: {
        blob_id: blobId,
        owner_id: userId,
        source_type: source.sourceType,
        source_id: source.sourceId,
        title: file.originalname,
        original_filename: file.originalname,
        original_mime_type: file.mimetype || null,
        processing_status: "pending",
        duration_ms: null,
        width: dimensions.width,
        height: dimensions.height,
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
  }

  private sourceFromTarget(target: UploadTarget): ContentSource {
    if (target.entry_id) return { sourceType: "Post", sourceId: target.entry_id }
    if (target.reply_id) return { sourceType: "Reply", sourceId: target.reply_id }
    if (target.chat_message_id) return { sourceType: "ChatMessage", sourceId: target.chat_message_id }
    const pageId = this.pageIdFromTarget(target)
    if (pageId) return { sourceType: "Note", sourceId: pageId }
    throw new BadRequestException("entry_id or reply_id or page_id or chat_message_id is required")
  }

  private assertSupportedUploadType(file: Express.Multer.File) {
    const mimeType = (file.mimetype ?? "").toLowerCase()
    if (mimeType.startsWith("audio/")) {
      if (isSupportedAudioContentType(mimeType)) return
      throw new BadRequestException("unsupported audio format")
    }

    if (mimeType.startsWith("video/")) {
      if (!SUPPORTED_VIDEO_CONTENT_TYPES.has(mimeType)) throw new BadRequestException("unsupported video format")
      if (Number(file.size) > videoUploadMaxBytes()) throw new BadRequestException("video upload is too large")
    }
  }

  private async verifyAttachmentAccess(userId: number, target: AttachmentTarget) {
    switch (target.record_type) {
      case "Post": {
        const post = await this.prisma.entry.findUnique({ where: { id: target.record_id } })
        if (
          !post ||
          !(await canManageEntryDraft(this.prisma, this.circleAccess, post, userId))
        ) {
          throw new ForbiddenException("Forbidden")
        }
        if (target.name !== "image" && target.name !== "audio" && target.name !== "video") {
          throw new BadRequestException("invalid attachment name")
        }
        return
      }
      case "User": {
        if (target.record_id !== userId) throw new ForbiddenException("Forbidden")
        if (target.name !== "avatar") throw new BadRequestException("invalid attachment name")
        return
      }
      case "Circle": {
        const community = await this.prisma.room.findUnique({ where: { id: target.record_id, deleted_at: null } })
        if (!community || this.toNumber(community.owner_id) !== userId) throw new ForbiddenException("Forbidden")
        if (target.name !== "avatar") throw new BadRequestException("invalid attachment name")
        return
      }
      case "CircleMembership": {
        const membership = await this.prisma.roomMembership.findUnique({ where: { id: target.record_id, disabled: false, room: { deleted_at: null } } })
        if (!membership || this.toNumber(membership.user_id) !== userId) throw new ForbiddenException("Forbidden")
        if (target.name !== "avatar") throw new BadRequestException("invalid attachment name")
        return
      }
      case "Project": {
        const project = await this.prisma.project.findUnique({ where: { id: target.record_id } })
        if (!project || this.toNumber(project.owner_id) !== userId) throw new ForbiddenException("Forbidden")
        if (target.name !== "icon" && target.name !== "banner") {
          throw new BadRequestException("invalid attachment name")
        }
        return
      }
      default:
        throw new BadRequestException("unsupported record_type")
    }
  }

  async streamUpload(id: number, userId: number, rangeHeader?: string | null, ifNoneMatch?: string): Promise<MediaStreamPayload | { notModified: true; etag: string }> {
    const blob = await this.prisma.activeStorageBlob.findUnique({ where: { id } })
    if (!blob) throw new NotFoundException("Not Found")
    await this.assertCanAccessBlob(userId, id)
    const etag = mediaEtag(`${blob.key}:${blob.checksum ?? ""}:${blob.byte_size}:${blob.content_type}`)
    if (!rangeHeader && matchesMediaEtag(ifNoneMatch, etag)) return { notModified: true, etag }

    const exists = await this.storage.exists(blob.key)
    if (!exists) {
      throw new NotFoundException("Not Found")
    }

    const byteSize = Number(blob.byte_size)
    const range = parseMediaRange(rangeHeader, byteSize)

    return {
      stream: (await this.storage.getStream(blob.key, range)).stream,
      filename: blob.filename,
      etag,
      contentType: blob.content_type ?? "application/octet-stream",
      byteSize,
      ...(range ? { range } : {}),
    }
  }

  private async recordContentAttachment(blobId: number, target: UploadTarget, name: "image" | "audio" | "video" | "file", tx: Prisma.TransactionClient = this.prisma) {
    const source = this.sourceFromTarget(target)
    const existing = await tx.activeStorageAttachment.findFirst({
      where: {
        blob_id: blobId,
        record_type: source.sourceType,
        record_id: source.sourceId,
        name,
      },
      select: { id: true },
    })
    if (existing) return

    await tx.activeStorageAttachment.create({
      data: {
        name,
        record_type: source.sourceType,
        record_id: source.sourceId,
        blob_id: blobId,
        created_at: new Date(),
      },
    })
  }

  private async assertCanAccessBlob(userId: number, blobId: number) {
    const attachments = await this.prisma.activeStorageAttachment.findMany({
      where: { blob_id: blobId },
      select: { record_type: true, record_id: true, name: true },
    })
    if (attachments.length === 0) throw new NotFoundException("Not Found")

    for (const attachment of attachments) {
      if (await this.canAccessAttachment(userId, attachment)) return
    }

    throw new NotFoundException("Not Found")
  }

  private async canAccessAttachment(
    userId: number,
    attachment: { record_type: string; record_id: number; name: string },
  ) {
    switch (attachment.record_type) {
      case "Post":
        return this.canAccessPostImage(userId, attachment.record_id)
      case "Reply":
        return this.canAccessReplyImage(userId, attachment.record_id)
      case "ChatMessage":
        return this.canAccessChatMessageMedia(userId, attachment.record_id)
      case "Page":
      case "Note":
        return this.canAccessPageImage(userId, attachment.record_id)
      case "Community":
      case "Circle":
        return this.canAccessCommunityImage(userId, attachment.record_id)
      case "CommunityMembership":
      case "CircleMembership":
        return this.canAccessMembershipAvatar(userId, attachment.record_id)
      case "User":
        return this.canAccessUserAvatar(userId, attachment.record_id)
      case "Project":
        return canViewProject(this.prisma, attachment.record_id, userId)
      default:
        return false
    }
  }

  private async canAccessPostImage(userId: number, postId: number) {
    const post = await this.prisma.entry.findUnique({
      where: { id: postId },
    })
    if (!post) return false
    if (post.status === "deleted") return false
    if (isProjectEntry(post)) return canReadProjectEntry(this.prisma, post, userId)
    if (post.status !== "published") {
      return (
        (await canManageEntryDraft(this.prisma, this.circleAccess, post, userId)) ||
        (await canReadRoundDraft(this.prisma, this.circleAccess, post, userId))
      )
    }

    const communityId = roomEntryRoomId(post)
    if (!communityId) return this.toNumber(post.user_id) === userId
    const access = await this.circleAccess.resolve(communityId, userId)
    return (access?.kind === "member" && post.creation_origin !== "chat_attachment") || (access && await this.circleAccess.canReadPublishedPostWithRoomHistory(post, access))
  }

  private async canAccessReplyImage(userId: number, replyId: number) {
    const reply = await this.prisma.reply.findUnique({
      where: { id: replyId },
      include: { entry: true, chat_message: true },
    })
    if (!reply) return false
    if (reply.status === "deleted" || reply.entry?.status === "deleted") return false
    if (reply.status !== "published") return canEditEntryReply(this.circleAccess, reply, userId)
    if (reply.chat_message) return this.circleAccess.canReadPublishedChatMessage(reply.chat_message.id, userId)

    const communityId = reply.entry ? roomEntryRoomId(reply.entry) : null
    if (!communityId) return this.toNumber(reply.user_id) === userId
    const access = await this.circleAccess.resolve(communityId, userId)
    return (access?.kind === "member" && reply.entry?.creation_origin !== "chat_attachment") || (access && reply.entry !== null && await this.circleAccess.canReadPublishedPostWithRoomHistory(reply.entry, access))
  }

  private async canAccessChatMessageMedia(userId: number, messageId: number) {
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId } })
    if (!message) return false
    if (message.status === "draft") {
      return message.author_id === userId && (await this.circleAccess.resolve(message.room_id, userId))?.kind === "member"
    }
    return this.circleAccess.canReadPublishedChatMessage(message.id, userId)
  }

  private async canAccessPageImage(userId: number, pageId: number) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } })
    if (!page?.room_id || page.deleted_at) return false
    return (await this.circleAccess.resolve(page.room_id, userId))?.kind === "member"
  }

  private async canAccessCommunityImage(userId: number, communityId: number) {
    const community = await this.prisma.room.findUnique({ where: { id: communityId, deleted_at: null } })
    if (!community) return false
    if (this.toNumber(community.owner_id) === userId) return true
    return Boolean(await this.circleAccess.resolve(communityId, userId))
  }

  private async canAccessMembershipAvatar(userId: number, membershipId: number) {
    const membership = await this.prisma.roomMembership.findUnique({ where: { id: membershipId } })
    if (!membership) return false
    if (this.toNumber(membership.user_id) === userId) return true
    return Boolean(await this.circleAccess.resolve(membership.room_id, userId))
  }

  private async canAccessUserAvatar(userId: number, avatarOwnerId: number) {
    if (userId === avatarOwnerId) return true
    const now = new Date()
    let after = 0
    for (;;) {
      // Candidate filtering is not authorization: a live lease may have lost
      // parent access. Resolve each candidate through the canonical policy.
      const memberships = await this.prisma.roomMembership.findMany({
        where: { id: { gt: after }, user_id: avatarOwnerId, disabled: false,
          room: { deleted_at: null, OR: [
            { memberships: { some: { user_id: userId, disabled: false } } },
            { visits: { some: { user_id: userId, expires_at: { gt: now } } } },
          ] },
        },
        orderBy: { id: "asc" }, take: 100, select: { id: true, room_id: true },
      })
      for (const membership of memberships) {
        if (await this.circleAccess.resolve(membership.room_id, userId, now)) return true
      }
      if (memberships.length < 100) return false
      after = memberships[memberships.length - 1].id
    }
  }

  private normalizeAttachmentTarget(target: AttachmentTarget): AttachmentTarget {
    const recordType =
      target.record_type === "Community"
        ? "Circle"
        : target.record_type === "CommunityMembership"
          ? "CircleMembership"
          : target.record_type === "Page"
            ? "Note"
            : target.record_type

    return { ...target, record_type: recordType }
  }

  private async verifyAccess(userId: number, target: UploadTarget) {
    if (target.chat_message_id) {
      throw new BadRequestException("Chat supports text and links. Share media as a Room entry.")
    }

    if (target.entry_id) {
      const post = await this.prisma.entry.findUnique({ where: { id: target.entry_id } })
      if (
        !post ||
        !(await canManageEntryDraft(this.prisma, this.circleAccess, post, userId))
      ) {
        throw new ForbiddenException("Forbidden")
      }
      return
    }

    if (target.reply_id) {
      const reply = await this.prisma.reply.findUnique({ where: { id: target.reply_id }, include: { entry: true } })
      if (!reply) throw new NotFoundException("Not Found")
      if (!(await canEditEntryReply(this.circleAccess, reply, userId))) throw new ForbiddenException("Forbidden")
      return
    }


    const pageId = this.pageIdFromTarget(target)
    if (pageId) {
      const page = await this.prisma.page.findUnique({ where: { id: pageId } })
      if (!page || page.deleted_at) throw new NotFoundException("Not Found")
      if (!page.room_id || (await this.circleAccess.resolve(page.room_id, userId))?.kind !== "member") {
        throw new ForbiddenException("Forbidden")
      }
      return
    }

    throw new BadRequestException("entry_id or reply_id or page_id or chat_message_id is required")
  }

  private pageIdFromTarget(target: UploadTarget) {
    return target.page_id ?? target.note_id
  }

  private async purgeOrphanedBlob(blobId: number) {
    await this.images.purgeOrphan(blobId)
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? Number(value) : Number(value)
  }
}

function toWebpFilename(filename: string) {
  const base = filename.replace(/\.[^/.]+$/, "")
  return `${base}.webp`
}

export function snapshotReferences(value: unknown) {
  const audio = new Set<number>()
  const video = new Set<number>()
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== "object") return
    for (const [key, child] of Object.entries(node)) {
      if (["audioAssetId", "audio_asset_id"].includes(key) && Number.isInteger(Number(child)) && Number(child) > 0) audio.add(Number(child))
      if (["videoAssetId", "video_asset_id"].includes(key) && Number.isInteger(Number(child)) && Number(child) > 0) video.add(Number(child))
      if (typeof child === "string") {
        for (const match of child.matchAll(/\/api\/v1\/(audio|video)-assets\/(\d+)/g)) (match[1] === "audio" ? audio : video).add(Number(match[2]))
      }
      visit(child)
    }
  }
  visit(value)
  return { audio, video, blobs: new Set(extractPrivateUploadBlobIds(value)) }
}

function rewriteSnapshotMedia(value: unknown, audio: Map<number, number>, video: Map<number, number>): unknown {
  if (Array.isArray(value)) return value.map(child => rewriteSnapshotMedia(child, audio, video))
  if (typeof value === "string") return value.replace(/(\/api\/v1\/)(audio|video)(-assets\/)(\d+)/g, (match, prefix, type, suffix, id) => `${prefix}${type}${suffix}${(type === "audio" ? audio : video).get(Number(id)) ?? id}`)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const mapping = ["audioAssetId", "audio_asset_id"].includes(key) ? audio : ["videoAssetId", "video_asset_id"].includes(key) ? video : null
    return [key, mapping?.get(Number(child)) ?? rewriteSnapshotMedia(child, audio, video)]
  }))
}

function videoUploadMaxBytes() {
  const raw = Number(process.env.VIDEO_UPLOAD_MAX_BYTES)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VIDEO_UPLOAD_MAX_BYTES
}

function parseDimensionsMetadata(metadata: string) {
  try {
    const parsed = JSON.parse(metadata) as { width?: unknown; height?: unknown }
    const width = typeof parsed.width === "number" && Number.isFinite(parsed.width) ? Math.round(parsed.width) : null
    const height = typeof parsed.height === "number" && Number.isFinite(parsed.height) ? Math.round(parsed.height) : null
    return { width, height }
  } catch {
    return { width: null, height: null }
  }
}
