import { roomEntryWhereScope } from "../entries/room-entry-scope"
import type { PrismaService } from "../../../prisma/prisma.service"
import { withActiveRoomTransaction } from "./room-membership-transaction"
import { parseBoardReplySettings, serializeRoomFeedbackSettings } from "../feedback-settings"
import { ForbiddenException, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"

/** Room owns active feedback defaults. */
export async function roomFeedbackSettings(database: Pick<Prisma.TransactionClient, "room">, roomId: number | null | undefined) {
  if (!roomId) throw new NotFoundException("Community not found")
  const room = await database.room.findUnique({
    where: { id: roomId, deleted_at: null },
    select: { reply_mode: true, default_feedback_types: true, default_idea_guidance: true },
  })
  if (!room) throw new NotFoundException("Community not found")
  return room
}

export type UpdateRoomFeedbackSettingsInput = {
  reply_mode?: unknown
  replyMode?: unknown
  default_feedback_types?: unknown
  defaultFeedbackTypes?: unknown
  default_idea_guidance?: unknown
  defaultIdeaGuidance?: unknown
}

/** Room defaults and inherited draft requests change in one Room-locked transaction. */
export async function updateRoomFeedbackSettings(database: PrismaService, roomId: number, userId: number, input: UpdateRoomFeedbackSettingsInput) {
  const settings = parseBoardReplySettings(input)
  return withActiveRoomTransaction(database, roomId, async tx => {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { owner_id: true } })
    if (room?.owner_id !== userId) throw new ForbiddenException("Forbidden")
    const now = new Date()
    const updated = await tx.room.update({ where: { id: roomId }, data: {
      reply_mode: settings.replyMode, default_feedback_types: settings.defaultFeedbackTypes,
      default_idea_guidance: settings.defaultIdeaGuidance, updated_at: now,
    } })
    await tx.entry.updateMany({ where: {
      status: "draft", feedback_request_customized: false, round_id: null,
      ...roomEntryWhereScope(roomId),
    }, data: {
      reply_mode: settings.replyMode,
      requested_feedback_types: settings.replyMode === "guided" ? settings.defaultFeedbackTypes : [],
      idea_guidance: settings.replyMode === "guided" ? settings.defaultIdeaGuidance : null,
      updated_at: now,
    } })
    return serializeRoomFeedbackSettings(updated, { canEditReplyMode: true })
  })
}
