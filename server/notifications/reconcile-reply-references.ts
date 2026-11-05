import type { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { roomEntryRoomId } from "../api/v1/entries/room-entry-scope"

type Event = { id: number; event_type: string; entry_id: number | null; room_id: number; actor_id: number; reply_id: number | null; payload: unknown; target_path: string | null }
const validId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647

/** Historical Reply-created payloads and Reply mention paths are the only sources. */
function candidate(event: Event): number | null {
  if (!event.entry_id || !["reply_created", "mention"].includes(event.event_type)) return null
  const payloadId = (event.payload as { replyId?: unknown } | null)?.replyId
  const path = /^\/app\/entries\/(\d+)#reply-(\d+)$/.exec(event.target_path ?? "")
  if (path && Number(path[1]) !== event.entry_id) return null
  const pathId = path ? Number(path[2]) : null
  if (payloadId !== undefined && !validId(payloadId)) return null
  if (validId(payloadId) && pathId !== null && payloadId !== pathId) return null
  const id = event.event_type === "reply_created" ? payloadId : pathId
  return validId(id) ? id : null
}

/** Verify an existing typed reference using the same historical identity rules. */
export async function matchesReplyEventReference(tx: Pick<Prisma.TransactionClient, "reply">, event: Event, replyId: number): Promise<boolean> {
  if (candidate(event) !== replyId) return false
  const reply = await tx.reply.findUnique({ where: { id: replyId }, include: { entry: true } })
  return Boolean(reply?.entry && reply.entry_id === event.entry_id && roomEntryRoomId(reply.entry) === event.room_id && reply.user_id === event.actor_id)
}

/** Caller may already hold parent/Reply locks; acquisition order is identical. */
export async function reconcileReplyEventReference(tx: Prisma.TransactionClient, eventId: number, execute: boolean) {
  const prepared = await tx.notificationEvent.findUnique({ where: { id: eventId } })
  if (!prepared) return "missing" as const
  if (prepared.reply_id !== null) return "already_linked" as const
  const replyId = candidate(prepared)
  if (!replyId) return "unresolved" as const
  if (execute) {
    await tx.$queryRaw`SELECT id FROM entries WHERE id = ${prepared.entry_id} FOR SHARE`
    await tx.$queryRaw`SELECT id FROM replies WHERE id = ${replyId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM notification_events WHERE id = ${eventId} FOR UPDATE`
  }
  const event = execute ? await tx.notificationEvent.findUnique({ where: { id: eventId } }) : prepared
  if (!event) return "missing" as const
  if (event.reply_id !== null) return "already_linked" as const
  if (candidate(event) !== replyId || event.entry_id !== prepared.entry_id) return "changed" as const
  if (!await matchesReplyEventReference(tx, event, replyId)) return "unresolved" as const
  if (!execute) return "eligible" as const
  await tx.notificationEvent.update({ where: { id: eventId }, data: { reply_id: replyId } })
  return "linked" as const
}

export type ReplyReferenceOptions = { afterId: number; limit: number; execute: boolean }
export function parseReplyReferenceArgs(args: string[]): ReplyReferenceOptions {
  let afterId = 0, limit = 100, execute = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--execute") { execute = true; continue }
    const value = args[++index]
    if (!value || !/^\d+$/.test(value)) throw new Error(`${arg} requires an integer`)
    if (arg === "--after-id") afterId = Number(value)
    else if (arg === "--limit") limit = Number(value)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isSafeInteger(afterId) || afterId < 0 || afterId > 2147483647 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid cursor or page limit")
  return { afterId, limit, execute }
}

export async function reconcileReplyReferences(prisma: PrismaService, options: ReplyReferenceOptions) {
  // Validate programmatic callers too, before any database access.
  parseReplyReferenceArgs(["--after-id", String(options.afterId), "--limit", String(options.limit)])
  const events = await prisma.notificationEvent.findMany({
    where: { id: { gt: options.afterId }, reply_id: null, event_type: { in: ["reply_created", "mention"] } },
    orderBy: { id: "asc" }, take: options.limit + 1, select: { id: true },
  })
  const page = events.slice(0, options.limit)
  const counts: Record<string, number> = {}
  for (const event of page) {
    const result = await prisma.$transaction(tx => reconcileReplyEventReference(tx, event.id, options.execute))
    counts[result] = (counts[result] ?? 0) + 1
  }
  return { dry_run: !options.execute, inspected: page.length, counts,
    next_after_id: events.length > options.limit ? page.at(-1)!.id : null }
}
