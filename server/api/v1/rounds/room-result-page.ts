import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { roomRoundSqlScope } from "./round-scope"

type Cursor = { room: number; viewer: number; id: number; at: string }
type Row = { id: number; at: string }

/** Selection only: caller must authorize current results access on every request. */
export async function roomResultPage(database: Pick<Prisma.TransactionClient, "$queryRaw">,
  roomId: number, viewerId: number, token?: string) {
  let cursor: Cursor | null = null
  if (token !== undefined) {
    try {
      if (token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error()
      cursor = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
      if (!cursor || cursor.room !== roomId || cursor.viewer !== viewerId
        || !Number.isInteger(cursor.id) || cursor.id < 1 || cursor.id > 2147483647
        || typeof cursor.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at)
        || !Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString().slice(0, 23) !== cursor.at.slice(0, 23)) throw Error()
    } catch { throw new BadRequestException("Invalid Room results cursor") }
  }
  const rows = await database.$queryRaw<Row[]>(Prisma.sql`
    SELECT w.id,to_char(w.published_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
    FROM round_results w JOIN rounds r ON r.id=w.round_id
    WHERE w.room_id=${roomId} AND ${roomRoundSqlScope(roomId)}
      ${cursor ? Prisma.sql`AND (w.published_at,w.id)<(${cursor.at}::timestamp,${cursor.id})` : Prisma.empty}
    ORDER BY w.published_at DESC,w.id DESC LIMIT 21`)
  const page = rows.slice(0, 20), last = page.at(-1)
  return { ids: page.map(row => row.id), nextCursor: rows.length > 20 && last
    ? Buffer.from(JSON.stringify({ room: roomId, viewer: viewerId, ...last })).toString("base64url") : null }
}

/** Direct-link navigation seeks adjacent results without walking earlier pages.
 * Caller authorizes the anchor first; database timestamps retain full precision.
 */
export async function roomResultNeighbors(database: Pick<Prisma.TransactionClient, "$queryRaw">, roomId: number, wallId: number) {
  const anchor = Prisma.sql`(SELECT published_at,id FROM round_results WHERE id=${wallId} AND room_id=${roomId})`
  const scope = Prisma.sql`FROM round_results w JOIN rounds r ON r.id=w.round_id
    WHERE w.room_id=${roomId} AND ${roomRoundSqlScope(roomId)}`
  const rows = await database.$queryRaw<Array<{ direction: string; id: number }>>(Prisma.sql`
    (SELECT 'older' AS direction,w.id ${scope} AND (w.published_at,w.id)<${anchor}
      ORDER BY w.published_at DESC,w.id DESC LIMIT 1)
    UNION ALL
    (SELECT 'newer' AS direction,w.id ${scope} AND (w.published_at,w.id)>${anchor}
      ORDER BY w.published_at ASC,w.id ASC LIMIT 1)`)
  return { previousWallId: rows.find(row => row.direction === "older")?.id.toString() ?? null,
    nextWallId: rows.find(row => row.direction === "newer")?.id.toString() ?? null }
}
