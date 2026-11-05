import { roomReplySummaries } from "../entries/room-reply-summary"
import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { availableChatAttachmentEntryIds } from "../../v2/rooms/chat-visibility"
import { identityImageUrls } from "../uploads/identity-images"

type Cursor = { project: number; entry: number; user: number; at: string; id: number }
type Row = { id: number; room_id: number; room_name: string | null; round_id: number | null; reply_count: bigint; creation_origin: string | null; at: string }

/** Caller authorizes the private source. Each copy independently requires current Room membership. */
export async function projectCopyPage(database: Pick<Prisma.TransactionClient, "$queryRaw" | "chatMessage">, projectId: number, entryId: number, userId: number, token?: string) {
  let cursor: Cursor | null = null
  if (token !== undefined) {
    try {
      if (token.length>512 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error()
      cursor=JSON.parse(Buffer.from(token,"base64url").toString("utf8"))
      if (!cursor || cursor.project!==projectId || cursor.entry!==entryId || cursor.user!==userId
        || !Number.isInteger(cursor.id) || cursor.id<1 || cursor.id>2147483647 || typeof cursor.at!=="string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at)
        || !Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString().slice(0,23)!==cursor.at.slice(0,23)) throw Error()
    } catch { throw new BadRequestException("Invalid Project copy cursor") }
  }
  const rows=await database.$queryRaw<Row[]>(Prisma.sql`
    WITH page AS MATERIALIZED (
      SELECT p.id,p.room_id AS room_id,c.name AS room_name,p.round_id AS round_id,p.creation_origin,
        COALESCE(p.published_at,p.created_at) AS at_sort,
        to_char(COALESCE(p.published_at,p.created_at),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      FROM entries p JOIN rooms c ON c.id=p.room_id AND c.deleted_at IS NULL
      WHERE p.source_entry_id=${entryId} AND p.status='published' AND p.project_id IS NULL
        AND EXISTS (SELECT 1 FROM room_memberships m WHERE m.room_id=p.room_id AND m.user_id=${userId} AND NOT m.disabled)
        ${cursor ? Prisma.sql`AND (COALESCE(p.published_at,p.created_at),p.id)<(${cursor.at}::timestamp,${cursor.id})` : Prisma.empty}
      ORDER BY COALESCE(p.published_at,p.created_at) DESC,p.id DESC LIMIT 21
    )
    SELECT page.*, (SELECT count(*) FROM replies r WHERE r.entry_id=page.id AND r.status='published') AS reply_count
    FROM page ORDER BY at_sort DESC,id DESC`)
  const page=rows.slice(0,20), last=page.at(-1)
  const available = await availableChatAttachmentEntryIds(database, page.filter(row => row.creation_origin === "chat_attachment")
    .map(row => ({ entryId: row.id, roomId: row.room_id })))
  const visible = page.filter(row => row.creation_origin !== "chat_attachment" || available.has(row.id))
  const icons=await identityImageUrls(database,"Circle",visible.map(row=>row.room_id))
  const replies = new Map((await roomReplySummaries(database, visible.map(row => row.id))).map(summary => [summary.entry_id, summary.participants]))
  return {
    submissions: visible.map(({at,reply_count,room_name,...row})=>({ id:row.id,room_id:row.room_id,round_id:row.round_id,
      reply_participants: replies.get(row.id) ?? [], room_name:room_name ?? "Room",reply_count:Number(reply_count),circle_icon_url:icons.get(row.room_id) ?? null })),
    nextCursor: rows.length>20 && last ? Buffer.from(JSON.stringify({project:projectId,entry:entryId,user:userId,at:last.at,id:last.id} satisfies Cursor)).toString("base64url") : null,
  }
}
