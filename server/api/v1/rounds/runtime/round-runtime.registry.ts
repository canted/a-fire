import { BadRequestException, Inject, Injectable } from "@nestjs/common"
import type { Round as Activity, Prisma } from "@prisma/client"
import { PrismaService } from "../../../../prisma/prisma.service"
import { notifyRoomChanged } from "../../../../realtime/room-change"
import { lockRound } from "../publish-round-wall"
import { syncRoundChat } from "../round-chat"
import type { RoomAccessKind } from "../../rooms/room-access.service"
import { ArtBeforeChorusRoundService } from "./art-before-chorus.activity.service"
import { activityTemplateDefinition } from "./round-template.definition"
import type {
  RoundArtifactInput,
  RoundChoiceInput,
  RoundRemovalInput,
} from "./round-runtime.types"

@Injectable()
export class RoundRuntime {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async syncChat(activityId: number, transaction?: Prisma.TransactionClient): Promise<Array<{ id: number; room_id: number }>> {
    if (!transaction) return this.prisma.$transaction(async tx => {
      await lockRound(tx, activityId)
      const activity = await tx.round.findUnique({ where: { id: activityId }, select: { host_id: true } })
      if (!activity) return []
      const previous = await tx.chatMessage.findMany({
        where: { author_id: activity.host_id, client_nonce: { in: ["created", "started", "next-phase"].map(key => `round:${activityId}:${key}`) } },
        select: { id: true },
      })
      const existing = new Set(previous.map(message => message.id))
      const messages = await this.syncChat(activityId, tx)
      for (const roomId of new Set(messages.filter(message => !existing.has(message.id)).map(message => message.room_id))) {
        await notifyRoomChanged(tx, roomId)
      }
      return messages
    })
    const activity = await transaction.round.findUnique({ where: { id: activityId } })
    if (!activity) return []
    return (activity.template_key === "art_before_chorus"
      ? await this.artBeforeChorus.syncChat(activityId, transaction)
      : await syncRoundChat(transaction, activityId)) ?? []
  }
  @Inject(ArtBeforeChorusRoundService)
  private readonly artBeforeChorus!: ArtBeforeChorusRoundService

  definition(key: unknown) {
    return activityTemplateDefinition(key)
  }

  async prepareForDetail(activity: Activity, userId: number, accessKind: RoomAccessKind) {
    if (activity.template_key === "art_before_chorus") {
      await this.artBeforeChorus.prepareForDetail(activity, userId, accessKind)
    }
  }

  async detail(activity: Activity, userId: number, accessKind: RoomAccessKind) {
    if (activity.template_key === "art_before_chorus") return this.artBeforeChorus.detail(activity, userId, accessKind)
    return undefined
  }

  async validateDraft(activity: Activity, userId: number, creationOrigin?: string | null, transaction?: Prisma.TransactionClient) {
    if (activity.template_key === "art_before_chorus") {
      return this.artBeforeChorus.validateDraft(activity, userId, creationOrigin, transaction)
    }
    return null
  }

  async submitArtifact(activity: Activity, userId: number, input: RoundArtifactInput) {
    if (activity.template_key === "art_before_chorus") return this.artBeforeChorus.submitArtifact(activity, userId, input)
    throw new BadRequestException("This Activity does not use activity contributions")
  }

  async choose(activity: Activity, userId: number, input: RoundChoiceInput) {
    if (activity.template_key === "art_before_chorus") return this.artBeforeChorus.chooseCover(activity, userId, input)
    throw new BadRequestException("This Activity does not have a choice step")
  }

  async removeArtifact(activity: Activity, userId: number, input: RoundRemovalInput) {
    if (activity.template_key === "art_before_chorus") return this.artBeforeChorus.removeCover(activity, userId, input)
    throw new BadRequestException("This Activity does not support contribution moderation")
  }

  async complete(activityId: number, templateKey: string, force = false, authorize?: (tx: Prisma.TransactionClient) => Promise<void>) {
    if (templateKey === "art_before_chorus") await this.artBeforeChorus.finalize(activityId, force, authorize)
  }
}
