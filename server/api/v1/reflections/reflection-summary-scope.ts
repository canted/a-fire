import type { Prisma } from "@prisma/client"

/** Summaries may be broadcast to source-Room members. The caller must authorize
 * membership first; a recipient's access elsewhere cannot widen this payload.
 * Apply the write-side same-Room invariant to retained historical links too.
 */
export function reflectionSummaryScope(roomId: number | null | undefined): Prisma.ReflectionWhereInput {
  if (!roomId || !Number.isSafeInteger(roomId) || roomId < 1) return { id: { in: [] } }
  return { page: { room_id: roomId, deleted_at: null } }
}
