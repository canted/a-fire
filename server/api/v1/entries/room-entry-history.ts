import { Prisma } from "@prisma/client"

/** Explicit copies have independent Room history; their private source need not
 * remain readable. Room copies are selected through their explicit Room/member.
 */
export function roomMemberEntryHistoryWhere(roomId: number, userId: number): Prisma.EntryWhereInput {
  return {
    user_id: userId, status: "published", room_id: roomId,
    project_id: null, source_entry_id: { not: null },
    OR: [{ creation_origin: null }, { creation_origin: { not: "chat_attachment" } }],
  }
}

/** Room/member inputs do not require a legacy Board or Square. */
export async function recentRoomMemberEntryIds(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  members: Array<{ roomId: number; userId: number }>,
  perMember: 1 | 3,
) {
  if (!members.length) return []
  return recentEntriesForSlots(database, Prisma.sql`
    SELECT DISTINCT ON (scope,user_id) scope,scope AS room_id,user_id,ordinal
    FROM unnest(${members.map(member => member.roomId)}::integer[], ${members.map(member => member.userId)}::integer[])
      WITH ORDINALITY AS requested(scope,user_id,ordinal)
    ORDER BY scope,user_id,ordinal`, perMember)
}

/** Limit each contributing history before merging, then bound rich hydration. */
async function recentEntriesForSlots(database: Pick<Prisma.TransactionClient, "$queryRaw">, slots: Prisma.Sql, limit: 1 | 3) {
  const rows = await database.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    WITH slots AS (${slots})
    SELECT recent.id FROM slots
    CROSS JOIN LATERAL (
      SELECT candidate.* FROM (
        ${roomMemberHistoryCandidates(Prisma.sql`slots.room_id`, Prisma.sql`slots.user_id`, limit)}
      ) candidate
      ORDER BY candidate.published_at DESC,candidate.created_at DESC,candidate.id DESC LIMIT ${limit}
    ) recent
    ORDER BY slots.ordinal,recent.published_at DESC,recent.created_at DESC,recent.id DESC`)
  return rows.map(row => row.id)
}

/** Indexed Room/member history with bounded hydration. */
export function roomMemberHistoryCandidates(roomId: Prisma.Sql, userId: Prisma.Sql, limit: number, continuation: Prisma.Sql = Prisma.empty) {
  return Prisma.sql`SELECT p.id,p.published_at,p.created_at FROM entries p
    WHERE p.room_id=${roomId} AND p.user_id=${userId}
      AND p.project_id IS NULL AND p.source_entry_id IS NOT NULL
      AND p.status='published' AND p.creation_origin IS DISTINCT FROM 'chat_attachment'
      ${continuation}
    ORDER BY p.published_at DESC,p.created_at DESC,p.id DESC LIMIT ${limit}`
}
