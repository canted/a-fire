import type { BossService } from "../queue/boss.service"
import { NotFoundException } from "@nestjs/common"
import type { Prisma, MediaProcessingKind, MediaProcessingAttempt, ActiveStorageBlob } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { lockContentBlob } from "./images/image-variants.service"

/** Blob-scoped generations: copied assets share bytes, not processing ownership. */
export async function beginMediaProcessing(prisma: PrismaService, blobId: number, kind: MediaProcessingKind) {
  return prisma.$transaction(async tx => {
    await lockContentBlob(tx, blobId)
    const blob = await tx.activeStorageBlob.findUnique({ where: { id: blobId } })
    if (!blob) throw new NotFoundException("Media not found")
    const previous = await tx.mediaProcessingAttempt.findFirst({ where: { blob_id: blobId }, orderBy: { generation: "desc" } })
    if (previous && previous.kind !== kind) throw new Error("Media processing kind cannot change")
    const generation = blob.media_generation + 1
    const sourceKey = blob.media_source_key ?? blob.key
    const id = crypto.randomUUID()
    await tx.activeStorageBlob.update({ where: { id: blobId }, data: { media_source_key: sourceKey, media_generation: generation } })
    await tx.mediaProcessingAttempt.updateMany({ where: { blob_id: blobId, state: "processing" }, data: { state: "superseded" } })
    const attempt = await tx.mediaProcessingAttempt.create({ data: {
      id, blob_id: blobId, generation, kind,
      output_key: `media/${blobId}/${id}/playback.${kind === "audio" ? "m4a" : "mp4"}`,
    } })
    await updateAssets(tx, kind, blobId, { processing_status: "processing", error_message: null, updated_at: new Date() })
    return { ...attempt, sourceKey }
  })
}

type Publication = {
  filename: string
  contentType: string | null
  byteSize: number
  metadata: string | null
  durationMs: number | null
  width?: number | null
  height?: number | null
  passThrough?: boolean
}

/** Upload to the attempt's immutable key before calling this short transaction. */
export async function publishMediaProcessing(prisma: PrismaService, attemptId: string, output: Publication): Promise<boolean> {
  return withAttempt(prisma, attemptId, async (tx, attempt, blob) => {
    if (blob.media_generation !== attempt.generation) {
      if (!attempt.finished_at) await tx.mediaProcessingAttempt.update({ where: { id: attempt.id }, data: { state: "superseded", finished_at: new Date() } })
      return false
    }
    if (attempt.state === "published") return true
    if (attempt.state !== "processing") return false
    const now = new Date()
    await tx.activeStorageBlob.update({ where: { id: blob.id }, data: {
      key: output.passThrough ? blob.media_source_key! : attempt.output_key,
      filename: output.filename, content_type: output.contentType, byte_size: output.byteSize, metadata: output.metadata,
    } })
    const common = { processing_status: "ready", error_message: null, duration_ms: output.durationMs, updated_at: now }
    if (attempt.kind === "audio") await tx.audioAsset.updateMany({ where: { blob_id: blob.id }, data: { ...common, waveform_peaks: [] } })
    else await tx.videoAsset.updateMany({ where: { blob_id: blob.id }, data: { ...common, width: output.width, height: output.height } })
    await tx.mediaProcessingAttempt.update({ where: { id: attempt.id }, data: { state: "published", finished_at: now } })
    return true
  })
}

/** A superseded worker can record failure without changing current playback/status. */
export async function failMediaProcessing(prisma: PrismaService, attemptId: string, error: unknown): Promise<boolean> {
  return withAttempt(prisma, attemptId, async (tx, attempt, blob) => {
    if (attempt.state === "published" || attempt.state === "failed") return false
    const current = attempt.state === "processing" && blob.media_generation === attempt.generation
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000)
    await tx.mediaProcessingAttempt.update({ where: { id: attempt.id }, data: { state: current ? "failed" : "superseded", error: message, finished_at: new Date() } })
    if (current) await updateAssets(tx, attempt.kind, blob.id, { processing_status: "failed", error_message: message, updated_at: new Date() })
    return current
  })
}

/** Explicit recovery fences the old writer; supersession does not establish its death. */
export async function recoverMediaProcessing(
  prisma: PrismaService,
  boss: Pick<BossService, "hasOutstandingMediaJob" | "enqueueInTransaction">,
  attemptId: string,
  before: Date,
) {
  if (!Number.isFinite(before.getTime())) throw new Error("Recovery cutoff must be a valid timestamp")
  return withAttempt(prisma, attemptId, async (tx, attempt, blob) => {
    if (attempt.state !== "processing" || attempt.finished_at || attempt.generation !== blob.media_generation || attempt.created_at > before) return false
    if (await boss.hasOutstandingMediaJob(tx, attempt.kind, blob.id)) return false
    const query = { where: { blob_id: blob.id }, orderBy: { id: "asc" as const }, select: { id: true } }
    const asset = attempt.kind === "audio" ? await tx.audioAsset.findFirst(query) : await tx.videoAsset.findFirst(query)
    if (!asset) return false
    await tx.activeStorageBlob.update({ where: { id: blob.id }, data: { media_generation: { increment: 1 } } })
    await tx.mediaProcessingAttempt.update({ where: { id: attempt.id }, data: { state: "superseded" } })
    await updateAssets(tx, attempt.kind, blob.id, { processing_status: "pending", error_message: null, updated_at: new Date() })
    const queue = attempt.kind === "audio" ? "uploads.audio" : "uploads.video"
    const payload = attempt.kind === "audio" ? { audioAssetId: asset.id } : { videoAssetId: asset.id }
    const jobId = await boss.enqueueInTransaction(tx, queue, payload)
    return { jobId, blobId: blob.id, assetId: asset.id }
  })
}

/** Recover only consistent pending copies with no current attempt or retained queue owner. */
export async function recoverPendingMedia(
  prisma: PrismaService,
  boss: Pick<BossService, "hasOutstandingMediaJob" | "enqueueInTransaction">,
  kind: MediaProcessingKind,
  assetId: number,
  before: Date,
) {
  if (!["audio", "video"].includes(kind) || !Number.isSafeInteger(assetId) || assetId <= 0 || !Number.isFinite(before.getTime())) throw new Error("Invalid pending recovery target")
  const hint = kind === "audio" ? await prisma.audioAsset.findUnique({ where: { id: assetId }, select: { blob_id: true } }) : await prisma.videoAsset.findUnique({ where: { id: assetId }, select: { blob_id: true } })
  if (!hint) return false
  return prisma.$transaction(async tx => {
    await lockContentBlob(tx, hint.blob_id)
    const blob = await tx.activeStorageBlob.findUnique({ where: { id: hint.blob_id } })
    if (!blob) return false
    const query = { where: { id: assetId }, select: { blob_id: true } }
    const asset = kind === "audio" ? await tx.audioAsset.findUnique(query) : await tx.videoAsset.findUnique(query)
    if (asset?.blob_id !== blob.id) return false
    const ineligible = { where: { blob_id: blob.id, OR: [{ processing_status: { not: "pending" } }, { updated_at: { gt: before } }] } }
    if (kind === "audio" ? await tx.audioAsset.count(ineligible) : await tx.videoAsset.count(ineligible)) return false
    const opposite = kind === "audio" ? await tx.videoAsset.count({ where: { blob_id: blob.id } }) : await tx.audioAsset.count({ where: { blob_id: blob.id } })
    if (opposite) return false
    const previous = await tx.mediaProcessingAttempt.findFirst({ where: { blob_id: blob.id }, orderBy: { generation: "desc" } })
    if (previous && (previous.kind !== kind || previous.generation >= blob.media_generation)) return false
    if (await boss.hasOutstandingMediaJob(tx, kind, blob.id)) return false
    await updateAssets(tx, kind, blob.id, { processing_status: "pending", error_message: null, updated_at: new Date() })
    const queue = kind === "audio" ? "uploads.audio" : "uploads.video"
    const payload = kind === "audio" ? { audioAssetId: assetId } : { videoAssetId: assetId }
    const jobId = await boss.enqueueInTransaction(tx, queue, payload)
    return { jobId, blobId: blob.id, assetId }
  })
}

async function updateAssets(tx: Prisma.TransactionClient, kind: MediaProcessingKind, blobId: number, data: { processing_status: string; error_message: string | null; updated_at: Date }) {
  if (kind === "audio") await tx.audioAsset.updateMany({ where: { blob_id: blobId }, data })
  else await tx.videoAsset.updateMany({ where: { blob_id: blobId }, data })
}

async function withAttempt<T>(prisma: PrismaService, id: string, operation: (
  tx: Prisma.TransactionClient,
  attempt: MediaProcessingAttempt,
  blob: ActiveStorageBlob,
) => Promise<T>): Promise<T | false> {
  const hint = await prisma.mediaProcessingAttempt.findUnique({ where: { id }, select: { blob_id: true } })
  if (!hint) return false
  return prisma.$transaction(async tx => {
    await lockContentBlob(tx, hint.blob_id)
    const attempt = await tx.mediaProcessingAttempt.findUnique({ where: { id } })
    const blob = await tx.activeStorageBlob.findUnique({ where: { id: hint.blob_id } })
    if (!attempt || !blob) return false
    return operation(tx, attempt, blob)
  })
}
