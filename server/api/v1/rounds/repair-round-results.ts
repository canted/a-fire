import type { PrismaClient } from "@prisma/client"
import { roomRoundScope } from "./round-scope"
import { lockRound, publishRoundWall, wallAnnouncementNonce } from "./publish-round-wall"

/** Operator-only bounded maintenance. Resume with the returned after/through IDs.
 * Normal completion remains owned by publishRoundWall in the completion transaction.
 */
export async function repairRoundResults(database: PrismaClient, roomId: number,
  options: { after?: number; through?: number; execute?: boolean } = {}) {
  const after = options.after ?? 0
  for (const value of [roomId, after, ...(options.through === undefined ? [] : [options.through])]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw Error("Invalid repair scope")
  }
  if (!roomId) throw Error("Room is required")
  const scope = { ...roomRoundScope(roomId), status: "archived", closed_at: { not: null } }
  const through = options.through ?? (await database.round.findFirst({ where: scope, orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0
  const rows = await database.round.findMany({ where: { ...scope, id: { gt: after, lte: through } }, orderBy: { id: "asc" }, take: 51, include: { round_result: true } })
  const page = rows.slice(0, 50)
  const notices = page.length ? await database.chatMessage.findMany({ where: {
    room_id: roomId, entry_origin: "wall_publication", timeline_kind: "round_event",
    client_nonce: { in: page.flatMap(round => round.round_result ? [wallAnnouncementNonce(round.round_result.id)] : []) },
  }, select: { client_nonce: true } }) : []
  const announced = new Set(notices.map(notice => notice.client_nonce))
  const candidates = page.filter(round => !round.round_result || !announced.has(wallAnnouncementNonce(round.round_result.id)))
  const repaired: number[] = []
  if (options.execute) for (const candidate of candidates) {
    const changed = await database.$transaction(async tx => {
      await lockRound(tx, candidate.id)
      const current = await tx.round.findFirst({ where: { ...scope, id: candidate.id }, include: { round_result: true } })
      if (!current) return false
      if (current.round_result) {
        if (current.round_result.room_id !== roomId) throw Error("Result Room scope conflict")
        if (await tx.chatMessage.findFirst({ where: { room_id: roomId, entry_origin: "wall_publication", timeline_kind: "round_event", client_nonce: wallAnnouncementNonce(current.round_result.id) }, select: { id: true } })) return false
      }
      return Boolean(await publishRoundWall(tx, candidate.id, true))
    })
    if (changed) repaired.push(candidate.id)
  }
  return { through, inspected: page.length, candidates: candidates.map(round => round.id), repaired,
    nextAfter: rows.length > 50 ? page.at(-1)!.id : null }
}
