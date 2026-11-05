import { BadRequestException } from "@nestjs/common"
import { Prisma, type PrismaClient } from "@prisma/client"
import { roomRoundSqlScope } from "./round-scope"
import { roomEntrySqlScope } from "../entries/room-entry-scope"
import { serializeRoundCover } from "./runtime/round-cover-presentation"

/** Caller holds member Room authority. At most two indexed candidates per Round;
 * visitors have no personal cover and must not invoke this projection. */
export async function readRoomCoverPreviews(database: Pick<PrismaClient, "$queryRaw">, room: number, user: number, roundIds: number[]) {
  const ids = [...new Set(roundIds)]
  if (ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new BadRequestException("Invalid Round preview page")
  if (!ids.length) return new Map<number, { imageUrl: string; alt: string }>()
  // OFFSET 0 preserves the candidate-key lookup. Flattening this join can scan
  // every Entry in a crowded Round before matching its two cover candidates.
  const rows = await database.$queryRaw<{
    round_id: number; id: number; entry_id: number; format: string; format_data: unknown; content: unknown
  }[]>(Prisma.sql`
    SELECT r.id AS round_id, preview.* FROM rounds r

    CROSS JOIN LATERAL (
      SELECT candidate.id, p.id AS entry_id, p.format, p.format_data, d.content
      FROM (
        SELECT a.id, a.entry_id, a.user_id, 0 AS priority
        FROM round_activity_offers o JOIN round_activity_artifacts a ON a.id = o.chosen_artifact_id
        WHERE o.round_id = r.id AND o.user_id = ${user}
          AND a.round_id = r.id AND a.kind = 'cover' AND a.status = 'active'
        UNION ALL
        SELECT a.id, a.entry_id, a.user_id, 1 AS priority FROM round_activity_artifacts a
        WHERE a.round_id = r.id AND a.user_id = ${user} AND a.kind = 'cover' AND a.status = 'active'
      ) candidate
      JOIN LATERAL (SELECT * FROM entries WHERE id = candidate.entry_id OFFSET 0) p ON true

      LEFT JOIN documents d ON d.docable_type = 'Post' AND d.docable_id = p.id
      WHERE p.status = 'published' AND p.project_id IS NULL
        AND p.round_id = r.id AND p.user_id = candidate.user_id AND ${roomEntrySqlScope(room)}
      ORDER BY candidate.priority LIMIT 1
    ) preview
    WHERE r.id IN (${Prisma.join(ids)}) AND r.activity_key = 'art_before_chorus'
      AND r.status IN ('active', 'archived', 'cancelled') AND ${roomRoundSqlScope(room)}
  `)
  return new Map(rows.map(row => {
    const { imageUrl, alt } = serializeRoundCover({ id: row.id, entry_id: row.entry_id,
      entry: { format: row.format, format_data: row.format_data }, user: { username: "" } }, false, row.content)
    return [row.round_id, { imageUrl, alt }]
  }))
}
