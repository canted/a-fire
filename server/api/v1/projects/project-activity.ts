import { latestProjectMaterial } from "./project-material-summary"
import { availableChatAttachmentSql } from "../../v2/rooms/chat-visibility"
import { Prisma } from "@prisma/client"
import { extractPlainText } from "../../../realtime/document-content"
import { truncateText } from "../entries/post-content"

export type ProjectActivity = {
  material_activity_at: string | null
  latest_material: {
    id: number
    added_at: string
    intent: string | null
    author: { id: number; username: string }
  } | null
  unread_feedback_count: number
  latest_unread_feedback: {
    reply_id: number
    entry_id: number
    published_at: string
    source_author_name: string
    excerpt: string | null
    room_name: string | null
  } | null
}

export const emptyProjectActivity = (): ProjectActivity => ({
  material_activity_at: null, latest_material: null, unread_feedback_count: 0, latest_unread_feedback: null,
})

type RoundRow = {
  project_id: number
  material_id: number | null; material_at: Date | null; project_intent: string | null
  author_id: number | null; author_name: string | null
  reply_id: number | null; entry_id: number | null; reply_at: Date | null
  unread_count: number | null; reply_author: string | null; room_name: string | null
  reply_content: Prisma.JsonValue | null
}

/** Caller passes only projects the viewer owns or has accepted membership in.
 * SQL reduces histories before returning them: one row per requested Project,
 * including at most one material and one reply document. Counts remain exact.
 * Exact unread counts still require database work proportional to matching
 * feedback; this bounds application memory, not the total query execution cost.
 */
export async function loadProjectActivity(database: Pick<Prisma.TransactionClient, "$queryRaw">, projectIds: number[], userId: number): Promise<Map<number, ProjectActivity>> {
  const activity = new Map(projectIds.map(id => [id, emptyProjectActivity()]))
  if (!projectIds.length) return activity
  const rows = await database.$queryRaw<RoundRow[]>(Prisma.sql`
    -- Resolve scope/source once per share before joining its many replies.
    WITH submissions AS MATERIALIZED (
      SELECT p.id,p.room_id,room.name AS room_name,membership.unseen_started_at,
        CASE WHEN p.source_entry_id IS NULL THEN p.project_id ELSE source.project_id END AS project_id
      FROM entries p
      JOIN room_memberships membership ON membership.room_id=p.room_id
        AND membership.user_id=${userId} AND NOT membership.disabled
      JOIN rooms room ON room.id=p.room_id AND room.deleted_at IS NULL

      LEFT JOIN entries source ON source.id=p.source_entry_id
      WHERE p.user_id=${userId} AND p.status='published'
        AND (p.creation_origin IS DISTINCT FROM 'chat_attachment'
          OR ${availableChatAttachmentSql(Prisma.sql`p.id`, Prisma.sql`p.room_id`)})
        AND ((p.source_entry_id IS NULL AND p.project_id IN (${Prisma.join([...activity.keys()])}))
          OR (source.project_id IN (${Prisma.join([...activity.keys()])}) AND source.status='published'
            AND source.creation_origin='project_material' AND source.room_id IS NULL))
    ), feedback AS (
      SELECT DISTINCT ON (submission.project_id) submission.project_id,
        r.id,r.entry_id,r.user_id,submission.room_id,submission.room_name,
        COALESCE(r.published_at,r.created_at) AS reply_at,
        count(*) OVER (PARTITION BY submission.project_id)::integer AS unread_count
      FROM submissions submission
      JOIN replies r ON r.entry_id=submission.id AND r.status='published' AND r.user_id IS DISTINCT FROM ${userId}
      LEFT JOIN entry_view_states seen ON seen.entry_id=submission.id AND seen.user_id=${userId}
      WHERE COALESCE(r.published_at,r.created_at)>submission.unseen_started_at
        AND (seen.reply_seen_through_at IS NULL OR
          (COALESCE(r.published_at,r.created_at),r.id)>(seen.reply_seen_through_at,COALESCE(seen.reply_seen_through_id,0)))
      ORDER BY submission.project_id,COALESCE(r.published_at,r.created_at) DESC,r.id DESC
    )
    SELECT requested.id AS project_id,
      material.id AS material_id, material.added_at AS material_at, material.project_intent,
      author.id AS author_id, author.username AS author_name,
      feedback.id AS reply_id, feedback.entry_id, feedback.reply_at, feedback.unread_count,
      COALESCE(NULLIF(member_name.username_override,''), reviewer.username, 'Someone') AS reply_author,
      feedback.room_name, document.content AS reply_content
    FROM unnest(ARRAY[${Prisma.join([...activity.keys()])}]::integer[]) requested(id)
    LEFT JOIN LATERAL (
      ${latestProjectMaterial(Prisma.sql`requested.id`)}
    ) material ON true
    LEFT JOIN users author ON author.id=material.user_id
    LEFT JOIN feedback ON feedback.project_id=requested.id
    LEFT JOIN users reviewer ON reviewer.id=feedback.user_id
    LEFT JOIN room_memberships member_name ON member_name.room_id=feedback.room_id
      AND member_name.user_id=feedback.user_id AND NOT member_name.disabled
    LEFT JOIN LATERAL (
      SELECT content FROM documents WHERE docable_type='Reply' AND docable_id=feedback.id ORDER BY id DESC LIMIT 1
    ) document ON true`)
  for (const row of rows) {
    const value = activity.get(row.project_id)!
    if (row.material_id != null && row.material_at && row.author_id != null) {
      value.material_activity_at = row.material_at.toISOString()
      value.latest_material = { id: row.material_id, added_at: value.material_activity_at, intent: row.project_intent,
        author: { id: row.author_id, username: row.author_name ?? "Someone" } }
    }
    value.unread_feedback_count = row.unread_count ?? 0
    if (row.reply_id != null && row.entry_id != null && row.reply_at) {
      const text = extractPlainText(row.reply_content)
      value.latest_unread_feedback = { reply_id: row.reply_id, entry_id: row.entry_id, published_at: row.reply_at.toISOString(),
        source_author_name: row.reply_author ?? "Someone", excerpt: text ? truncateText(text, 180) : null, room_name: row.room_name }
    }
  }
  return activity
}

/** Projects with additions lead; an empty project falls back to creation only among other empty projects. */
export function compareProjectActivity(a: { id: number; created_at: Date }, b: { id: number; created_at: Date }, activity: Map<number, ProjectActivity>) {
  const aAt = activity.get(a.id)?.material_activity_at
  const bAt = activity.get(b.id)?.material_activity_at
  if (aAt && !bAt) return -1
  if (!aAt && bAt) return 1
  return (aAt && bAt ? Date.parse(bAt) - Date.parse(aAt) : b.created_at.getTime() - a.created_at.getTime()) || b.id - a.id
}
