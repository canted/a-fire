import { lockContentBlob } from "../uploads/images/image-variants.service"
import type { AudioAsset, Prisma } from "@prisma/client"
import type { BossService } from "../queue/boss.service"
import type { PrismaService } from "../prisma/prisma.service"

export type RetryFailedMediaOptions = {
  since?: Date
  until?: Date
  execute?: boolean
  errorContains?: string
  limit?: number
  afterId?: number
}

type RetryFailedMediaAsset = Pick<AudioAsset, "id" | "blob_id" | "title" | "processing_status" | "error_message" | "created_at">

type RetryFailedMediaResult = {
  assets: RetryFailedMediaAsset[]
  enqueuedCount: number
  execute: boolean
  nextAfterId: number | null
}

export type RetryMediaKind = "audio" | "video"

export async function retryFailedMediaAssets(
  prisma: PrismaService,
  boss: Pick<BossService, "enqueueInTransaction" | "hasOutstandingMediaJob">,
  kind: RetryMediaKind,
  options: RetryFailedMediaOptions = {},
): Promise<RetryFailedMediaResult> {
  const execute = options.execute ?? false
  const errorContains = options.errorContains ?? "ffmpeg"
  const since = options.since ?? startOfUtcDay(new Date())
  const limit = validateRetryOptions({ ...options, since })
  const where = {
    processing_status: "failed",
    created_at: {
      gte: since,
      ...(options.until ? { lt: options.until } : {}),
    },
    ...(errorContains
      ? {
          error_message: {
            contains: errorContains,
          },
        }
      : {}),
  }

  const query = {
    where: { ...where, ...(options.afterId !== undefined ? { id: { gt: options.afterId } } : {}) },
    select: {
      id: true,
      blob_id: true,
      title: true,
      processing_status: true,
      error_message: true,
      created_at: true,
    },
    orderBy: [{ id: "asc" }],
    take: limit + 1,
  } satisfies Prisma.AudioAssetFindManyArgs
  const rows = kind === "audio" ? await prisma.audioAsset.findMany(query) : await prisma.videoAsset.findMany(query)

  const assets = rows.slice(0, limit)
  const nextAfterId = rows.length > limit ? assets.at(-1)!.id : null

  if (!execute) {
    return { assets, enqueuedCount: 0, execute, nextAfterId }
  }

  let enqueuedCount = 0
  for (const asset of assets) {
    const enqueued = await prisma.$transaction(async transaction => {
      await lockContentBlob(transaction, asset.blob_id)
      const queue = kind === "audio" ? "uploads.audio" : "uploads.video"
      const payload = kind === "audio" ? { audioAssetId: asset.id } : { videoAssetId: asset.id }
      if (await boss.hasOutstandingMediaJob(transaction, kind, asset.blob_id)) return false
      const update = {
        where: { ...where, id: asset.id, blob_id: asset.blob_id },
        data: { processing_status: "pending", error_message: null, updated_at: new Date() },
      }
      const claimed = kind === "audio" ? await transaction.audioAsset.updateMany(update) : await transaction.videoAsset.updateMany(update)
      if (!claimed.count) return false
      await boss.enqueueInTransaction(transaction, queue, payload)
      return true
    })
    if (enqueued) enqueuedCount += 1
  }

  return { assets, enqueuedCount, execute, nextAfterId }
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function parseRetryFailedMediaArgs(args: string[], now = new Date()): RetryFailedMediaOptions {
  const options: RetryFailedMediaOptions = { since: startOfUtcDay(now), execute: false, errorContains: "ffmpeg" }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]

    switch (arg) {
      case "--execute":
        options.execute = true
        break
      case "--since":
        options.since = parseRequiredDate(arg, next)
        index += 1
        break
      case "--until":
        options.until = parseRequiredDate(arg, next)
        index += 1
        break
      case "--error-contains":
        if (next === undefined) throw new Error("--error-contains requires a value")
        options.errorContains = next
        index += 1
        break
      case "--all-errors":
        options.errorContains = ""
        break
      case "--after-id":
        options.afterId = parsePositiveInteger(arg, next)
        index += 1
        break
      case "--limit":
        options.limit = parsePositiveInteger(arg, next)
        index += 1
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  validateRetryOptions(options)
  return options
}

function parseRequiredDate(flag: string, value: string | undefined): Date {
  if (!value) throw new Error(`${flag} requires an ISO date or timestamp`)
  const date = value.length === 10 ? new Date(`${value}T00:00:00.000Z`) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${flag} must be a valid ISO date or timestamp`)
  return date
}

function parsePositiveInteger(flag: string, value: string | undefined): number {
  if (!value) throw new Error(`${flag} requires a value`)
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

/** Bound each operator batch even when called outside the CLI parser. */
function validateRetryOptions(options: RetryFailedMediaOptions): number {
  const limit = options.limit ?? 100
  if (options.afterId !== undefined && (!Number.isSafeInteger(options.afterId) || options.afterId < 1 || options.afterId > 2147483647)) throw new Error("--after-id must be a positive database ID")
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be an integer between 1 and 1000")
  if (options.since && !Number.isFinite(options.since.getTime())) throw new Error("--since must be a valid date")
  if (options.until && !Number.isFinite(options.until.getTime())) throw new Error("--until must be a valid date")
  if (options.since && options.until && options.until <= options.since) throw new Error("--until must be later than --since")
  return limit
}
