import { roomEntryRoomId } from "../entries/room-entry-scope"
import { canEditEntryReply } from "../replies/reply-access"
import { BossService } from "../../../queue/boss.service"
import { AUDIO_SPECTRUM_QUEUE } from "../../../queue/queue-names"
import { cachedAudioSpectrum } from "../../../uploads/audio/audio-spectrum"
import { AUDIO_SPECTRUM_VERSION, type AudioSpectrum } from "../../../../types/audio-spectrum"
import { RoomAccessService } from "../rooms/room-access.service";
import { canManageEntryDraft, canReadRoundDraft } from "../entries/entry-draft-access";
import { canReadProjectEntry, isProjectEntry } from "../projects/project-access"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { StorageService } from "../../../storage/storage.service"
import { parseMediaRange, type MediaStreamPayload } from "../../../storage/media-range"

@Injectable()
export class AudioAssetsService {
  @Inject(BossService)
  private readonly boss!: BossService

  async getSpectrumForUser(audioAssetId: number, userId: number): Promise<AudioSpectrum> {
    const asset = await this.getAudioAssetForUser(audioAssetId, userId)
    if (asset.processing_status !== "ready") return { version: AUDIO_SPECTRUM_VERSION, status: asset.processing_status === "failed" ? "unavailable" : "pending" }
    const cached = cachedAudioSpectrum(asset.blob.metadata)
    if (cached) return cached
    await this.boss.enqueue(AUDIO_SPECTRUM_QUEUE, { audioAssetId }, { singletonKey: String(audioAssetId), singletonSeconds: 300 })
    return { version: AUDIO_SPECTRUM_VERSION, status: "pending" }
  }

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(StorageService)
  private readonly storage!: StorageService

  async getAudioAssetForUser(audioAssetId: number, userId: number) {
    const asset = await this.prisma.audioAsset.findUnique({
      where: { id: audioAssetId },
      include: { blob: true },
    })
    if (!asset?.blob) throw new NotFoundException("Not Found")

    await this.assertCanAccess(asset, userId)
    return asset
  }

  async getSourceContext(asset: { source_type: string; source_id: number }) {
    switch (asset.source_type) {
      case "Post": {
        const post = await this.prisma.entry.findUnique({
          where: { id: asset.source_id },
          select: { status: true, project_id: true, room_id: true, creation_origin: true },
        })
        return {
          reply_available: Boolean(post && post.status === "published" && !isProjectEntry(post)),
          source_type: "Post",
          source_id: asset.source_id,
          parent_entry_id: asset.source_id,
          parent_chat_message_id: null,
          room_id: null,
        }
      }
      case "Reply": {
        const reply = await this.prisma.reply.findUnique({
          where: { id: asset.source_id },
          select: { entry_id: true, chat_message_id: true, chat_message: { select: { room_id: true } } },
        })
        return {
          source_type: "Reply",
          source_id: asset.source_id,
          parent_entry_id: reply?.entry_id ?? null,
          parent_chat_message_id: reply?.chat_message_id ?? null,
          room_id: reply?.chat_message?.room_id ?? null,
        }
      }
      case "ChatMessage": {
        const message = await this.prisma.chatMessage.findUnique({
          where: { id: asset.source_id },
          select: { room_id: true },
        })
        return {
          source_type: "ChatMessage",
          source_id: asset.source_id,
          parent_entry_id: null,
          parent_chat_message_id: asset.source_id,
          room_id: message?.room_id ?? null,
        }
      }
      case "Page":
      case "Note":
        return {
          source_type: "Note",
          source_id: asset.source_id,
          parent_entry_id: null,
          parent_chat_message_id: null,
          room_id: null,
        }
      default:
        return {
          source_type: null,
          source_id: null,
          parent_entry_id: null,
          parent_chat_message_id: null,
          room_id: null,
        }
    }
  }

  async streamAudioAssetForUser(
    audioAssetId: number,
    userId: number,
    rangeHeader?: string | null,
  ): Promise<MediaStreamPayload> {
    const asset = await this.getAudioAssetForUser(audioAssetId, userId)
    if (asset.processing_status !== "ready") throw new NotFoundException("Not Found")

    const exists = await this.storage.exists(asset.blob.key)
    if (!exists) throw new NotFoundException("Not Found")
    const byteSize = (await this.storage.getSize(asset.blob.key)) ?? Number(asset.blob.byte_size)
    const range = parseMediaRange(rangeHeader, byteSize)

    return {
      stream: (await this.storage.getStream(asset.blob.key, range)).stream,
      filename: asset.blob.filename,
      contentType: asset.blob.content_type ?? "application/octet-stream",
      byteSize,
      ...(range ? { range } : {}),
    }
  }

  private async assertCanAccess(
    asset: {
      owner_id: number
      source_type: string
      source_id: number
    },
    userId: number,
  ) {
    switch (asset.source_type) {
      case "Page":
      case "Note":
        return this.assertPageAccess(asset.source_id, userId)
      case "Post":
        return this.assertPostAccess(asset.source_id, userId)
      case "Reply":
        return this.assertReplyAccess(asset.source_id, userId)
      case "ChatMessage":
        return this.assertChatMessageAccess(asset.source_id, userId)
      default:
        throw new ForbiddenException("Forbidden")
    }
  }

  private async assertPageAccess(pageId: number, userId: number) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } })
    if (!page) throw new NotFoundException("Not Found")
    if (!page.room_id) return

    const membership = await this.prisma.roomMembership.findFirst({
      where: { room_id: page.room_id, user_id: userId, disabled: false },
      select: { id: true },
    })
    if (!membership) throw new ForbiddenException("Forbidden")
  }

  private async assertPostAccess(postId: number, userId: number) {
    const post = await this.prisma.entry.findUnique({
      where: { id: postId },
    })
    if (!post || post.status === "deleted") throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) {
      if (!(await canReadProjectEntry(this.prisma, post, userId))) throw new ForbiddenException("Forbidden")
      return
    }

    if (post.status !== "published") {
      if (
        !(await canManageEntryDraft(this.prisma, this.circleAccess, post, userId)) &&
        !(await canReadRoundDraft(this.prisma, this.circleAccess, post, userId))
      ) {
        throw new ForbiddenException("Forbidden")
      }
      return
    }

    const communityId = roomEntryRoomId(post)
    if (!communityId) {
      if (post.user_id !== userId) throw new ForbiddenException("Forbidden")
      return
    }

    const access = await this.circleAccess.resolve(communityId, userId)
    if (!(access?.kind === "member" && post.creation_origin !== "chat_attachment") && !(access && await this.circleAccess.canReadPublishedPostWithRoomHistory(post, access))) throw new ForbiddenException("Forbidden")
  }

  private async assertReplyAccess(replyId: number, userId: number) {
    const reply = await this.prisma.reply.findUnique({
      where: { id: replyId },
      include: { entry: true, chat_message: true },
    })
    if (!reply || reply.status === "deleted") throw new NotFoundException("Not Found")

    if (reply.status !== "published") {
      if (!(await canEditEntryReply(this.circleAccess, reply, userId))) throw new ForbiddenException("Forbidden")
      return
    }

    if (reply.chat_message) return this.assertChatMessageAccess(reply.chat_message.id, userId)
    if (reply.entry) return this.assertPostAccess(reply.entry.id, userId)

    throw new NotFoundException("Not Found")
  }

  private async assertChatMessageAccess(messageId: number, userId: number) {
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId } })
    if (!message) throw new NotFoundException("Not Found")
    if (message.status === "draft") {
      if (message.author_id !== userId || (await this.circleAccess.resolve(message.room_id, userId))?.kind !== "member") throw new ForbiddenException("Forbidden")
      return
    }
    if (!(await this.circleAccess.canReadPublishedChatMessage(message.id, userId))) throw new ForbiddenException("Forbidden")
  }

  private toNumber(value: number | string | null | undefined) {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? value : Number(value)
  }
}
