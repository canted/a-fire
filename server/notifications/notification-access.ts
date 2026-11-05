import type { Prisma } from "@prisma/client"
import type { RoomAccessService } from "../api/v1/rooms/room-access.service"
import { canReplyToEntry } from "../api/v1/replies/reply-access"
import { hasLimitedRoomHistory } from "../api/v1/rooms/room-door-policy"
import { canReadRoundStatus } from "../api/v1/rounds/round-visibility"

function positiveId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function postIdFor(postId: number | string | null | undefined, targetPath?: string | null): number | null {
  const pathId = targetPath?.match(/\/(?:posts?|entries)\/([^/?#]+)/i)?.[1]
  if (postId !== null && postId !== undefined) {
    const id = positiveId(postId)
    return pathId !== undefined && positiveId(pathId) !== id ? null : id
  }
  return positiveId(pathId)
}

export function replyIdFor(payload: Record<string, unknown>, targetPath?: string | null): string | null {
  const pathId = targetPath?.match(/#reply-([^/?#]+)/)?.[1]
  const values = [payload.replyId, payload.reply_id, pathId].filter(value => value !== undefined && value !== null)
  if (!values.length) return null
  const id = positiveId(values[0])
  return !id || values.some(value => positiveId(value) !== id) ? "" : String(id)
}

function chatNoticeMatchesMessage(event: { room_id?: number | null; target_path?: string | null }, messageId: number, roomId: number): boolean {
  const pathRoom = event.target_path?.match(/\/(?:circles|rooms)\/([^/?#]+)/i)?.[1]
  const pathMessage = event.target_path?.match(/\/messages\/([^/?#]+)/i)?.[1]
  const anchorMessage = event.target_path?.match(/#chat-([^/?#]+)/i)?.[1]
  return (event.room_id == null || event.room_id === roomId) &&
    (pathRoom === undefined || positiveId(pathRoom) === roomId) &&
    [pathMessage, anchorMessage].every(value => value === undefined || positiveId(value) === messageId)
}

/** Structural identity shared by live authorization and offline reference retirement.
 * Resolving scope never grants audience access or changes a visit lease.
 */
export async function roundNotificationScope(database: Prisma.TransactionClient, event: {
  id?: number; event_type: string; payload?: unknown;
  room_id?: number | null; target_path?: string | null;
}) {
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {}
  const roundPath = event.target_path?.match(/\/(?:activities|rounds)\/([^/?#]+)/i)?.[1]
  const references = [payload.round_id, payload.activity_id, roundPath].filter(value => value !== undefined && value !== null)
  const roundId = positiveId(references[0])
  if (!roundId || references.some(value => positiveId(value) !== roundId)) return null
  const round = await database.round.findUnique({
    where: { id: roundId },
    select: { room_id: true, status: true },
  })
  const roomId = round?.room_id
  if (!round || !roomId || (event.room_id != null && event.room_id !== roomId)) return null
  return { roundId, roomId, status: round.status }
}

/** Retained notification content inherits its live source audience. */
export async function canReadContentNotice(
  access: RoomAccessService,
  database: Prisma.TransactionClient,
  userId: number | null | undefined,
  event: { id?: number; event_type: string; payload?: unknown; entry_id?: number | null; room_id?: number | null; target_user_id?: number | null; target_path?: string | null },
): Promise<boolean> {
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown> : {}
  if (event.event_type === "chat_save_requested") {
    const requestId = positiveId(payload.chat_save_request_id)
    const messageId = positiveId(payload.chat_message_id)
    if (!positiveId(userId) || !requestId || !messageId || event.target_user_id !== userId) return false
    const request = await database.chatSaveRequest.findUnique({
      where: { id: requestId },
      select: { message_id: true, owner_id: true, status: true, message: { select: { room_id: true, author_id: true } } },
    })
    if (!request || request.status !== "pending" || request.message_id !== messageId ||
      request.owner_id !== userId || request.message.author_id !== userId ||
      (event.room_id != null && event.room_id !== request.message.room_id)) return false
    if (!chatNoticeMatchesMessage(event, messageId, request.message.room_id)) return false
    return access.canReadPublishedChatMessage(messageId, userId!, new Date(), database)
  }
  if (event.event_type === "circle_join_requested" || event.event_type === "circle_join_approved") {
    const id = positiveId(payload.join_request_id)
    if (!positiveId(userId) || !id || event.target_user_id !== userId) return false
    const request = await database.roomJoinRequest.findUnique({
      where: { id }, select: { room_id: true, user_id: true, status: true },
    })
    if (!request || (event.room_id != null && event.room_id !== request.room_id)) return false
    const pathRoom = event.target_path?.match(/\/(?:circles|rooms)\/([^/?#]+)/i)?.[1]
    if (pathRoom !== undefined && positiveId(pathRoom) !== request.room_id) return false
    const context = await access.resolve(request.room_id, userId!, new Date(), database)
    if (context?.kind !== "member") return false
    return event.event_type === "circle_join_requested" ? context.canManage :
      request.user_id === userId && request.status === "approved"
  }
  if (event.event_type === "circle_knock_suggested") {
    const roomId = positiveId(event.room_id)
    if (!positiveId(userId) || !roomId || event.target_user_id !== userId) return false
    const room = await database.room.findUnique({
      where: { id: roomId }, select: { parent_id: true, porosity: true, deleted_at: true },
    })
    if (!room?.parent_id || room.deleted_at || room.porosity !== "closed") return false
    const pathParent = event.target_path?.match(/\/(?:circles|rooms)\/([^/?#]+)\/(?:side-circles|adjacent-rooms)/i)?.[1]
    if (pathParent !== undefined && positiveId(pathParent) !== room.parent_id) return false
    // Suggestions are addressed to parent members who have not joined the child.
    // Reading one never creates a knock or a visit lease.
    const parent = await access.resolve(room.parent_id, userId!, new Date(), database)
    if (parent?.kind !== "member") return false
    return !await database.roomMembership.findFirst({
      where: { room_id: roomId, user_id: userId!, disabled: false }, select: { id: true },
    })
  }
  if (event.event_type === "circle_member_invited") {
    const id = positiveId(payload.invitation_id)
    if (!positiveId(userId) || !id) return false
    const invitation = await database.roomMemberInvitation.findUnique({
      where: { id },
      select: { user_id: true, room_id: true, status: true, room: { select: { deleted_at: true } } },
    })
    if (!invitation || invitation.user_id !== userId || invitation.room.deleted_at ||
      (event.room_id != null && event.room_id !== invitation.room_id)) return false
    const pathRoom = event.target_path?.match(/\/(?:circles|rooms)\/([^/?#]+)/i)?.[1]
    if (pathRoom !== undefined && positiveId(pathRoom) !== invitation.room_id) return false
    if (invitation.status === "pending") return true
    if (invitation.status !== "accepted") return false
    return (await access.resolve(invitation.room_id, userId!, new Date(), database))?.kind === "member"
  }
  let sourcePostId = event.entry_id
  if (event.event_type === "introduction_created") {
    const pathId = event.target_path?.match(/[?&]introduction=([^&#]*)/)?.[1]
    const references = [payload.introductionId, payload.introduction_id, pathId].filter(value => value !== undefined && value !== null)
    const id = positiveId(references[0])
    if (!positiveId(userId) || !id || references.some(value => positiveId(value) !== id)) return false
    const introduction = await database.introduction.findUnique({
      where: { id },
      select: { room_id: true, entry_id: true, retracted_at: true,
        recipients: { where: { user_id: userId! }, select: { hidden_at: true } } },
    })
    if (!introduction || introduction.retracted_at || introduction.recipients.length !== 1 ||
      introduction.recipients[0].hidden_at ||
      (event.room_id != null && event.room_id !== introduction.room_id) ||
      (event.entry_id != null && event.entry_id !== introduction.entry_id)) return false
    const context = await access.resolve(introduction.room_id, userId!, new Date(), database)
    if (context?.kind !== "member") return false
    sourcePostId = introduction.entry_id
  }
  if (event.event_type === "chat_message_created") {
    const messageId = positiveId(payload.chat_message_id)
    if (!positiveId(userId) || !messageId || !await access.canReadPublishedChatMessage(messageId, userId!, new Date(), database)) return false
    const message = await database.chatMessage.findUnique({ where: { id: messageId }, select: { room_id: true } })
    return Boolean(message && chatNoticeMatchesMessage(event, messageId, message.room_id))
  }
  if (event.event_type === "chat_reply_created") {
    const messageId = positiveId(payload.chat_message_id)
    const replyId = positiveId(replyIdFor(payload, event.target_path))
    if (!positiveId(userId) || !messageId || !replyId) return false
    const reply = await database.reply.findUnique({ where: { id: replyId }, select: { chat_message_id: true, status: true } })
    if (!reply || reply.status !== "published" || reply.chat_message_id !== messageId) return false
    const message = await database.chatMessage.findUnique({ where: { id: messageId }, select: { room_id: true } })
    if (!message || !chatNoticeMatchesMessage(event, messageId, message.room_id)) return false
    return access.canReadPublishedChatMessage(messageId, userId!, new Date(), database)
  }
  let sourceAuthorized = event.event_type === "introduction_created"
  const roundPath = event.target_path?.match(/\/(?:activities|rounds)\/([^/?#]+)/i)?.[1]
  if (event.event_type.startsWith("round_") || roundPath !== undefined) {
    if (!positiveId(userId)) return false
    const scope = await roundNotificationScope(database, event)
    if (!scope) return false
    const { roomId, status } = scope
    const context = await access.resolve(roomId, userId!, new Date(), database)
    if (!context) return false
    if (!canReadRoundStatus(status, context.kind, hasLimitedRoomHistory(context))) return false
    sourceAuthorized = true
  }
  const postId = postIdFor(sourcePostId, event.target_path)
  const replyId = replyIdFor(payload, event.target_path)
  const entryTarget = postId !== null || event.entry_id != null || /\/(?:posts?|entries)\//i.test(event.target_path ?? "") || ["post_created", "reply_created", "mention", "chat_message_saved_as_post"].includes(event.event_type)
  if (!entryTarget) return sourceAuthorized
  if (!positiveId(userId) || !postId) return false
  const post = await database.entry.findUnique({
    where: { id: postId },
    select: {
      id: true, status: true, room_id: true, project_id: true,
      creation_origin: true,
    },
  })
  if (!post || (event.room_id != null && event.room_id !== post.room_id)) return false
  if (!(await canReplyToEntry(access, post, userId!, database))) return false
  if (replyId !== null || event.event_type === "reply_created") {
    const id = positiveId(replyId)
    if (!id) return false
    const reply = await database.reply.findUnique({ where: { id }, select: { entry_id: true, status: true } })
    if (!reply || reply.entry_id !== post.id || reply.status !== "published") return false
  }
  return true
}
