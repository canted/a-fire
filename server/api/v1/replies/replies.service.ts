import { reflectionSummaryScope } from "../reflections/reflection-summary-scope"
import { authorizeMentionReferences, lockMentionReferenceAccess } from "../mentions/mention-reference-access"
import { roomEntryRoomId } from "../entries/room-entry-scope"
import { replyCreatedNotificationData } from "./reply-notification"
import { isDeepStrictEqual } from "node:util"
import { canReplyToEntry } from "./reply-access"
import { hasChatAttachment } from "../../v2/rooms/chat-content"
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { extractMentionedUserIds } from "../../../notifications/mention-targets"
import { PrismaService } from "../../../prisma/prisma.service"
import { BossService } from "../../../queue/boss.service"
import { extractPlainText, trimTrailingBlankNodes } from "../../../realtime/document-content"
import { RealtimeService } from "../../../realtime/realtime.service"
import { captureReplyPublished } from "../../../runtime/posthog"
import { normalizeReplyFeedbackType, serializeEntryFeedbackRequest } from "../feedback-settings"
import type { LinkPreviewAttachmentPayload } from "../link-previews/link-preview.types"
import { LinkPreviewsService } from "../link-previews/link-previews.service"
import { identityImageUrl } from "../uploads/identity-images"
import { presentImageDocuments } from "../uploads/image-presentation"
import { findUnsupportedMediaSrcs, normalizePrivateUploadUrls } from "../uploads/upload-urls"
import { RoomAccessService } from "../rooms/room-access.service"
import { validateEntryPublication } from "../entries/entry-content"
import { isProjectEntry } from "../projects/project-access"

const DEFAULT_TIPTAP_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
}

type ReflectionPayload = {
  page_id: number
  page_title: string | null
  page_icon: string | null
  count: number
  mine: boolean
}

export type ReplyPayload = {
  id: number
  status?: string
  revision?: number
  created_at?: string
  published_at?: string | null
  user: {
    id: number
    username: string
    avatar_url?: string | null
    display_username?: string
    display_avatar_url?: string | null
  } | null
  display_username?: string
  display_avatar_url?: string | null
  feedback_type?: string | null
  content?: unknown
  link_preview?: LinkPreviewAttachmentPayload | null
  reflections?: ReflectionPayload[]
}

@Injectable()
export class RepliesService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(BossService)
  private readonly boss!: BossService

  @Inject(RealtimeService)
  private readonly realtime!: RealtimeService

  @Inject(LinkPreviewsService)
  private readonly linkPreviews!: LinkPreviewsService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  async create(
    postId: number,
    userId: number,
    payload: { content?: unknown; status?: string; link_preview?: unknown; feedback_type?: unknown },
  ): Promise<ReplyPayload> {
    const post = await this.prisma.entry.findUnique({ where: { id: this.toNumber(postId) ?? Number(0) } })
    if (!post) throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) throw new ForbiddenException("Feedback belongs to circle submissions")

    await this.assertCanReply(post, userId)
    const status = payload.status ?? "draft"
    const feedbackType = this.feedbackTypeForPost(post, payload.feedback_type)
    let contentForSave =
      status === "published"
        ? trimTrailingBlankNodes(this.normalizeUploadUrls(payload.content ?? DEFAULT_TIPTAP_DOC))
        : this.normalizeUploadUrls(payload.content ?? DEFAULT_TIPTAP_DOC)
    this.assertPersistableContent(contentForSave)
    if (status === "published") validateEntryPublication(contentForSave, "mixed_media", null)

    const preparedPreview = await this.linkPreviews.prepareAttachment(payload.link_preview, contentForSave)
    const reply = await this.prisma.$transaction(async transaction => {
      const roomId = await this.assertCurrentReplyParent(transaction, post.id, userId, status, feedbackType, [contentForSave])
      contentForSave = await authorizeMentionReferences(transaction, this.circleAccess, contentForSave as Prisma.InputJsonValue, userId, roomId)
      const reply = await transaction.reply.create({
        data: {
          entry_id: post.id,
          user_id: this.toNumber(userId) ?? Number(0),
          status,
          feedback_type: feedbackType,
          published_at: status === "published" ? new Date() : null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      })

      await this.upsertDocument("Reply", reply.id, contentForSave, transaction)
      await this.linkPreviews.applyPreparedAttachment("Reply", reply.id, preparedPreview, transaction)

      if (status === "published") {
        const events = [
          await this.createReplyNotification(reply.id, reply.user_id ?? null, post, contentForSave, transaction),
          ...(await this.createMentionNotifications(reply.id, reply.user_id ?? null, post, contentForSave, transaction)),
        ]
        await this.enqueueNotificationEvents(events, transaction)
      }

      return reply
    })

    const replyPayload = await this.serializeReply(
      this.toNumber(reply.id),
      roomEntryRoomId(post),
      userId,
    )
    if (status === "published") {
      await this.emitPublishedReply(post, replyPayload)
    }

    if (status === "published") {
      captureReplyPublished({
        userId,
        replyId: reply.id,
        entryId: post.id,
        roomId: roomEntryRoomId(post),
        content: contentForSave,
      })
    }

    return replyPayload
  }

  async listForChatMessage(
    communityId: number,
    messageId: number,
    userId: number,
    after?: number,
  ): Promise<{ message_id: number; replies: ReplyPayload[]; next_cursor: number | null }> {
    if (after !== undefined && (!Number.isSafeInteger(after) || after <= 0)) throw new BadRequestException("Invalid reply cursor")
    const message = await this.chatMessageParent(communityId, messageId, userId)
    const entryId = message.entry?.status === "published" && message.entry.room_id === communityId && hasChatAttachment(message.content) ? message.entry.id : null
    const scope: Prisma.ReplyWhereInput = entryId
      ? { OR: [{ chat_message_id: messageId }, { entry_id: entryId }] }
      : { chat_message_id: messageId }
    // Retained withdrawn rows remain usable cursor anchors. Do not skip a row
    // after filtering: doing so would lose the next visible reply on withdrawal.
    const anchor = after === undefined ? null : await this.prisma.reply.findFirst({
      where: { AND: [scope, { id: after }] }, select: { id: true, published_at: true },
    })
    if (after !== undefined && !anchor) throw new BadRequestException("Invalid reply cursor")
    const continuation: Prisma.ReplyWhereInput = !anchor ? {} : anchor.published_at === null
      ? { published_at: null, id: { gt: anchor.id } }
      : { OR: [
        { published_at: { gt: anchor.published_at } },
        { published_at: anchor.published_at, id: { gt: anchor.id } },
        { published_at: null },
      ] }
    const replies = await this.prisma.reply.findMany({
      where: { AND: [scope, continuation], status: "published" },
      orderBy: [{ published_at: "asc" }, { id: "asc" }],
      take: 51,
      select: { id: true },
    })
    return {
      message_id: messageId,
      next_cursor: replies.length > 50 ? replies[49].id : null,
      replies: await Promise.all(
        replies.slice(0, 50).map((reply) => this.serializeReply(reply.id, communityId, userId)),
      ),
    }
  }

  async markChatRepliesSeen(communityId: number, messageId: number, userId: number, replyIds: unknown): Promise<void> {
    if (!Array.isArray(replyIds) || replyIds.length > 100 ||
        replyIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException("Invalid replyIds")
    }
    await this.chatMessageParent(communityId, messageId, userId)
    const replies = await this.prisma.reply.findMany({
      where: { id: { in: replyIds }, chat_message_id: messageId, status: "published" },
      select: { id: true },
    })
    if (!replies.length) return
    await this.prisma.notificationInboxItem.updateMany({
      where: {
        user_id: userId,
        seen_at: null,
        notification_event: {
          room_id: communityId,
          AND: [
            { payload: { path: ["chat_message_id"], equals: messageId } },
            { OR: replies.map(reply => ({ payload: { path: ["replyId"], equals: reply.id } })) },
          ],
        },
      },
      data: { seen_at: new Date() },
    })
  }

  // Retired mutation routes remain explicit so older clients cannot create
  // threads or bypass the canonical Entry feedback revision/access contract.
  async createForChatMessage(
    _communityId: number,
    _messageId: number,
    _userId: number,
    _payload: { content?: unknown; status?: string; link_preview?: unknown },
  ): Promise<ReplyPayload> {
    throw new GoneException("Chat reply threads are retired. Open the Entry to leave feedback.")
  }

  async updateForChatMessage(
    _communityId: number,
    _messageId: number,
    _replyId: number,
    _userId: number,
    _payload: { content?: unknown; status?: string; link_preview?: unknown },
  ): Promise<ReplyPayload> {
    throw new GoneException("Chat reply threads are retired. Open the Entry to leave feedback.")
  }

  async publishForChatMessage(
    _communityId: number,
    _messageId: number,
    _replyId: number,
    _userId: number,
    _payload: { content?: unknown; link_preview?: unknown } = {},
  ): Promise<ReplyPayload> {
    throw new GoneException("Chat reply threads are retired. Open the Entry to leave feedback.")
  }

  async update(
    postId: number,
    replyId: number,
    userId: number,
    payload: { expected_revision?: unknown; content?: unknown; status?: string; link_preview?: unknown; feedback_type?: unknown },
  ): Promise<ReplyPayload> {
    const reply = await this.prisma.reply.findUnique({ where: { id: this.toNumber(replyId) ?? Number(0) } })
    if (!reply || reply.entry_id === null || this.toNumber(reply.entry_id) !== postId) throw new NotFoundException("Not Found")
    if (this.toNumber(reply.user_id) !== userId) throw new ForbiddenException("Forbidden")
    // A lost response may leave a published editor with an older revision.
    // Such a retry may only acknowledge the exact state already persisted.
    const stalePublishedRetry = reply.status === "published" && payload.content !== undefined &&
      typeof payload.expected_revision === "number" && Number.isSafeInteger(payload.expected_revision) &&
      payload.expected_revision >= 0 && payload.expected_revision < reply.updated_at.getTime()
    if (!stalePublishedRetry) this.assertExpectedRevision(reply.updated_at, payload.expected_revision)

    const status = payload.status ?? reply.status
    const publishedAt = status === "published" ? reply.published_at ?? new Date() : reply.published_at
    const post = await this.prisma.entry.findUnique({ where: { id: reply.entry_id } })
    await this.assertCanReply(post, userId)
    const feedbackType =
      payload.feedback_type !== undefined ? this.feedbackTypeForPost(post, payload.feedback_type) : reply.feedback_type
    if (status === "published") this.assertReplyFeedbackAllowed(post, feedbackType)

    let normalizedPublishedContent: unknown | null = null
    let contentForUpsert: unknown | null = null
    const document = await this.prisma.document.findFirst({ where: { docable_type: "Reply", docable_id: reply.id } })
    if (status === "published") {
      normalizedPublishedContent = trimTrailingBlankNodes(
        this.normalizeUploadUrls(payload.content ?? document?.content ?? DEFAULT_TIPTAP_DOC),
      )
      this.assertPersistableContent(normalizedPublishedContent)
      validateEntryPublication(normalizedPublishedContent, "mixed_media", null)
      contentForUpsert = normalizedPublishedContent
    } else if (payload.content) {
      contentForUpsert = this.normalizeUploadUrls(payload.content)
      this.assertPersistableContent(contentForUpsert)
    }

    const preparedPreview = await this.linkPreviews.prepareAttachment(payload.link_preview, contentForUpsert ?? document?.content ?? DEFAULT_TIPTAP_DOC)
    const changed = await this.prisma.$transaction(async transaction => {
      const roomId = await this.assertCurrentReplyParent(transaction, postId, userId, status, feedbackType, contentForUpsert ? [contentForUpsert] : [])
      if (contentForUpsert) {
        contentForUpsert = await authorizeMentionReferences(transaction, this.circleAccess, contentForUpsert as Prisma.InputJsonValue, userId, roomId)
        if (status === "published") normalizedPublishedContent = contentForUpsert
      }
      const current = await this.lockReply(transaction, reply.id)
      if (current.status === "published" && status === "draft") throw new ConflictException("Reply is already published")
      await this.assertPreparedReply(transaction, reply, document)
      if (stalePublishedRetry) {
        const preview = await transaction.linkPreviewAttachment.findUnique({
          where: { owner_type_owner_id: { owner_type: "Reply", owner_id: reply.id } },
          select: { source_url: true, preview_id: true, hidden: true },
        })
        if (status !== current.status || feedbackType !== reply.feedback_type ||
          !isDeepStrictEqual(contentForUpsert, document?.content) || !isDeepStrictEqual(preview, preparedPreview)) {
          throw new ConflictException("This reply changed elsewhere. Your edit has not been saved.")
        }
        return false
      }
      await transaction.reply.update({
        where: { id: reply.id },
        data: { status, feedback_type: feedbackType, published_at: current.published_at ?? publishedAt, updated_at: new Date(Math.max(Date.now(), (reply.updated_at?.getTime() ?? 0) + 1)) },
      })

      if (contentForUpsert) {
        await this.upsertDocument("Reply", reply.id, contentForUpsert, transaction)
      }
      await this.linkPreviews.applyPreparedAttachment("Reply", reply.id, preparedPreview, transaction)

      if (status === "published" && current.status !== "published") {
        const notificationContent = normalizedPublishedContent ?? DEFAULT_TIPTAP_DOC
        const events = post
          ? [
              await this.createReplyNotification(reply.id, reply.user_id ?? null, post, notificationContent, transaction),
              ...(await this.createMentionNotifications(reply.id, reply.user_id ?? null, post, notificationContent, transaction)),
            ]
          : []
        await this.enqueueNotificationEvents(events, transaction)
      }

      return true
    })

    const replyPayload = await this.serializeReply(
      this.toNumber(reply.id),
      post ? roomEntryRoomId(post) : null,
      userId,
    )
    if (changed && status === "published" && post) {
      await this.emitPublishedReply(post, replyPayload)
      captureReplyPublished({
        userId,
        replyId: this.toNumber(reply.id),
        entryId: this.toNumber(post.id),
        roomId: roomEntryRoomId(post),
        content: normalizedPublishedContent ?? DEFAULT_TIPTAP_DOC,
      })
    }
    return replyPayload
  }

  async publish(
    postId: number,
    replyId: number,
    userId: number,
    payload: { expected_revision?: unknown; content?: unknown; link_preview?: unknown; feedback_type?: unknown } = {},
  ): Promise<ReplyPayload> {
    const reply = await this.prisma.reply.findUnique({ where: { id: this.toNumber(replyId) ?? Number(0) } })
    if (!reply || reply.entry_id === null || this.toNumber(reply.entry_id) !== postId) throw new NotFoundException("Not Found")
    if (this.toNumber(reply.user_id) !== userId) throw new ForbiddenException("Forbidden")
    if (reply.status !== "published") this.assertExpectedRevision(reply.updated_at, payload.expected_revision)

    const post = await this.prisma.entry.findUnique({ where: { id: reply.entry_id } })
    await this.assertCanReply(post, userId)
    const document = await this.prisma.document.findFirst({ where: { docable_type: "Reply", docable_id: reply.id } })
    let normalizedContent = trimTrailingBlankNodes(
      this.normalizeUploadUrls(payload.content ?? document?.content ?? DEFAULT_TIPTAP_DOC),
    )
    this.assertPersistableContent(normalizedContent)
    validateEntryPublication(normalizedContent, "mixed_media", null)
    const feedbackType =
      payload.feedback_type !== undefined ? this.feedbackTypeForPost(post, payload.feedback_type) : reply.feedback_type
    this.assertReplyFeedbackAllowed(post, feedbackType)

    const preparedPreview = await this.linkPreviews.prepareAttachment(payload.link_preview, normalizedContent)
    const newlyPublished = await this.prisma.$transaction(async transaction => {
      const roomId = await this.assertCurrentReplyParent(transaction, postId, userId, "published", feedbackType, reply.status === "published" ? [] : [normalizedContent])
      const current = await this.lockReply(transaction, reply.id)
      if (current.status === "published") return false
      normalizedContent = await authorizeMentionReferences(transaction, this.circleAccess, normalizedContent as Prisma.InputJsonValue, userId, roomId)
      await this.assertPreparedReply(transaction, reply, document)
      await transaction.reply.update({
        where: { id: reply.id },
        data: { status: "published", feedback_type: feedbackType, published_at: reply.published_at ?? new Date(), updated_at: new Date(Math.max(Date.now(), (reply.updated_at?.getTime() ?? 0) + 1)) },
      })

      await this.upsertDocument("Reply", reply.id, normalizedContent, transaction)
      await this.linkPreviews.applyPreparedAttachment("Reply", reply.id, preparedPreview, transaction)

      const events = post
        ? [
            await this.createReplyNotification(reply.id, reply.user_id ?? null, post, normalizedContent, transaction),
            ...(await this.createMentionNotifications(reply.id, reply.user_id ?? null, post, normalizedContent, transaction)),
          ]
        : []
      await this.enqueueNotificationEvents(events, transaction)

      return true
    })

    const replyPayload = await this.serializeReply(
      this.toNumber(reply.id),
      post ? roomEntryRoomId(post) : null,
      userId,
    )
    if (post && newlyPublished) {
      await this.emitPublishedReply(post, replyPayload)
    }

    if (newlyPublished) captureReplyPublished({
      userId,
      replyId: this.toNumber(reply.id),
      entryId: post ? this.toNumber(post.id) : null,
      roomId: post ? roomEntryRoomId(post) : null,
      content: normalizedContent as Prisma.InputJsonValue,
    })

    return replyPayload
  }

  private async chatMessageParent(
    communityId: number,
    messageId: number,
    userId: number,
  ) {
    if (!await this.circleAccess.canReadPublishedChatMessage(messageId, userId)) {
      throw new NotFoundException("Not Found")
    }
    const message = await this.prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        room_id: communityId,
        status: "published",
      },
      select: {
        id: true,
        author_id: true,
        pinned_at: true,
        content: true,
        entry: { select: { id: true, status: true, room_id: true } },
        replies: { where: { status: "published" }, select: { id: true }, take: 1 },
      },
    })
    if (!message) throw new NotFoundException("Not Found")
    const hasEntry = message.entry?.status === "published" && message.entry.room_id === communityId && hasChatAttachment(message.content)
    if (!hasEntry && !message.pinned_at && message.replies.length === 0) {
      throw new NotFoundException("Not Found")
    }
    return message
  }

  private async emitPublishedReply(
    post: {
      id: number
      room_id?: number | null
    },
    reply: ReplyPayload,
  ) {
    const replyCount = await this.prisma.reply.count({
      where: { entry_id: post.id, status: "published" },
    })
    this.realtime.emit("EntryChannel", this.realtime.entryRoom(post.id), {
      type: "reply",
      entry_id: this.toNumber(post.id),
      reply,
      reply_count: replyCount,
    })
    const communityId = roomEntryRoomId(post)
    if (communityId) {
      this.realtime.emit("ChatChannel", this.realtime.chatRoom(communityId), {
        type: "post_reply_count",
        room_id: communityId,
        entry_id: post.id,
        reply_count: replyCount,
      })
    }
  }

  private async serializeReply(replyId: number, communityId: number | null, viewerUserId: number): Promise<ReplyPayload> {
    const reply = await this.prisma.reply.findUnique({ where: { id: this.toNumber(replyId) ?? Number(0) }, include: { user: true } })
    if (!reply) throw new NotFoundException("Not Found")

    const document = await this.prisma.document.findFirst({ where: { docable_type: "Reply", docable_id: reply.id } })
    const noteAccess = communityId ? await this.circleAccess.resolve(communityId, viewerUserId) : null
    const reflections = noteAccess?.kind === "member" ? await this.prisma.reflection.findMany({
      where: { reflectable_type: "Reply", reflectable_id: reply.id, ...reflectionSummaryScope(communityId) },
      include: { page: true },
    }) : []

    const membership = communityId
      ? await this.prisma.roomMembership.findFirst({
          where: {
            room_id: this.toNumber(communityId) ?? Number(0),
            user_id: this.toNumber(reply.user_id) ?? Number(0),
            disabled: false,
          },
          include: { user: true },
        })
      : null

    const displayUsername = membership?.username_override || reply.user?.username
    const displayAvatarUrl = membership ? await identityImageUrl(this.prisma, "User", this.toNumber(membership.user_id)) : null

    const reflectionMap = new Map<number, ReflectionPayload>()
    reflections.forEach((reflection) => {
      if (!reflection.page || reflection.page.deleted_at) return
      const pageId = this.toNumber(reflection.page_id)
      const existing = reflectionMap.get(pageId) ?? {
        page_id: pageId,
        page_title: reflection.page?.title ?? null,
        page_icon: reflection.page?.icon ?? null,
        count: 0,
        mine: false,
      }
      reflectionMap.set(pageId, {
        page_id: existing.page_id,
        page_title: existing.page_title,
        page_icon: existing.page_icon,
        count: existing.count + 1,
        mine: existing.mine || this.toNumber(reflection.user_id) === viewerUserId,
      })
    })

    return {
      id: this.toNumber(reply.id),
      status: reply.status,
      revision: reply.updated_at?.getTime(),
      created_at: reply.created_at.toISOString(),
      published_at: reply.published_at?.toISOString() ?? null,
      user: reply.user
        ? {
            id: this.toNumber(reply.user.id),
            username: reply.user.username,
            avatar_url: null,
            display_username: displayUsername,
            display_avatar_url: displayAvatarUrl,
          }
        : null,
      display_username: displayUsername,
      display_avatar_url: displayAvatarUrl,
      feedback_type: normalizeReplyFeedbackType(reply.feedback_type),
      content: (await presentImageDocuments(this.prisma, [this.normalizeUploadUrls(document?.content ?? DEFAULT_TIPTAP_DOC)]))[0],
      link_preview: await this.linkPreviews.serializeAttachment("Reply", reply.id, { includeHidden: true }),
      reflections: Array.from(reflectionMap.values()),
    }
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? value : Number(value)
  }

  private feedbackTypeForPost(
    post: { round_id?: number | null; reply_mode?: string | null; requested_feedback_types?: unknown; idea_guidance?: string | null } | null | undefined,
    value: unknown,
  ) {
    if (post?.round_id) return null
    const request = serializeEntryFeedbackRequest(post ?? {})
    if (request.reply_mode !== "guided") return null

    const feedbackType = normalizeReplyFeedbackType(value)
    if (!feedbackType) throw new BadRequestException("Choose a feedback type")
    if (!request.requested_feedback_types.includes(feedbackType)) {
      throw new BadRequestException("That feedback type is not requested for this post")
    }
    return feedbackType
  }

  private assertReplyFeedbackAllowed(
    post: { round_id?: number | null; reply_mode?: string | null; requested_feedback_types?: unknown; idea_guidance?: string | null } | null | undefined,
    value: unknown,
  ) {
    if (post?.round_id) return null
    const request = serializeEntryFeedbackRequest(post ?? {})
    if (request.reply_mode !== "guided") return
    this.feedbackTypeForPost(post, value)
  }

  private async assertCanReply(post: { id: number; room_id?: number | null; status?: string; project_id?: number | null; creation_origin?: string | null } | null, userId: number, database?: Prisma.TransactionClient) {
    if (!post || post.status !== "published") throw new ForbiddenException("Replies belong to published circle entries")
    if (isProjectEntry(post)) throw new ForbiddenException("Feedback belongs to circle submissions")
    if (!(await canReplyToEntry(this.circleAccess, post, userId, database))) throw new ForbiddenException("Forbidden")
  }

  private async assertCurrentReplyParent(transaction: Prisma.TransactionClient, postId: number, userId: number, status: string, feedbackType: unknown, contents: readonly unknown[]) {
    const prepared = await transaction.entry.findUnique({ where: { id: postId } })
    const roomId = prepared ? roomEntryRoomId(prepared) : null
    if (!roomId) throw new ForbiddenException("Forbidden")
    await lockMentionReferenceAccess(transaction, this.circleAccess, contents, userId, roomId)
    // Chat conversions lock messages before their attachment Entries.
    await transaction.$queryRaw`SELECT id FROM chat_messages WHERE entry_id = ${postId} FOR SHARE`
    await transaction.$queryRaw`SELECT id FROM entries WHERE id = ${postId} FOR SHARE`
    const post = await transaction.entry.findUnique({ where: { id: postId } })
    if ((post ? roomEntryRoomId(post) : null) !== roomId) throw new ConflictException("Entry access changed. Try again.")
    await this.assertCanReply(post, userId, transaction)
    if (status === "published") this.assertReplyFeedbackAllowed(post, feedbackType)
    return roomId
  }

  private async lockReply(transaction: Prisma.TransactionClient, replyId: number) {
    const [current] = await transaction.$queryRaw<Array<{ status: string; published_at: Date | null }>>`
      SELECT status, published_at FROM replies WHERE id = ${replyId} FOR UPDATE`
    if (!current || current.status === "deleted") throw new NotFoundException("Not Found")
    return current
  }

  private assertExpectedRevision(updatedAt: Date, expected: unknown) {
    if (expected === undefined) return
    if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0) throw new BadRequestException("Invalid reply revision")
    if (updatedAt.getTime() !== expected) throw new ConflictException("This reply changed elsewhere. Your edit has not been saved.")
  }

  private async assertPreparedReply(transaction: Prisma.TransactionClient, reply: { id: number; updated_at: Date }, document: unknown) {
    await transaction.$queryRaw`SELECT id FROM documents WHERE docable_type = 'Reply' AND docable_id = ${reply.id} FOR UPDATE`
    const current = await transaction.reply.findUnique({ where: { id: reply.id } })
    const currentDocument = await transaction.document.findFirst({ where: { docable_type: "Reply", docable_id: reply.id } })
    if (!current || current.updated_at?.getTime() !== reply.updated_at?.getTime() || !isDeepStrictEqual(currentDocument, document)) {
      throw new ConflictException("This reply changed before saving. Review it again.")
    }
  }

  private async upsertDocument(type: "Reply", id: number, content: unknown, database: Prisma.TransactionClient = this.prisma) {
    this.assertPersistableContent(content)
    const normalizedContent = this.normalizeUploadUrls(content ?? DEFAULT_TIPTAP_DOC)
    const existing = await database.document.findFirst({ where: { docable_type: type, docable_id: id } })
    if (existing) {
      await database.document.update({
        where: { id: existing.id },
        data: { content: normalizedContent as Prisma.InputJsonValue, version: { increment: 1 }, updated_at: new Date() },
      })
      return
    }

    await database.document.create({
      data: {
        docable_type: type,
        docable_id: id,
        content: normalizedContent as Prisma.InputJsonValue,
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
  }

  private async createReplyNotification(
    replyId: number,
    replyUserId: number | null,
    post: {
      id: number
      room_id?: number | null
    },
    content?: unknown,
    database: Prisma.TransactionClient = this.prisma,
  ) {
    const data = replyCreatedNotificationData(replyId, replyUserId, post, content)
    return data ? database.notificationEvent.create({ data }) : null
  }

  private async createMentionNotifications(
    replyId: number,
    replyUserId: number | null,
    post: {
      id: number
      room_id?: number | null
    },
    content: unknown,
    database: Prisma.TransactionClient = this.prisma,
  ) {
    const communityId = roomEntryRoomId(post)
    const actorId = this.toNumber(replyUserId)
    if (!communityId || !actorId) return []

    const mentionedUserIds = extractMentionedUserIds(content).filter((userId) => userId !== actorId)
    if (mentionedUserIds.length === 0) return []

    const memberships = await database.roomMembership.findMany({
      where: { room_id: communityId, user_id: { in: mentionedUserIds }, disabled: false },
      select: { user_id: true },
    })
    const targetUserIds = Array.from(new Set(memberships.map((membership) => this.toNumber(membership.user_id)).filter(Boolean)))
    if (targetUserIds.length === 0) return []

    const excerpt = extractPlainText(content) || ""
    const now = new Date()
    return Promise.all(
      targetUserIds.map((targetUserId) =>
        database.notificationEvent.create({
          data: {
            event_type: "mention",
            actor_id: actorId,
            room_id: communityId,
            entry_id: post.id,
            reply_id: replyId,
            target_user_id: targetUserId,
            payload: { excerpt },
            target_path: `/app/entries/${post.id}#reply-${replyId}`,
            created_at: now,
            updated_at: now,
          },
        }),
      ),
    )
  }

  private async enqueueNotificationEvents(events: Array<{ id: number | string | null | undefined } | null>, transaction?: Prisma.TransactionClient) {
    for (const event of events) {
      if (!event) continue
      if (transaction) await this.boss.enqueueInTransaction(transaction, "notifications.fanout", { eventId: this.toNumber(event.id) })
      else await this.boss.enqueue("notifications.fanout", { eventId: this.toNumber(event.id) })
    }
  }

  private normalizeUploadUrls(content: unknown): unknown {
    return normalizePrivateUploadUrls(content).value
  }

  private assertPersistableContent(content: unknown) {
    const unsupportedMediaSrcs = findUnsupportedMediaSrcs(content)
    if (unsupportedMediaSrcs.length > 0) {
      throw new BadRequestException("Media must be uploaded before saving content")
    }
  }
}
