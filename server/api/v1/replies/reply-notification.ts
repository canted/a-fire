import type { Prisma } from "@prisma/client"
import { extractPlainText } from "../../../realtime/document-content"
import { roomEntryRoomId } from "../entries/room-entry-scope"

/** Shared Reply event contract for publication and retained queue payloads. */
export function replyCreatedNotificationData(
  replyId: number,
  actorId: number | null,
  post: { id: number; room_id?: number | null },
  content: unknown,
): Prisma.NotificationEventUncheckedCreateInput | null {
  const communityId = roomEntryRoomId(post)
  if (!communityId || !actorId) return null
  const now = new Date()
  return {
    event_type: "reply_created", actor_id: actorId, room_id: communityId,
    entry_id: post.id, reply_id: replyId, target_user_id: null,
    payload: { excerpt: extractPlainText(content), replyId },
    target_path: `/app/entries/${post.id}#reply-${replyId}`,
    created_at: now, updated_at: now,
  }
}
