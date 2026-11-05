import type { PrismaService } from "../prisma/prisma.service"

export type RecoverMediaAttemptOptions = { attemptId: string; before: Date; execute: boolean }

export function parseRecoverMediaAttemptArgs(args: string[]): RecoverMediaAttemptOptions {
  let attemptId: string | undefined, before: Date | undefined
  let execute = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--execute") { execute = true; continue }
    const value = args[++index]
    if (!value) throw new Error(`${arg} requires a value`)
    if (arg === "--attempt-id") attemptId = value
    else if (arg === "--before") before = new Date(value)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!attemptId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) throw new Error("--attempt-id must be a UUID")
  if (!before || !Number.isFinite(before.getTime())) throw new Error("--before requires a valid timestamp")
  return { attemptId, before, execute }
}

/** Metadata preview only; execution rechecks all eligibility under the canonical blob lock. */
export async function previewMediaAttemptRecovery(prisma: PrismaService, attemptId: string) {
  const attempt = await prisma.mediaProcessingAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, blob_id: true, kind: true, state: true, generation: true, created_at: true, finished_at: true,
      blob: { select: { media_generation: true } } },
  })
  if (!attempt) return null
  const { blob, ...metadata } = attempt
  return { ...metadata, current_generation: blob.media_generation, writer_status: "unknown" as const }
}
