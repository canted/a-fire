import type { Prisma } from "@prisma/client"

type ReplySummary = { entry_id: number; reply_count: bigint; participants: Array<{ id: number; username: string }> }

/** Counts stay exact; at most three distinct identities cross the database boundary per Entry. */
export async function roomReplySummaries(database: Pick<Prisma.TransactionClient, "$queryRaw">, postIds: number[]): Promise<ReplySummary[]> {
  if (!postIds.length) return []
  return database.$queryRaw<ReplySummary[]>`
    SELECT entries.id AS entry_id,
      (SELECT count(*) FROM replies WHERE entry_id = entries.id AND status = 'published') AS reply_count,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', people.id, 'username', people.username) ORDER BY people.first_reply)
        FROM (
          SELECT users.id, users.username, min(replies.id) AS first_reply
          FROM replies JOIN users ON users.id = replies.user_id
          WHERE replies.entry_id = entries.id AND replies.status = 'published'
          GROUP BY users.id, users.username
          ORDER BY min(replies.id), users.id LIMIT 3
        ) AS people), '[]'::jsonb) AS participants
    FROM unnest(${postIds}::integer[]) AS entries(id)`
}

/** One aggregate row per Entry; historical publication timestamps fall back per reply. */
export async function entryReplyRoundSummaries(database: Pick<Prisma.TransactionClient, "$queryRaw">, postIds: number[]): Promise<Array<{ entry_id: number; reply_count: bigint; latest_at: Date | null }>> {
  if (!postIds.length) return []
  return database.$queryRaw`
    SELECT entry_id AS entry_id, count(*) AS reply_count, max(COALESCE(published_at, created_at)) AS latest_at
    FROM replies WHERE entry_id = ANY(${postIds}::integer[]) AND status = 'published'
    GROUP BY entry_id`
}
