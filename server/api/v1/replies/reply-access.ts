import { roomEntryRoomId } from "../entries/room-entry-scope"
import type { Prisma } from "@prisma/client"
import type { RoomAccessService } from "../rooms/room-access.service"
import { isProjectEntry } from "../projects/project-access"

type ReplyEntry = {
  id: number; status?: string; room_id?: number | null; project_id?: number | null;
  creation_origin?: string | null;
}

/** Reply editing and attachment uploads inherit current published-parent visibility. */
export async function canReplyToEntry(access: RoomAccessService, post: ReplyEntry | null, userId: number, database?: Prisma.TransactionClient): Promise<boolean> {
  if (!post || post.status !== "published" || isProjectEntry(post)) return false
  const roomId = roomEntryRoomId(post)
  if (!roomId) return false
  const context = await access.resolve(roomId, userId, new Date(), database)
  if (!context) return false
  if (context.kind === "member" && post.creation_origin !== "chat_attachment") return true
  return access.canReadPublishedPostWithRoomHistory({ ...post, status: post.status }, context, database)
}

export async function canEditEntryReply(
  access: RoomAccessService,
  reply: { user_id: number | null; status: string; entry: ReplyEntry | null } | null,
  userId: number,
): Promise<boolean> {
  return Boolean(reply && reply.user_id === userId && ["draft", "published"].includes(reply.status) && await canReplyToEntry(access, reply.entry, userId))
}
