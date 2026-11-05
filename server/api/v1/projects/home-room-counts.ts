import { Prisma } from "@prisma/client"

type Counts = { activitiesJoined: number; feedbackGiven: number; entriesShared: number }

/** Counts remain scalar even when a member has years of Room activity. */
export async function homeRoomCounts(database: Pick<Prisma.TransactionClient, "$queryRaw">, userId: number, roomIds: number[], year: number, timeZone: string): Promise<Counts> {
  if (!roomIds.length) return { activitiesJoined: 0, feedbackGiven: 0, entriesShared: 0 }
  const rooms = Prisma.join(roomIds)
  const [counts] = await database.$queryRaw<Counts[]>(Prisma.sql`
    WITH bounds AS (
      SELECT (make_date(${year}::int,1,1)::timestamp AT TIME ZONE ${timeZone}) AT TIME ZONE 'UTC' AS start,
        (make_date(${year + 1}::int,1,1)::timestamp AT TIME ZONE ${timeZone}) AT TIME ZONE 'UTC' AS finish
    )
    SELECT
      (SELECT count(DISTINCT p.round_id)::int FROM round_participations p JOIN rounds r ON r.id=p.round_id, bounds b
        WHERE p.user_id=${userId} AND p.role IN ('participant','reviewer') AND r.room_id IN (${rooms})
          AND p.joined_at>=b.start AND p.joined_at<b.finish) AS "activitiesJoined",
      (SELECT count(*)::int FROM replies f JOIN entries p ON p.id=f.entry_id , bounds b
        WHERE f.user_id=${userId} AND f.status='published' AND p.room_id IN (${rooms})

          AND f.published_at>=b.start AND f.published_at<b.finish) AS "feedbackGiven",
      (SELECT count(DISTINCT s.entry_id)::int FROM round_submissions s JOIN rounds r ON r.id=s.round_id, bounds b
        WHERE s.user_id=${userId} AND r.room_id IN (${rooms})
          AND s.submitted_at>=b.start AND s.submitted_at<b.finish) AS "entriesShared"`)
  return counts
}
