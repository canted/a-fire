import { videoPosterStorageKey } from "../video/video-poster"
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../../prisma/prisma.service"
import { StorageService } from "../../storage/storage.service"
import { IMAGE_TRANSFORM_VERSION, IMAGE_UPLOAD_MAX_BYTES } from "../../../types/image-policy"
import { createImageVariant, imageVariantKey, IMAGE_VARIATION_DIGESTS, isImageVariationDigest } from "./image-variants"
import { inspectImage, validateImageUpload } from "./image-policy"
import { withImageProcessing, withImageMaterialization } from "./image-processing"

@Injectable()
export class ImageVariantsService {
  @Inject(PrismaService) private readonly prisma!: PrismaService
  @Inject(StorageService) private readonly storage!: StorageService
  private readonly inFlight = new Map<string, Promise<void>>()

  // The database lock coordinates API instances, queue workers, and deletion.
  async withBlobLock<T>(blobId: number, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await lockContentBlob(tx, blobId)
      return operation(tx)
    }, { timeout: 60_000, maxWait: 10_000 })
  }

  async ensure(blobId: number, digests: readonly string[]): Promise<void> {
    const requested = [...new Set(digests)].filter(isImageVariationDigest).sort()
    if (!requested.length) return
    const key = `${blobId}:${requested.join(",")}`
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const work = withImageMaterialization(() => this.withBlobLock(blobId, async tx => {
      const blob = await tx.activeStorageBlob.findUnique({ where: { id: blobId } })
      if (!blob || !blob.content_type?.startsWith("image/")) throw new NotFoundException("Not Found")
      if (Number(blob.byte_size) > IMAGE_UPLOAD_MAX_BYTES) throw new BadRequestException("Images must be 20 MB or smaller.")
      let source: Buffer | undefined
      for (const digest of requested) {
        const outputKey = imageVariantKey(blob.key, digest)
        const recordDigest = `v${IMAGE_TRANSFORM_VERSION}/${digest}`
        const recorded = await tx.activeStorageVariantRecord.findFirst({ where: { blob_id: blobId, variation_digest: recordDigest } })
        // A storage write can survive a rolled-back database transaction. Without
        // its record, regenerate from the original rather than trust partial bytes.
        if (recorded && await this.storage.exists(outputKey)) continue
        source ??= await this.storage.getBuffer(blob.key)
        const startedAt = Date.now()
        const buffer = await createImageVariant(source, digest)
        await this.storage.put(outputKey, buffer, "image/webp")
        if (!recorded) await tx.activeStorageVariantRecord.create({ data: { blob_id: blobId, variation_digest: recordDigest } })
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ event: "image_variant_generated", blob_id: blobId, digest, version: IMAGE_TRANSFORM_VERSION, source_bytes: source.length, output_bytes: buffer.length, duration_ms: Date.now() - startedAt }))
      }
      if (source) {
        const { pipeline: _pipeline, ...metadata } = await withImageProcessing(() => inspectImage(source!))
        await tx.activeStorageBlob.update({ where: { id: blobId }, data: { metadata: JSON.stringify(metadata), content_type: metadata.contentType } })
      }
    }))
    this.inFlight.set(key, work)
    try {
      await work
    } finally {
      this.inFlight.delete(key)
    }
  }

  /** Read-only operational preview. Execution always rechecks under the blob lock. */
  async previewRepair(blobId: number, digests: readonly string[]) {
    if (!digests.length || digests.some(digest => !isImageVariationDigest(digest))) throw new BadRequestException("Unsupported image variant")
    const blob = await this.prisma.activeStorageBlob.findUnique({ where: { id: blobId } })
    if (!blob || !blob.content_type?.startsWith("image/")) throw new NotFoundException("Image not found")
    const requested = [...new Set(digests)].sort()
    const records = await this.prisma.activeStorageVariantRecord.findMany({
      where: { blob_id: blobId, variation_digest: { in: requested.map(digest => `v${IMAGE_TRANSFORM_VERSION}/${digest}`) } },
      select: { variation_digest: true },
    })
    const variants = []
    for (const digest of requested) {
      const recorded = records.some(record => record.variation_digest === `v${IMAGE_TRANSFORM_VERSION}/${digest}`)
      const stored = await this.storage.exists(imageVariantKey(blob.key, digest))
      variants.push({ digest, recorded, stored, requires_work: !recorded || !stored })
    }
    return { blob_id: blobId, source_exists: await this.storage.exists(blob.key), variants }
  }

  /** Explicit requested variants, not a claim that every preset is required. */
  async previewRepairPage(afterId: number, limit: number, digests: readonly string[]) {
    if (!Number.isInteger(afterId) || afterId < 0 || afterId > 2147483647 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !digests.length || digests.some(digest => !isImageVariationDigest(digest))) throw new BadRequestException("Invalid image inventory request")
    const rows = await this.prisma.activeStorageBlob.findMany({
      where: { id: { gt: afterId }, content_type: { startsWith: "image/" } },
      orderBy: { id: "asc" }, take: limit + 1, select: { id: true },
    })
    const page = rows.slice(0, limit)
    const images: Array<Awaited<ReturnType<ImageVariantsService["previewRepair"]>> | { blob_id: number; unavailable: true }> = []
    for (const row of page) {
      try { images.push(await this.previewRepair(row.id, digests)) }
      catch (error) {
        if (!(error instanceof NotFoundException)) throw error
        images.push({ blob_id: row.id, unavailable: true })
      }
    }
    return { images, next_after_id: rows.length > limit ? page.at(-1)!.id : null }
  }

  async repairMetadata(blobId: number): Promise<void> {
    await this.withBlobLock(blobId, async tx => {
      const blob = await tx.activeStorageBlob.findUnique({ where: { id: blobId } })
      if (!blob) throw new NotFoundException("Not Found")
      if (blob.byte_size > IMAGE_UPLOAD_MAX_BYTES) throw new BadRequestException("Images must be 20 MB or smaller.")
      const buffer = await this.storage.getBuffer(blob.key)
      const metadata = await validateImageUpload({ buffer, size: buffer.length })
      await tx.activeStorageBlob.update({ where: { id: blobId }, data: { metadata: JSON.stringify(metadata), content_type: metadata.contentType } })
    })
  }

  async purgeOrphan(blobId: number): Promise<void> {
    await this.withBlobLock(blobId, async tx => {
      if (await tx.activeStorageAttachment.count({ where: { blob_id: blobId } })) return
      const blob = await tx.activeStorageBlob.findUnique({ where: { id: blobId } })
      if (!blob) return
      const attempts = blob.media_source_key
        ? await tx.mediaProcessingAttempt.findMany({ where: { blob_id: blobId }, select: { output_key: true, kind: true, finished_at: true } })
        : []
      // Supersession revokes publication, not the old process's ability to finish a storage write.
      if (attempts.some(attempt => !attempt.finished_at)) return
      const records = await tx.activeStorageVariantRecord.findMany({ where: { blob_id: blobId }, select: { variation_digest: true } })
      // Legacy records may predate digest validation. Never turn traversal syntax into a storage deletion.
      const keys = new Set(records.filter(record => /^[A-Za-z0-9_+/=-]+$/.test(record.variation_digest))
        .map(record => `variants/${blob.key}/${record.variation_digest}.webp`))
      for (const digest of IMAGE_VARIATION_DIGESTS) {
        keys.add(`variants/${blob.key}/${digest}.webp`)
        for (let version = 2; version <= IMAGE_TRANSFORM_VERSION; version++) keys.add(`variants/${blob.key}/v${version}/${digest}.webp`)
      }
      if (blob.media_source_key) {
        keys.add(blob.media_source_key)
        for (const attempt of attempts) {
          keys.add(attempt.output_key)
          if (attempt.kind === "video") keys.add(videoPosterStorageKey(attempt.output_key))
        }
        if (attempts.some(attempt => attempt.kind === "video")) {
          keys.add(videoPosterStorageKey(blob.media_source_key))
          keys.add(videoPosterStorageKey(blob.key))
        }
      }
      await this.storage.deleteMany([...keys])
      await this.storage.delete(blob.key)
      await tx.activeStorageVariantRecord.deleteMany({ where: { blob_id: blobId } })
      await tx.activeStorageBlob.delete({ where: { id: blobId } })
    })
  }
}

/** Shared with atomic content ownership changes; the caller owns the transaction. */
export async function lockContentBlob(tx: Prisma.TransactionClient, blobId: number) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(71423, ${blobId}::integer)`
}
