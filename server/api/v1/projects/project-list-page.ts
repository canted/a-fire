import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { latestProjectMaterial } from "./project-material-summary"

type Cursor = { user: number; room: number | null; invitations: boolean; id: number; material: string | null; created: string }
type Row = { id: number; material: string | null; created: string }
const validDate = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 23) === value.slice(0, 23)

/** Preserve activity ordering while bounding hydration. Pending invitations have
 * no material activity: their private contents must not affect the visible sort.
 * Cursors carry values, so deleting the anchor does not break continuation.
 */
export async function projectListPage(database: Pick<Prisma.TransactionClient, "$queryRaw">, userId: number, roomId?: number, token = "", options: { size?: 3 | 30; invitations?: boolean } = {}) {
  const size = options.size ?? 30, invitations = options.invitations ?? true
  let cursor: Cursor | null = null
  if (token) {
    try {
      if (token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error()
      cursor = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
      if (!cursor || cursor.user !== userId || cursor.room !== (roomId ?? null) || cursor.invitations !== invitations
        || !Number.isInteger(cursor.id) || cursor.id < 1 || cursor.id > 2147483647
        || !validDate(cursor.created) || (cursor.material !== null && !validDate(cursor.material))) throw Error()
    } catch { throw new BadRequestException("Invalid Project list cursor") }
  }
  const rows = await database.$queryRaw<Row[]>(Prisma.sql`
    SELECT project.id,
      to_char(material.added_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS material,
      to_char(project.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created
    FROM projects project
    LEFT JOIN project_participations participant ON participant.project_id=project.id AND participant.user_id=${userId}
    LEFT JOIN LATERAL (
      ${latestProjectMaterial(Prisma.sql`project.id`)}
    ) material ON project.owner_id=${userId} OR participant.status='accepted'
    WHERE (project.owner_id=${userId} OR participant.status IN (${Prisma.join(invitations ? ["accepted", "pending"] : ["accepted"])}))
      ${roomId ? Prisma.sql`AND EXISTS (SELECT 1 FROM project_rooms WHERE project_id=project.id AND room_id=${roomId})` : Prisma.empty}
      ${cursor ? cursor.material !== null
        ? Prisma.sql`AND (material.added_at IS NULL OR (material.added_at,project.id)<(${cursor.material}::timestamp,${cursor.id}))`
        : Prisma.sql`AND material.added_at IS NULL AND (project.created_at,project.id)<(${cursor.created}::timestamp,${cursor.id})`
        : Prisma.empty}
    ORDER BY material.added_at DESC NULLS LAST,
      CASE WHEN material.added_at IS NULL THEN project.created_at END DESC,project.id DESC LIMIT ${size + 1}`)
  const page = rows.slice(0, size), last = page.at(-1)
  return { ids: page.map(row => row.id), nextCursor: rows.length > size && last
    ? Buffer.from(JSON.stringify({ user: userId, room: roomId ?? null, invitations, ...last } satisfies Cursor)).toString("base64url") : null }
}
