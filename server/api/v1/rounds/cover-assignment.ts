import { Prisma } from "@prisma/client"

/** Rank in PostgreSQL; only the selected pair crosses into application memory. */
export async function selectCoverPair(database: Pick<Prisma.TransactionClient, "$queryRaw">, roundId: number, userId: number) {
  // Preserve the existing JavaScript 32-bit assignment score. The artifact product
  // also uses float8 before bigint conversion to retain JS Number rounding at high IDs.
  const seed = (roundId * 73_856_093) ^ (userId * 19_349_663)
  return database.$queryRaw<Array<{ id: number }>>`
    WITH assigned AS (
      SELECT first_artifact_id AS id FROM round_activity_offers WHERE round_id = ${roundId}
      UNION ALL
      SELECT second_artifact_id AS id FROM round_activity_offers WHERE round_id = ${roundId}
    ), counts AS (SELECT id, count(*) AS uses FROM assigned GROUP BY id), candidates AS (
      SELECT artifact.id, COALESCE(counts.uses, 0) AS uses,
        ((${seed}::bigint # (artifact.id::double precision * 83492791)::bigint) & 4294967295::bigint) AS score
      FROM round_activity_artifacts artifact LEFT JOIN counts ON counts.id = artifact.id
      WHERE artifact.round_id = ${roundId} AND artifact.kind = 'cover'
        AND artifact.status = 'active' AND artifact.user_id <> ${userId}
    )
    SELECT id FROM candidates ORDER BY uses, (score # (score >> 16)), id LIMIT 2
  `
}
