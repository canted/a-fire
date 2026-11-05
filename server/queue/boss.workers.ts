import { schedulePushDelivery } from "../notifications/schedule-push-delivery"
import { replyCreatedNotificationData } from "../api/v1/replies/reply-notification"
import { postCreatedNotificationData } from "../api/v1/entries/entry-notifications.service"
import { UPLOAD_ORPHAN_PURGE_QUEUE } from "./queue-names"
import { ImageVariantsService } from "../uploads/images/image-variants.service"
import { withNoteDocumentTransaction } from "../api/v1/pages/note-document-transaction"
import { InviteEmailProcessor, type InviteEmailJob } from "../mailer/invite-email.processor"
import { AudioSpectrumProcessor } from "../uploads/audio/audio-spectrum.processor"
import { Inject, Injectable, OnModuleInit } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { TiptapNode } from "../api/v1/pages/page-content-blocks"
import { assertReflectionDestination, assertReflectionSource } from "../api/v1/reflections/reflections.service"
import { RoundsService, type RoundNotificationJob } from "../api/v1/rounds/rounds.service"
import {
  NOTIFICATION_DELAYED_PUSH_QUEUE,
  NotificationDeliveryService,
} from "../notifications/notification-delivery.service"
import { NotificationPreferencesService } from "../notifications/notification-preferences.service"
import { PrismaService } from "../prisma/prisma.service"
import { createYdocFromStoredState, createYdocFromTiptapContent, encodeYdocState, insertYdocContentBlocks } from "../realtime/hocuspocus.service"
import { AudioProcessor } from "../uploads/audio/audio.processor"
import { ImageVariantProcessor } from "../uploads/images/image-variant.processor"
import { VideoProcessor } from "../uploads/video/video.processor"
import { BossService } from "./boss.service"
import { AUDIO_SPECTRUM_QUEUE, CHAT_EXPIRE_QUEUE, ACTIVITY_NOTIFICATION_QUEUE, INVITE_EMAIL_QUEUE } from "./queue-names"

type NotificationFanoutPayload = { eventId?: number; entryId?: number; replyId?: number }
type NotificationPushPayload = { deliveryId: number }
type ReflectionApplyPayload = { reflectionId: number }
type UploadVariantPayload = {
  blobId: number
  variationDigest: string
  entryId?: number
  originalUrl?: string
  variantUrl?: string
}
type UploadAudioPayload = { audioAssetId: number }
type UploadVideoPayload = { videoAssetId: number }
type ChatExpirePayload = { messageId: number }

type NotificationEventWithRelations = Prisma.NotificationEventGetPayload<{
  include: { actor: true; room: true }
}>

type ReflectionSourceDetails = {
  sourceType: "Post" | "Reply"
  sourceId: number
  sourcePath: string
  roomId: number | null
  authorName: string | null
}

const DEFAULT_TIPTAP_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
}

@Injectable()
export class BossWorkers implements OnModuleInit {
  @Inject(ImageVariantsService)
  private readonly imageStorage!: ImageVariantsService

  @Inject(InviteEmailProcessor)
  private readonly inviteEmail!: InviteEmailProcessor

  @Inject(AudioSpectrumProcessor)
  private readonly audioSpectrum!: AudioSpectrumProcessor

  @Inject(BossService)
  private readonly boss!: BossService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(NotificationDeliveryService)
  private readonly notificationDelivery!: NotificationDeliveryService

  @Inject(NotificationPreferencesService)
  private readonly notificationPreferences!: NotificationPreferencesService

  @Inject(ImageVariantProcessor)
  private readonly imageVariants!: ImageVariantProcessor

  @Inject(AudioProcessor)
  private readonly audioProcessor!: AudioProcessor

  @Inject(VideoProcessor)
  private readonly videoProcessor!: VideoProcessor

  @Inject(RoundsService)
  private readonly activitiesService!: RoundsService

  async onModuleInit(): Promise<void> {
    await this.activitiesService.scheduleActiveActivityNotifications()
    await this.boss.work<{ blobId: number }>(UPLOAD_ORPHAN_PURGE_QUEUE, data => this.handleOrphanPurge(data))
    await this.boss.work<InviteEmailJob>(INVITE_EMAIL_QUEUE, data => this.inviteEmail.process(data))
    await this.boss.work<UploadAudioPayload>(AUDIO_SPECTRUM_QUEUE, data => this.audioSpectrum.process(data))
    await this.boss.work<NotificationFanoutPayload>("notifications.fanout", async (data) => this.handleNotificationFanout(data))
    await this.boss.work<NotificationPushPayload>(NOTIFICATION_DELAYED_PUSH_QUEUE, async (data) => this.handleDelayedNotificationPush(data))
    await this.boss.work<ReflectionApplyPayload>("reflections.apply", async (data) => this.handleReflectionApply(data))
    await this.boss.work<UploadVariantPayload>("uploads.variant", async (data) => this.handleUploadVariant(data))
    await this.boss.work<UploadAudioPayload>("uploads.audio", async (data) => this.handleUploadAudio(data))
    await this.boss.work<UploadVideoPayload>("uploads.video", async (data) => this.handleUploadVideo(data))
    await this.boss.work<ChatExpirePayload>(CHAT_EXPIRE_QUEUE, async (data) => this.handleChatExpire(data))
    await this.boss.work<RoundNotificationJob>(ACTIVITY_NOTIFICATION_QUEUE, async (data) =>
      this.activitiesService.handleScheduledNotification({ ...data, roundId: data.roundId ?? (data as unknown as { activityId: number }).activityId }),
    )
  }

  async handleOrphanPurge(data: { blobId: number }): Promise<void> {
    if (!Number.isSafeInteger(data.blobId) || data.blobId <= 0) throw new Error("Invalid orphan blob ID")
    await this.imageStorage.purgeOrphan(data.blobId)
  }

  async handleNotificationFanout(data: NotificationFanoutPayload): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(safeStringify({ event: "boss_fanout_start", payload: data }))
    try {
      if (data.eventId) {
        const event = await this.prisma.notificationEvent.findUnique({
          where: { id: data.eventId },
          include: { actor: true, room: true },
        })
        // eslint-disable-next-line no-console
        console.log(safeStringify({ event: "boss_fanout_event", event_id: data.eventId, found: Boolean(event) }))
        if (!event || !event.room_id) return
        await this.deliverToCommunity(event)
        return
      }

      if (data.entryId) {
        await this.handlePostNotification(data.entryId)
      } else if (data.replyId) {
        await this.handleReplyNotification(data.replyId)
      }
    } catch (error) {
      console.error(
        safeStringify({
          event: "boss_fanout_error",
          payload: data,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      throw error
    }
  }

  async handleDelayedNotificationPush(data: NotificationPushPayload): Promise<void> {
    if (!data.deliveryId) return
    await this.notificationDelivery.handleDelayedPush(data.deliveryId)
  }

  async handleChatExpire(data: ChatExpirePayload): Promise<void> {
    // Chat retention is intentionally retired. Keep the queue handler registered
    // so already-scheduled jobs drain harmlessly without deleting messages.
    void data
  }

  async handleReflectionApply(data: ReflectionApplyPayload): Promise<void> {
    const reflection = await this.prisma.reflection.findUnique({ where: { id: data.reflectionId } })
    if (!reflection || reflection.user_id === null) return
    const userId = reflection.user_id

    const sourceDetails = await this.buildReflectionSourceDetails(reflection.reflectable_type, reflection.reflectable_id)
    if (!sourceDetails) return
    await withNoteDocumentTransaction(this.prisma, reflection.page_id, async transaction => {
      // Removal uses this same Note lock. A stale queued read must not insert after removal.
      const current = await transaction.reflection.findUnique({ where: { id: reflection.id } })
      if (!current) return
      const page = await assertReflectionDestination(transaction, reflection.page_id, sourceDetails.roomId, userId)
      await assertReflectionSource(transaction, current.reflectable_type, current.reflectable_id, sourceDetails.roomId)
      const sourceDocument = await transaction.document.findFirst({
        where: { docable_type: current.reflectable_type, docable_id: current.reflectable_id },
      })
      if (!sourceDocument) return

      const pageDocument = await transaction.document.findFirst({
        where: { docable_type: "Note", docable_id: page.id },
      })

      const sourceNodes = extractNodes(sourceDocument.content)
      if (sourceNodes.length === 0) return
      const existingNodes = extractNodes(pageDocument?.content ?? DEFAULT_TIPTAP_DOC)
      if (hasMatchingContentSource(existingNodes, sourceDetails)) return
      const sourceBlock = buildContentSourceNode(sourceDetails)

      const ydoc = createYdocFromStoredState(pageDocument?.ydoc_state) ?? createYdocFromTiptapContent(buildDoc(existingNodes))
      let merged: ReturnType<typeof insertYdocContentBlocks>
      let ydocState: ReturnType<typeof encodeYdocState>
      try {
        merged = insertYdocContentBlocks(ydoc, [...sourceNodes, sourceBlock] as TiptapNode[])
        ydocState = encodeYdocState(ydoc)
      } finally { ydoc.destroy() }
      if (pageDocument) {
        await transaction.document.update({
          where: { id: pageDocument.id },
          data: { content: merged as Prisma.InputJsonValue, ydoc_state: ydocState, version: { increment: 1 }, updated_at: new Date() },
        })
        return
      }

      await transaction.document.create({
        data: {
          docable_type: "Note",
          docable_id: page.id,
          content: merged as Prisma.InputJsonValue,
          ydoc_state: ydocState,
          version: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      })
    })
  }

  private async buildReflectionSourceDetails(type: string, id: number): Promise<ReflectionSourceDetails | null> {
    if (type === "Post") {
      const post = await this.prisma.entry.findUnique({
        where: { id },
        select: {
          id: true,
          user_id: true,
          room_id: true,
          user: { select: { username: true } },
        },
      })
      if (!post) return null
      const communityId = post.room_id
      const authorName = await this.resolveAuthorName(post.user_id, communityId, post.user?.username ?? null)

      return {
        sourceType: "Post",
        sourceId: post.id,
        sourcePath: `/app/entries/${post.id}`,
        authorName,
        roomId: communityId,
      }
    }

    if (type === "Reply") {
      const reply = await this.prisma.reply.findUnique({
        where: { id },
        select: {
          id: true,
          entry_id: true,
          user_id: true,
          user: { select: { username: true } },
          entry: {
            select: {
              room_id: true,
                },
          },
        },
      })
      if (!reply?.entry_id) return null
      const communityId = reply.entry?.room_id ?? null
      const authorName = await this.resolveAuthorName(reply.user_id, communityId, reply.user?.username ?? null)

      return {
        sourceType: "Reply",
        sourceId: reply.id,
        sourcePath: `/app/entries/${reply.entry_id}#reply-${reply.id}`,
        authorName,
        roomId: communityId,
      }
    }

    return null
  }

  private async resolveAuthorName(
    userId: number | null | undefined,
    communityId: number | null | undefined,
    fallbackUsername: string | null,
  ): Promise<string | null> {
    if (!userId || !communityId) return fallbackUsername

    const membership = await this.prisma.roomMembership.findFirst({
      where: { room_id: communityId, user_id: userId, disabled: false },
      select: { username_override: true },
    })

    return membership?.username_override || fallbackUsername
  }

  async handleUploadVariant(data: UploadVariantPayload): Promise<void> {
    await this.imageVariants.process(data)
  }

  async handleUploadAudio(data: UploadAudioPayload): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(safeStringify({ event: "boss_audio_start", payload: data }))
    try {
      await this.audioProcessor.process(data)
      // eslint-disable-next-line no-console
      console.log(safeStringify({ event: "boss_audio_complete", payload: data }))
    } catch (error) {
      console.error(
        safeStringify({
          event: "boss_audio_error",
          payload: data,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      throw error
    }
  }

  async handleUploadVideo(data: UploadVideoPayload): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(safeStringify({ event: "boss_video_start", payload: data }))
    try {
      await this.videoProcessor.process(data)
      // eslint-disable-next-line no-console
      console.log(safeStringify({ event: "boss_video_complete", payload: data }))
    } catch (error) {
      console.error(
        safeStringify({
          event: "boss_video_error",
          payload: data,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      throw error
    }
  }

  private async handlePostNotification(postId: number) {
    // Publication also locks the Post before creating its event. Reuse that event
    // and serialize historical jobs so retries keep one durable delivery identity.
    const event = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${postId} FOR UPDATE`
      const post = await tx.entry.findUnique({ where: { id: postId } })
      if (!post || !post.user_id || post.status !== "published" || post.project_id) return null
      const document = await tx.document.findFirst({ where: { docable_type: "Post", docable_id: post.id } })
      const data = postCreatedNotificationData({ ...post, user_id: post.user_id }, document?.content ?? DEFAULT_TIPTAP_DOC)
      if (!data) return null
      const existing = await tx.notificationEvent.findFirst({
        where: { entry_id: post.id, event_type: "post_created", target_user_id: null, room_id: data.room_id },
        orderBy: { id: "asc" }, include: { actor: true, room: true },
      })
      return existing ?? tx.notificationEvent.create({ data, include: { actor: true, room: true } })
    })
    if (event) await this.deliverToCommunity(event)
  }

  private async handleReplyNotification(replyId: number) {
    const event = await this.prisma.$transaction(async tx => {
      const prepared = await tx.reply.findUnique({ where: { id: replyId }, select: { entry_id: true } })
      if (!prepared?.entry_id) return null
      // Match normal Reply publication: parent first, then Reply.
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${prepared.entry_id} FOR SHARE`
      await tx.$queryRaw`SELECT id FROM replies WHERE id = ${replyId} FOR UPDATE`
      const reply = await tx.reply.findUnique({ where: { id: replyId }, include: { entry: true } })
      if (!reply || reply.entry_id !== prepared.entry_id || reply.status !== "published" || !reply.entry || reply.entry.status !== "published" || reply.entry.project_id) return null
      const document = await tx.document.findFirst({ where: { docable_type: "Reply", docable_id: reply.id } })
      const data = replyCreatedNotificationData(reply.id, reply.user_id, reply.entry, document?.content)
      if (!data) return null
      const identity = { entry_id: reply.entry_id, event_type: "reply_created", target_user_id: null, room_id: data.room_id }
      const existing = await tx.notificationEvent.findFirst({
        where: { ...identity, reply_id: reply.id },
        orderBy: { id: "asc" }, include: { actor: true, room: true },
      })
      if (existing) return existing
      return tx.notificationEvent.create({ data, include: { actor: true, room: true } })
    })
    if (event) await this.deliverToCommunity(event)
  }

  private async deliverToCommunity(event: NotificationEventWithRelations) {
    if (!event.room_id) return
    const memberships = await this.prisma.roomMembership.findMany({
      where: { room_id: event.room_id, disabled: false },
    })
    // eslint-disable-next-line no-console
    console.log(
      safeStringify({
        event: "boss_fanout_memberships",
        event_id: String(event.id),
        room_id: Number(event.room_id),
        count: memberships.length,
      }),
    )

    const userIds = new Set<number>()
    const directTargetUserId = event.target_user_id ? Number(event.target_user_id) : null

    if (directTargetUserId) {
      if (
        event.event_type === "circle_member_invited" ||
        event.event_type === "circle_knock_suggested" ||
        memberships.some((membership) => Number(membership.user_id) === directTargetUserId)
      ) {
        userIds.add(directTargetUserId)
      }
    } else if (event.event_type !== "mention") {
      memberships.forEach((membership) => userIds.add(membership.user_id))
    }

    if (!directTargetUserId && event.event_type !== "mention" && event.event_type !== "chat_message_saved_as_post" && event.entry_id) {
      try {
        const replies = await this.prisma.reply.findMany({ where: { entry_id: event.entry_id }, select: { user_id: true } })
        replies.forEach((reply) => {
          if (reply.user_id) userIds.add(reply.user_id)
        })
        const post = await this.prisma.entry.findUnique({ where: { id: event.entry_id }, select: { user_id: true } })
        if (post?.user_id) userIds.add(post.user_id)
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "boss_fanout_post_error",
            event_id: String(event.id),
            message: error instanceof Error ? error.message : String(error),
          }),
        )
        throw error
      }
    }

    const includeActor = Boolean((event.payload as { include_actor?: unknown } | null)?.include_actor)
    if (event.actor_id && !includeActor) userIds.delete(event.actor_id)

    // eslint-disable-next-line no-console
    console.log(
      safeStringify({
        event: "boss_fanout_targets",
        event_id: String(event.id),
        user_ids: Array.from(userIds),
      }),
    )

    for (const userId of userIds) {
      const preference = await this.notificationPreferences.resolveForUser(userId, event)
      if (!this.notificationPreferences.allowsEvent(preference, event.event_type)) {
        // eslint-disable-next-line no-console
        console.log(
          safeStringify({
            event: "boss_fanout_skip",
            event_id: String(event.id),
            user_id: userId,
            reason: "preference",
            preference,
          }),
        )
        continue
      }
      // eslint-disable-next-line no-console
      console.log(
        safeStringify({
          event: "boss_fanout_deliver",
          event_id: String(event.id),
          user_id: userId,
          preference,
        }),
      )
      const delivery = await this.notificationDelivery.deliverImmediately(userId, event, preference)
      if (delivery?.scheduledPushDelivery) {
        await schedulePushDelivery(this.prisma, this.boss, delivery.scheduledPushDelivery.deliveryId)
      }
    }
  }
}

function extractNodes(content: unknown): Array<Record<string, unknown>> {
  if (!content || typeof content !== "object") return []
  const nodes = (content as { content?: unknown }).content
  return Array.isArray(nodes) ? (nodes as Array<Record<string, unknown>>) : []
}

function buildDoc(nodes: Array<Record<string, unknown>>) {
  return { type: "doc", content: nodes }
}

function buildContentSourceNode(details: ReflectionSourceDetails): Record<string, unknown> {
  return {
    type: "contentSource",
    attrs: {
      sourceType: details.sourceType,
      sourceId: details.sourceId,
      sourcePath: details.sourcePath,
      authorName: details.authorName,
    },
  }
}

function hasMatchingContentSource(
  nodes: Array<Record<string, unknown>>,
  details: ReflectionSourceDetails,
): boolean {
  return nodes.some((node) => isMatchingContentSourceNode(node, details))
}

function isMatchingContentSourceNode(
  node: Record<string, unknown>,
  details: ReflectionSourceDetails,
): boolean {
  if (node.type !== "contentSource") return false

  const attrs =
    node.attrs && typeof node.attrs === "object"
      ? (node.attrs as Record<string, unknown>)
      : null
  if (!attrs) return false

  const sameTypeAndId =
    String(attrs.sourceType ?? "") === String(details.sourceType) &&
    String(attrs.sourceId ?? "") === String(details.sourceId)
  const samePath = typeof attrs.sourcePath === "string" && attrs.sourcePath === details.sourcePath

  return sameTypeAndId || samePath
}

function safeStringify(value: unknown) {
  return JSON.stringify(value, (_key, val) => (typeof val === "number" ? Number(val) : val))
}
