import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"

type Cursor = { entry: number | null; project: number; user: number; root: number; rootAt: string; child: number; id: number; at: string }
type Row = { id: number; root: number; root_at: string; child: number; at: string }
const validId = (id: unknown): id is number => typeof id === "number" && Number.isInteger(id) && id > 0 && id <= 2147483647
const validDate = (at: unknown): at is string => typeof at === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(at)
  && Number.isFinite(Date.parse(at)) && new Date(at).toISOString().slice(0, 23) === at.slice(0, 23)

/** Selection only: callers must authorize the Project on every page before hydration.
 * Roots descend by publication; saved feedback follows its source in ascending order.
 * Cursor timestamps retain PostgreSQL microseconds and survive anchor deletion.
 */
export async function projectEntryPage(database: Pick<Prisma.TransactionClient, "$queryRaw">, projectId: number, userId: number, token?: string, entryId?: number) {
  let cursor: Cursor | null = null
  if (token !== undefined) {
    try {
      if (token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error()
      cursor = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
      if (!cursor || cursor.project !== projectId || cursor.user !== userId || cursor.entry !== (entryId ?? null) || !validId(cursor.root) || !validId(cursor.id)
        || ![0, 1].includes(cursor.child) || !validDate(cursor.rootAt) || !validDate(cursor.at)) throw Error()
    } catch { throw new BadRequestException("Invalid Project Entry cursor") }
  }
  const rows = await database.$queryRaw<Row[]>(Prisma.sql`
    WITH ordered AS (
      SELECT p.id, COALESCE(source.id,p.id) AS root,
        COALESCE(source.published_at,source.created_at,p.published_at,p.created_at) AS root_time,
        CASE WHEN source.id IS NULL THEN 0 ELSE 1 END AS child,
        COALESCE(p.published_at,p.created_at) AS child_time
      FROM entries p
      -- Keep source identity as a point lookup even under a reused generic plan.
      -- OFFSET 0 prevents scope predicates from turning it into a Project rescan.
      LEFT JOIN LATERAL (
        SELECT id,project_id,status,creation_origin,room_id,published_at,created_at
        FROM entries source_row WHERE source_row.id=p.source_entry_id OFFSET 0
      ) source ON p.creation_origin='project_feedback'
        AND source.project_id=${projectId} AND source.status='published' AND source.creation_origin='project_material'
        AND source.room_id IS NULL
      WHERE p.project_id=${projectId} AND p.status='published'
        AND p.room_id IS NULL AND p.creation_origin IN ('project_material','project_feedback')
        ${entryId ? Prisma.sql`AND (p.id=${entryId} OR source.id=${entryId})` : Prisma.empty}
    )
    SELECT id,root,child,
      to_char(root_time,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS root_at,
      to_char(child_time,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
    FROM ordered
    ${cursor ? Prisma.sql`WHERE (root_time,root)<(${cursor.rootAt}::timestamp,${cursor.root})
      OR ((root_time,root)=(${cursor.rootAt}::timestamp,${cursor.root})
        AND (child,child_time,id)>(${cursor.child},${cursor.at}::timestamp,${cursor.id}))` : Prisma.empty}
    ORDER BY root_time DESC,root DESC,child ASC,child_time ASC,id ASC LIMIT 31`)
  const page = rows.slice(0, 30), last = page.at(-1)
  return {
    ids: page.map(row => row.id),
    nextCursor: rows.length > 30 && last ? Buffer.from(JSON.stringify({ entry: entryId ?? null, project: projectId, user: userId,
      root: last.root, rootAt: last.root_at, child: last.child, id: last.id, at: last.at } satisfies Cursor)).toString("base64url") : null,
  }
}
