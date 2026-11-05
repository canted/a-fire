import { parseRoomFeedCursor } from "./room-feed-cursor"
import { BadRequestException } from "@nestjs/common"
import { Prisma, type PrismaClient } from "@prisma/client"

type HistoryRow = { source_id: number; kind: number; label: string; occurred_at: string }
/** Caller authorizes the Room on every page. Cursor is position only, never authority. */
export async function readRoomHistory(database: Pick<PrismaClient, "$queryRaw">, room: number, options: { cursor?: string; limit?: number } = {}) {
  const limit = options.limit ?? 30
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("History limit must be between 1 and 100")
  const cursor = parseRoomFeedCursor(options.cursor, room, [0, 1])
  const seek = (timestamp: Prisma.Sql, kind: number, id: Prisma.Sql) => {
    if (!cursor) return Prisma.empty
    if (cursor.kind === kind) return Prisma.sql`AND (${timestamp}, ${id}) < (${cursor.at}::timestamp, ${cursor.id}::integer)`
    return kind < cursor.kind
      ? Prisma.sql`AND ${timestamp} <= ${cursor.at}::timestamp`
      : Prisma.sql`AND ${timestamp} < ${cursor.at}::timestamp`
  }
  const roundStream = (fallback: boolean) => {
    const timestamp = fallback ? Prisma.sql`r.updated_at` : Prisma.sql`r.closed_at`
    // Keep fixed-null index prefixes in ORDER BY: they do not change event order,
    // but let PostgreSQL use the complete index ordering instead of sorting all rows.
    const candidates = Prisma.sql`
      SELECT r.id AS source_id, 1 AS kind, (r.name || ' completed') AS label,
        ${timestamp} AS occurred_at
      FROM rounds r
      WHERE r.status = 'archived'
        AND ${fallback ? Prisma.sql`r.closed_at IS NULL` : Prisma.sql`r.closed_at IS NOT NULL`}
        AND r.room_id = ${room}
        ${seek(timestamp, 1, Prisma.sql`r.id`)}
      ORDER BY
        ${fallback ? Prisma.sql`r.closed_at DESC,` : Prisma.empty}
        ${timestamp} DESC, r.id DESC LIMIT ${limit + 1}
    `
    return candidates
  }
  const rows = await database.$queryRaw<HistoryRow[]>(Prisma.sql`
    WITH events AS (
      SELECT m.id AS source_id, 0 AS kind,
        (COALESCE(NULLIF(m.username_override, ''), u.username) || ' joined the circle') AS label,
        m.created_at AS occurred_at
      FROM (
        SELECT m.id, m.user_id, m.username_override, m.created_at FROM room_memberships m
        WHERE m.room_id = ${room} AND NOT m.disabled AND m.revoked_at IS NULL
          ${seek(Prisma.sql`m.created_at`, 0, Prisma.sql`m.id`)}
        ORDER BY m.revoked_at DESC, m.created_at DESC, m.id DESC LIMIT ${limit + 1}
      ) m JOIN users u ON u.id = m.user_id
      UNION ALL (${roundStream(false)})
      UNION ALL (${roundStream(true)})
    ), selected AS (
      SELECT * FROM events ORDER BY occurred_at DESC, kind DESC, source_id DESC LIMIT ${limit + 1}
    )
    SELECT source_id, kind, label,
      to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
    FROM selected ORDER BY selected.occurred_at DESC, kind DESC, source_id DESC
  `)
  const page = rows.slice(0, limit), last = page.at(-1)
  return {
    items: page.map(row => ({
      id: `${row.kind === 0 ? "member" : "activity"}:${row.source_id}`,
      label: row.label, occurredAt: row.occurred_at,
      ...(row.kind === 1 ? { roundId: String(row.source_id) } : {}),
    })),
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ room, at: last.occurred_at, kind: last.kind, id: last.source_id })).toString("base64url") : null,
  }
}
