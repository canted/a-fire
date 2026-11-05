import { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"

export type PendingMediaInspectionOptions = { kind: "audio" | "video"; before: Date; limit: number; afterId: number }
export function parsePendingMediaInspectionArgs(args: string[]): PendingMediaInspectionOptions {
  const options: PendingMediaInspectionOptions = { kind: "audio", before: new Date(), limit: 100, afterId: 0 }
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1]
    if (!value) throw new Error(`${args[index]} requires a value`)
    switch (args[index]) {
      case "--kind": if (value !== "audio" && value !== "video") throw new Error("--kind must be audio or video"); options.kind = value; break
      case "--before": options.before = new Date(value); break
      case "--limit": options.limit = Number(value); break
      case "--after-id": options.afterId = Number(value); break
      default: throw new Error(`Unknown argument: ${args[index]}`)
    }
  }
  validate(options)
  return options
}
function validate(options: PendingMediaInspectionOptions) {
  if (!["audio", "video"].includes(options.kind)) throw new Error("Invalid media kind")
  if (!Number.isFinite(options.before.getTime())) throw new Error("Invalid cutoff timestamp")
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new Error("Limit must be 1–1000")
  if (!Number.isSafeInteger(options.afterId) || options.afterId < 0) throw new Error("Cursor must be a nonnegative integer")
}

/** No queue startup, mutations, source bytes, or inference of writer death. */
export async function inspectPendingMedia(prisma: Pick<PrismaService, "$queryRaw">, options: PendingMediaInspectionOptions) {
  validate(options)
  const table = options.kind === "audio" ? Prisma.sql`audio_assets` : Prisma.sql`video_assets`
  const rows = await prisma.$queryRaw<Array<{ id: number; blob_id: number; updated_at: Date; media_generation: number }>>(Prisma.sql`
    SELECT asset.id, asset.blob_id, asset.updated_at, blob.media_generation
    FROM ${table} asset
    JOIN LATERAL (
      SELECT candidate.media_generation FROM active_storage_blobs candidate
      WHERE candidate.id=asset.blob_id
        AND NOT EXISTS (SELECT 1 FROM media_processing_attempts attempt
          WHERE attempt.blob_id=candidate.id AND attempt.generation=candidate.media_generation)
      -- Keep eligibility behind the asset cursor instead of rescanning assets per blob.
      OFFSET 0
    ) blob ON true
    WHERE asset.id > ${options.afterId} AND asset.processing_status='pending'
      AND asset.updated_at <= (${options.before}::timestamptz AT TIME ZONE 'UTC')
    ORDER BY asset.id ASC LIMIT ${options.limit + 1}
  `)
  const assets = rows.slice(0, options.limit).map(row => ({ ...row, writer_status: "unknown" as const, queue_status: "unchecked" as const }))
  return { kind: options.kind, before: options.before, assets, nextAfterId: rows.length > options.limit ? assets.at(-1)!.id : null }
}
