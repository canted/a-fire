import type { PrismaService } from "../prisma/prisma.service"

type Options = { before: Date; limit: number; afterId?: string }

export function parseInspectMediaAttemptsArgs(args: string[], now = new Date()): Options {
  const options: Options = { before: now, limit: 100 }
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1]
    if (!value) throw new Error(`${args[i]} requires a value`)
    switch (args[i]) {
      case "--before": options.before = new Date(value); break
      case "--limit": options.limit = Number(value); break
      case "--after-id": options.afterId = value; break
      default: throw new Error(`Unknown argument: ${args[i]}`)
    }
  }
  validate(options)
  return options
}

function validate(options: Options) {
  if (!Number.isFinite(options.before.getTime())) throw new Error("--before must be a valid timestamp")
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new Error("--limit must be an integer between 1 and 1000")
  if (options.afterId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.afterId)) throw new Error("--after-id must be a UUID")
}

/** Observation only: neither attempt age nor supersession establishes writer death. */
export async function inspectMediaAttempts(prisma: PrismaService, options: Options) {
  validate(options)
  const rows = await prisma.mediaProcessingAttempt.findMany({
    where: { finished_at: null, created_at: { lte: options.before }, ...(options.afterId ? { id: { gt: options.afterId } } : {}) },
    orderBy: { id: "asc" }, take: options.limit + 1,
    select: { id: true, blob_id: true, generation: true, kind: true, state: true, created_at: true,
      blob: { select: { media_generation: true } } },
  })
  const hasMore = rows.length > options.limit
  const attempts = rows.slice(0, options.limit).map(({ blob, ...attempt }) => ({
    ...attempt, current_generation: blob.media_generation,
    is_current_generation: attempt.generation === blob.media_generation,
    writer_status: "unknown" as const,
  }))
  return { before: options.before, attempts, nextAfterId: hasMore ? attempts.at(-1)!.id : null }
}
