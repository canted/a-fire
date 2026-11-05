import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { roomMemberHistoryCandidates } from "./room-entry-history"

type Cursor = { room: number; author: number; viewer: number; id: number; published: string | null; created: string }
type Row = { id: number; published: string | null; created: string }
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 23) === value.slice(0, 23)

/** Selection only. Authorize current Room history access before every call.
 * Match published DESC NULLS FIRST, created DESC, id DESC and retain microseconds.
 * A cursor is a continuation boundary, never an access grant or a live-row pointer.
 */
export async function roomMemberEntryPage(database: Pick<Prisma.TransactionClient, "$queryRaw">,
  roomId: number, authorId: number, viewerId: number, token?: string) {
  let cursor: Cursor | null = null
  if (token !== undefined) {
    try {
      if (token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error()
      cursor = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
      if (!cursor || cursor.room !== roomId || cursor.author !== authorId || cursor.viewer !== viewerId
        || !Number.isInteger(cursor.id) || cursor.id < 1 || cursor.id > 2147483647
        || !timestamp(cursor.created) || (cursor.published !== null && !timestamp(cursor.published))) throw Error()
    } catch { throw new BadRequestException("Invalid Room history cursor") }
  }
  const continuation = !cursor ? Prisma.empty : cursor.published === null
    ? Prisma.sql`AND (p.published_at IS NOT NULL OR (p.published_at IS NULL AND (p.created_at,p.id)<(${cursor.created}::timestamp,${cursor.id})))`
    : Prisma.sql`AND (p.published_at,p.created_at,p.id)<(${cursor.published}::timestamp,${cursor.created}::timestamp,${cursor.id})`
  const rows = await database.$queryRaw<Row[]>(Prisma.sql`
    SELECT p.id,to_char(p.published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published,
      to_char(p.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created
    FROM (${roomMemberHistoryCandidates(Prisma.sql`${roomId}`, Prisma.sql`${authorId}`, 21, continuation)}) p
    ORDER BY p.published_at DESC,p.created_at DESC,p.id DESC LIMIT 21`)
  const page = rows.slice(0, 20), last = page.at(-1)
  return { ids: page.map(row => row.id), nextCursor: rows.length > 20 && last
    ? Buffer.from(JSON.stringify({ room: roomId, author: authorId, viewer: viewerId, ...last })).toString("base64url") : null }
}
