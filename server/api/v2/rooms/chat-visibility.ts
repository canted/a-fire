import { hasChatAttachment } from "./chat-content"
import { Prisma } from "@prisma/client"

const CHAT_LIFETIME_MS = 14 * 24 * 60 * 60 * 1_000

/** SQL counterpart for aggregates that cannot hydrate every historical message.
 * The recursive walk follows only arrays and content, exactly as hasChatAttachment
 * does; attachment-looking metadata in attributes does not grant availability.
 * Expressions must come from fixed caller aliases, never request text.
 */
export function availableChatAttachmentSql(postId: Prisma.Sql, roomId: Prisma.Sql, now = new Date()) {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM chat_messages attachment_message
    WHERE attachment_message.entry_id=${postId} AND attachment_message.room_id=${roomId}
      AND attachment_message.status='published' AND attachment_message.timeline_kind='message'
      AND attachment_message.expires_at>(${now}::timestamptz AT TIME ZONE 'UTC')
      AND attachment_message.created_at>(${new Date(now.getTime() - CHAT_LIFETIME_MS)}::timestamptz AT TIME ZONE 'UTC')
      AND EXISTS (
        WITH RECURSIVE nodes(value) AS (
          SELECT attachment_message.content::jsonb
          UNION ALL
          SELECT child.value FROM nodes
          CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(nodes.value)
            WHEN 'array' THEN nodes.value
            WHEN 'object' THEN jsonb_build_array(nodes.value->'content')
            ELSE '[]'::jsonb END) child(value)
        )
        SELECT 1 FROM nodes WHERE jsonb_typeof(value)='object'
          AND value->>'type' IN ('image','audio','video','file')
      )
  )`
}

/** Read-time boundary; cleanup timing and historical pins cannot extend access. */
export function availableChatMessageWhere(now: Date): Prisma.ChatMessageWhereInput {
  return {
    status: "published",
    expires_at: { gt: now },
    created_at: { gt: new Date(now.getTime() - CHAT_LIFETIME_MS) },
  }
}

/** One attachment availability check for Room reads and durable-copy creation. */
export async function findAvailableChatAttachment(prisma: Pick<Prisma.TransactionClient, "chatMessage">, postId: number, roomId: number, now = new Date()) {
  const message = await prisma.chatMessage.findFirst({
    where: { entry_id: postId, room_id: roomId, ...availableChatMessageWhere(now) },
    select: { id: true, timeline_kind: true, content: true },
  })
  return message?.timeline_kind === "message" && hasChatAttachment(message.content) ? message : null
}

/** Batched equivalent for bounded Entry lists; legacy pins never extend availability. */
export async function availableChatAttachmentEntryIds(
  prisma: Pick<Prisma.TransactionClient, "chatMessage">,
  entries: Array<{ entryId: number; roomId: number }>,
  now = new Date(),
): Promise<Set<number>> {
  if (!entries.length) return new Set()
  const messages = await prisma.chatMessage.findMany({
    where: { ...availableChatMessageWhere(now), OR: entries.map(entry => ({ entry_id: entry.entryId, room_id: entry.roomId })) },
    select: { entry_id: true, timeline_kind: true, content: true },
  })
  return new Set(messages.filter(message => message.entry_id != null && message.timeline_kind === "message" && hasChatAttachment(message.content)).map(message => message.entry_id!))
}

/** Identity discovery for a limited visitor's visible Chat window. Access must
 * already be established; callers intersect these authors with active members.
 * Retained historical replies remain readable with their visible parent.
 */
export async function limitedChatAuthorIds(
  database: Pick<Prisma.TransactionClient, "chatMessage" | "reply">,
  roomId: number,
  now = new Date(),
): Promise<number[]> {
  const messages = await database.chatMessage.findMany({
    where: { room_id: roomId, ...availableChatMessageWhere(now) },
    orderBy: { id: "desc" }, take: 10, select: { id: true, author_id: true, entry_id: true },
  })
  const postIds = messages.flatMap(message => message.entry_id ? [message.entry_id] : [])
  const replies = messages.length ? await database.reply.findMany({
    where: { status: "published", OR: [{ chat_message_id: { in: messages.map(message => message.id) } }, { entry_id: { in: postIds } }] },
    select: { user_id: true }, distinct: ["user_id"],
  }) : []
  return [...new Set([
    ...messages.map(message => message.author_id),
    ...replies.flatMap(reply => reply.user_id ? [reply.user_id] : []),
  ])]
}
