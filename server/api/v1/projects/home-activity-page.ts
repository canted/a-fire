import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { privateProjectIdsSql } from "./project-access"

type RoundRow = { id: number; project_id: number; published_at: Date | null; created_at: Date; creation_origin: string; source_chat_message_id: number | null; project_intent: string | null; project_question: string | null; at: string }

export async function homeRoundPage(database: Pick<Prisma.TransactionClient, "$queryRaw">, userId: number, token?: string, now = new Date()) {
  let cursor: { user: number; id: number; at: string } | null = null
  if (token !== undefined) {
    try {
      if (token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error()
      cursor = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
      if (!cursor || cursor.user !== userId || !Number.isSafeInteger(cursor.id) || cursor.id < 1 || cursor.id > 2147483647
        || typeof cursor.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at)
        || !Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString().slice(0, 23) !== cursor.at.slice(0, 23)) throw Error()
    } catch { throw new BadRequestException("Invalid Home activity cursor") }
  }
  const branch = (fallback: boolean) => {
    const timestamp = fallback ? Prisma.sql`created_at` : Prisma.sql`published_at`
    return Prisma.sql`(
      SELECT id, project_id, published_at, created_at, creation_origin, source_chat_message_id, project_intent, project_question,
        ${timestamp} AS at_sort, to_char(${timestamp}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      FROM entries WHERE user_id=${userId} AND project_id IN (${privateProjectIdsSql(userId)}) AND status='published'
        AND room_id IS NULL AND creation_origin IN ('project_material','project_feedback')
        AND published_at IS ${fallback ? Prisma.sql`NULL` : Prisma.sql`NOT NULL`}
        AND ${timestamp}>=(${new Date(now.getTime() - 50 * 86400000)}::timestamptz AT TIME ZONE 'UTC')
        AND ${timestamp}<=(${now}::timestamptz AT TIME ZONE 'UTC')
        ${cursor ? Prisma.sql`AND (${timestamp},id)<(${cursor.at}::timestamp,${cursor.id})` : Prisma.empty}
      ORDER BY ${timestamp} DESC, id DESC LIMIT 51
    )`
  }
  const rows = await database.$queryRaw<RoundRow[]>(Prisma.sql`
    SELECT * FROM (${branch(false)} UNION ALL ${branch(true)}) page
    ORDER BY at_sort DESC, id DESC LIMIT 51`)
  const items = rows.slice(0, 50), last = items.at(-1)
  return { items, nextCursor: rows.length > 50 && last ? Buffer.from(JSON.stringify({ user: userId, id: last.id, at: last.at })).toString("base64url") : null }
}
