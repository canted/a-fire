import type { PrismaService } from "../../../prisma/prisma.service"
import type { RoomAccessService } from "../rooms/room-access.service"
import { canEditProjectEntry, isProjectEntry } from "../projects/project-access"
import { roundRoomId } from "../rounds/round-scope"
import { roomEntryRoomId } from "./room-entry-scope"

export type DraftAccessEntry = { id: number; format_data?: unknown; source_chat_message_id?: number | null; source_entry_id?: number | null; user_id: number | null; status: string; creation_origin?: string | null; project_id?: number | null; room_id?: number | null; round_id?: number | null }

/** Private originals use Project authority; independent Room copies use current membership. */
export async function canManageEntryDraft(prisma: PrismaService, access: RoomAccessService, post: DraftAccessEntry | null, userId: number, _allowPublished = false) {
  if (!post || post.status === "deleted") return false
  if (isProjectEntry(post)) return canEditProjectEntry(prisma, post, userId)
  if (post.user_id !== userId || post.project_id != null || post.source_entry_id == null
    || post.room_id == null || post.creation_origin === "chat_attachment") return false
  const membership = await access.resolve(post.room_id, userId)
  return membership?.kind === "member" && membership.canWriteWall
}

/** Concealed activity media follows the activity phase without granting edit access to the draft. */
export async function canReadRoundDraft(
  prisma: PrismaService,
  access: RoomAccessService,
  post: DraftAccessEntry | null,
  userId: number,
) {
  if (!post || post.status !== "draft" || !post.round_id) return false
  const artifact = await prisma.activityArtifact.findUnique({
    where: { entry_id: post.id },
    include: { round: true },
  })
  if (!artifact || artifact.status !== "active" || artifact.round.template_key !== "art_before_chorus") return false
  if (artifact.round_id !== post.round_id || artifact.round.status === "cancelled") return false
  let communityId: number | null
  try { communityId = roundRoomId(artifact.round) }
  catch { return false }
  if (!communityId) return false
  const postRoomId = roomEntryRoomId(post)
  if (postRoomId !== communityId) return false
  if ((await access.resolve(communityId, userId))?.kind !== "member") return false
  const complete = artifact.round.status !== "cancelled" && (
    artifact.round.status === "archived" ||
    Boolean(artifact.round.closed_at) ||
    Boolean(artifact.round.feedback_due_at && artifact.round.feedback_due_at.getTime() <= Date.now())
  )
  if (complete) return true
  if (artifact.kind === "cover" && Number(artifact.round.host_id) === userId) return true
  if (artifact.kind !== "cover") return false
  if (!artifact.round.submit_by || artifact.round.submit_by.getTime() > Date.now()) return false
  return Boolean(await prisma.activityOffer.findFirst({
    where: {
      round_id: artifact.round_id,
      user_id: userId,
      OR: [{ first_artifact_id: artifact.id }, { second_artifact_id: artifact.id }],
    },
    select: { id: true },
  }))
}
