import { BadRequestException } from "@nestjs/common"
import { Prisma, type PrismaClient } from "@prisma/client"
import { roomRoundSqlScope } from "./round-scope"
import { roomEntrySqlScope } from "../entries/room-entry-scope"
import { parseRoomFeedCursor } from "./room-feed-cursor"

type Row = { source_id: number; kind: number; entry_id: number; round_id: number; name: string; occurred_at: string; reply_count: number }

/** Member-only caller holds Room authority throughout this read. No private source is loaded. */
export async function readRoomParticipation(database: Pick<PrismaClient, "$queryRaw">, room: number, user: number, options: { cursor?: string; limit?: number } = {}) {
  const limit = options.limit ?? 30
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("Participation limit must be between 1 and 100")
  const cursor = parseRoomFeedCursor(options.cursor, room, [0, 1, 2], user)
  const seek = (at: Prisma.Sql, kind: number, id: Prisma.Sql) => !cursor ? Prisma.empty
    : kind === cursor.kind ? Prisma.sql`AND (${at}, ${id}) < (${cursor.at}::timestamp, ${cursor.id}::integer)`
    : kind < cursor.kind ? Prisma.sql`AND ${at} <= ${cursor.at}::timestamp`
    : Prisma.sql`AND ${at} < ${cursor.at}::timestamp`
  const submissions = (fallback: boolean) => {
    const at = fallback ? Prisma.sql`p.created_at` : Prisma.sql`p.published_at`
    return Prisma.sql`(SELECT p.id AS source_id, 0 AS kind, p.id AS entry_id, ${at} AS occurred_at
      FROM entries p WHERE p.user_id = ${user} AND p.status = 'published' AND p.project_id IS NULL
      AND EXISTS (SELECT 1 FROM visible_posts visible WHERE visible.id = p.id OFFSET 0) AND p.published_at IS ${fallback ? Prisma.sql`NULL` : Prisma.sql`NOT NULL`}
      ${seek(at, 0, Prisma.sql`p.id`)}
      ORDER BY ${fallback ? Prisma.sql`p.published_at DESC,` : Prisma.empty} ${at} DESC, p.id DESC LIMIT ${limit + 1})`
  }
  const replies = (fallback: boolean) => {
    const at = fallback ? Prisma.sql`reply.created_at` : Prisma.sql`reply.published_at`
    return Prisma.sql`(SELECT reply.id AS source_id, 1 AS kind, reply.entry_id, ${at} AS occurred_at
      FROM replies reply
      WHERE reply.user_id = ${user} AND reply.status = 'published'
      AND EXISTS (SELECT 1 FROM visible_posts visible WHERE visible.id = reply.entry_id OFFSET 0)
      AND reply.published_at IS ${fallback ? Prisma.sql`NULL` : Prisma.sql`NOT NULL`} ${seek(at, 1, Prisma.sql`reply.id`)}
      ORDER BY ${fallback ? Prisma.sql`reply.published_at DESC,` : Prisma.empty} ${at} DESC, reply.id DESC LIMIT ${limit + 1})`
  }
  // OFFSET 0 keeps visibility as a correlated per-candidate check, so ordered author
  // scans can stop at the page boundary instead of joining/sorting all Room entries.
  // Each event branch must push its author/reply/choice filter into the visibility read.
  // Materializing this shared CTE first scans every visible Entry in the Room.
  const rows = await database.$queryRaw<Row[]>(Prisma.sql`
    WITH visible_posts AS NOT MATERIALIZED (
      SELECT p.id, p.user_id, p.published_at, p.created_at, r.id AS round_id, r.name
      FROM entries p JOIN rounds r ON r.id = p.round_id

      WHERE p.status = 'published' AND p.project_id IS NULL
        AND r.status IN ('active', 'archived', 'cancelled')
        AND ${roomRoundSqlScope(room)} AND ${roomEntrySqlScope(room)}
    ), events AS (
      ${submissions(false)} UNION ALL ${submissions(true)}
      UNION ALL ${replies(false)} UNION ALL ${replies(true)}
      UNION ALL
      (SELECT choice.id AS source_id, 2 AS kind, artifact.entry_id, choice.updated_at AS occurred_at
      FROM round_activity_offers choice
      JOIN LATERAL (SELECT entry_id FROM round_activity_artifacts
        WHERE id = choice.chosen_artifact_id AND round_id = choice.round_id AND status = 'active' OFFSET 0) artifact ON true
      WHERE choice.user_id = ${user} AND choice.chosen_artifact_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM visible_posts visible WHERE visible.id = artifact.entry_id AND visible.round_id = choice.round_id OFFSET 0)
      ${seek(Prisma.sql`choice.updated_at`, 2, Prisma.sql`choice.id`)}
      ORDER BY choice.updated_at DESC, choice.id DESC LIMIT ${limit + 1})
    ), selected AS (
      SELECT * FROM events ORDER BY occurred_at DESC, kind DESC, source_id DESC LIMIT ${limit + 1}
    )
    SELECT source_id, kind, entry_id, visible.round_id, visible.name,
      to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
      CASE WHEN kind = 0 THEN (SELECT count(*)::integer FROM replies WHERE entry_id = selected.entry_id AND status = 'published') ELSE 0 END AS reply_count
    FROM selected JOIN LATERAL (SELECT round_id, name FROM visible_posts WHERE id = selected.entry_id OFFSET 0) visible ON true ORDER BY selected.occurred_at DESC, kind DESC, source_id DESC
  `)
  const page = rows.slice(0, limit), last = page.at(-1)
  return {
    items: page.map(row => ({
      id: `${row.kind}:${row.source_id}`,
      round: { id: String(row.round_id), name: row.name },
      contribution: {
        entryId: String(row.entry_id), kind: row.kind === 0 ? "submission" as const : row.kind === 1 ? "reply" as const : "choice" as const,
        occurredAt: row.occurred_at,
        ...(row.kind === 0 ? { replyCount: row.reply_count } : row.kind === 1 ? { replyId: String(row.source_id) } : {}),
      },
    })),
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ room, user, at: last.occurred_at, kind: last.kind, id: last.source_id })).toString("base64url") : null,
  }
}
