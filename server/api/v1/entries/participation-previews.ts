import { BadRequestException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { availableChatAttachmentEntryIds } from "../../v2/rooms/chat-visibility"
import { presentImageDocuments } from "../uploads/image-presentation"
import { roomEntryRoomId } from "./room-entry-scope"
import { entryMembershipMap, serializeEntryUser } from "./entry-user-presentation"
import { entryContentPresentation } from "./shared-entry-presentation"
import { DEFAULT_TIPTAP_DOC, normalizeUploadUrls, entryBody } from "./post-content"

type Reference = { entryId: string; replyId?: string }
/** Caller holds member Room authority and supplies only its authorized participation page. */
export async function readParticipationPreviews(database: Prisma.TransactionClient, roomId: number, viewerId: number, references: Reference[]) {
  if (references.length > 100) throw new BadRequestException("Participation preview page exceeds 100")
  const postIds = [...new Set(references.map(item => Number(item.entryId)))]
  if (postIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new BadRequestException("Invalid Entry reference")
  if (!postIds.length) return new Map<number, never>()
  const candidates = await database.entry.findMany({ where: { id: { in: postIds }, status: "published", project_id: null }, include: { user: true } })
  const scoped = candidates.filter(post => roomEntryRoomId(post) === roomId)
  const available = await availableChatAttachmentEntryIds(database, scoped.filter(post => post.creation_origin === "chat_attachment").map(post => ({ entryId: post.id, roomId })))
  const posts = scoped.filter(post => post.creation_origin !== "chat_attachment" || available.has(post.id))
  const visibleIds = posts.map(post => post.id)
  if (!visibleIds.length) return new Map<number, never>()
  const requestedReplies = references.filter(item => item.replyId && visibleIds.includes(Number(item.entryId))).map(item => ({ id: Number(item.replyId), entry_id: Number(item.entryId) }))
  if (requestedReplies.some(reply => !Number.isSafeInteger(reply.id) || reply.id <= 0)) throw new BadRequestException("Invalid reply reference")
  const replies = requestedReplies.length ? await database.reply.findMany({ where: { OR: requestedReplies, user_id: viewerId, status: "published" }, include: { user: true } }) : []
  // Constant per-Entry branches preserve planner estimates for crowded Entries;
  // a correlated unnest lookup can underestimate them and sort their full history.
  // Match the existing detail card's first-page summary, without loading 200 bodies.
  const participants = await database.$queryRaw<{ entry_id: number; id: number; username: string }[]>(Prisma.sql`
    WITH participation_reply_page AS (
      ${Prisma.join(visibleIds.map(id => Prisma.sql`(
        SELECT entry_id, user_id, published_at, id FROM replies
        WHERE entry_id = ${id} AND status = 'published'
        ORDER BY published_at ASC, id ASC LIMIT 200
      )`), " UNION ALL ")}
    ), first_reply AS (
      SELECT DISTINCT ON (entry_id, user_id) entry_id, user_id, published_at, id
      FROM participation_reply_page ORDER BY entry_id, user_id, published_at ASC, id ASC
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY entry_id ORDER BY published_at ASC, id ASC) AS position
      FROM first_reply
    )
    SELECT ranked.entry_id, u.id, u.username FROM ranked JOIN users u ON u.id = ranked.user_id
    WHERE ranked.position <= 3 ORDER BY ranked.entry_id, ranked.published_at ASC, ranked.id ASC
  `)
  const documents = await database.document.findMany({ where: { OR: [
    { docable_type: "Post", docable_id: { in: visibleIds } },
    { docable_type: "Reply", docable_id: { in: replies.map(reply => reply.id) } },
  ] }, select: { docable_type: true, docable_id: true, content: true } })
  const docs = new Map(documents.map(doc => [`${doc.docable_type}:${doc.docable_id}`, doc.content]))
  const hydrated = await presentImageDocuments(database, [
    ...posts.map(post => normalizeUploadUrls(entryBody(docs.get(`Post:${post.id}`)))),
    ...replies.map(reply => normalizeUploadUrls(docs.get(`Reply:${reply.id}`) ?? DEFAULT_TIPTAP_DOC)),
  ])
  const memberships = await entryMembershipMap(database, roomId, [...new Set([...posts.map(post => post.user_id), ...replies.map(reply => reply.user_id), ...participants.map(user => user.id)].filter((id): id is number => id !== null))])
  const identity = (user: { id: number; username: string }) => serializeEntryUser(user, memberships.get(`${user.id}:${roomId}`))
  return new Map(posts.map((post, index) => [post.id, {
    entry: { id: post.id, ...entryContentPresentation(post, hydrated[index]), user: identity(post.user) },
    replies: replies.flatMap((reply, replyIndex) => reply.entry_id === post.id ? [{ id: reply.id, content: hydrated[posts.length + replyIndex], user: reply.user ? identity(reply.user) : null }] : []),
    participants: participants.filter(user => user.entry_id === post.id).map(identity),
  }]))
}
