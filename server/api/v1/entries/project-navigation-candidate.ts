import { Prisma } from "@prisma/client"

/** Select only a shared candidate; private source identities stay inside PostgreSQL.
 * The caller must authorize the candidate's Room before returning it.
 */
export async function projectNavigationCandidate(database: Pick<Prisma.TransactionClient, "$queryRaw">, projectId: number, currentId: number, timestamp: Date, previous: boolean, cursorId?: number, roomId?: number) {
  const comparison = previous ? Prisma.sql`<` : Prisma.sql`>`
  const order = previous ? Prisma.sql`DESC` : Prisma.sql`ASC`
  // Bind UTC wall-clock text for timestamp-without-time-zone columns. A Date
  // parameter cast through timestamptz would depend on the session timezone.
  const candidate = Prisma.sql`
    SELECT p.id, p.status, p.created_at, p.published_at, p.room_id AS room_id,
      p.project_id, p.creation_origin
    FROM entries p
    WHERE p.status = 'published' AND p.room_id IS NOT NULL
      ${roomId === undefined ? Prisma.empty : Prisma.sql`AND p.room_id = ${roomId}`}
      AND (p.published_at, p.id) ${comparison} (${timestamp.toISOString()}::timestamp, ${currentId}::integer)
      ${cursorId === undefined ? Prisma.empty : Prisma.sql`AND (p.published_at, p.id) ${comparison}
        (SELECT published_at, id FROM entries WHERE id = ${cursorId})`}
`
  const rows = await database.$queryRaw<Array<{
    id: number; status: string; created_at: Date; published_at: Date | null;
    room_id: number | null; project_id: number | null;
    creation_origin: string | null;
  }>>(Prisma.sql`
    SELECT candidates.* FROM (
      SELECT shared.* FROM entries source
      CROSS JOIN LATERAL (
        ${candidate} AND p.source_entry_id = source.id
        ORDER BY p.published_at ${order}, p.id ${order} LIMIT 1
      ) shared
      WHERE source.project_id = ${projectId} AND source.room_id IS NULL
        AND source.creation_origin = 'project_material'
    ) candidates
    ORDER BY candidates.published_at ${order}, candidates.id ${order} LIMIT 1`)
  return rows[0] ?? null
}
