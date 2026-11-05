import { capturePosthogEvent, summarizeContentForAnalytics } from "../../../runtime/posthog"
import { normalizeMentionTargetType } from "../../../../types/mention-target"
import { authorizeMentionReferences, lockMentionReferenceAccess } from "../../v1/mentions/mention-reference-access"
import { availableChatMessageWhere } from "./chat-visibility"
import { hasLimitedRoomHistory } from "../../v1/rooms/room-door-policy"
import { sharedEntryPresentation } from "../../v1/entries/shared-entry-presentation"
import { contentLink } from "../../../../frontend/src/lib/contentLinks"
import { canViewProject } from "../../v1/projects/project-access"
import { UploadsService } from "../../v1/uploads/uploads.service"
import { chatMessageDocument, hasChatAttachment } from "./chat-content"
import { GoneException, BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import { RealtimeService } from "../../../realtime/realtime.service"
import { RoomsService, type RoomMemberPayload } from "../../v1/rooms/rooms.service"
import { RoomAccessService, type RoomAccessKind } from "../../v1/rooms/room-access.service"
import { PagesWriteService } from "../../v1/pages/pages.write.service"
import { parseEntryFormat, parseEntryFormatData, type EntryFormat, type EntryFormatData } from "../../v1/entries/entry-formats"
import { uploadVariantUrl } from "../../v1/uploads/upload-urls"
import { BossService } from "../../../queue/boss.service"
import { activityScope } from "../../v1/rounds/round-scope"
import { RoundLifecycleService } from "../../v1/rounds/round-lifecycle.service"
import { wallRoundCard, wallAnnouncementId, wallChatInclude } from "../../v1/rounds/publish-round-wall"

const DAY_MS = 24 * 60 * 60 * 1_000
const CHAT_VISIBLE_DAYS = 7
const CHAT_TOTAL_DAYS = 14
const CHAT_PRESENCE_TTL_MS = 90_000
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const MAX_MESSAGE_LENGTH = 4_000

type ChatMessageRow = Prisma.ChatMessageGetPayload<{
  include: { author: { select: { id: true; username: true } } }
}>

export type ChatMessagePayload = {
  round_event?: import("../../v1/rounds/round-chat").RoundChatCard | null
  id: number
  can_convert?: boolean
  kind: "message" | "post_announcement" | "post_link"
  announcement_type: "direct" | "converted" | null
  saved_at: string | null
  pinned_at: string | null
  reply_count: number
  reply_participants?: Array<{ id: number; username: string; avatar_url: string | null }>
  entry: ChatEntryPreview | null
  body: string
  content: Prisma.JsonValue | null
  created_at: string
  fire_at: string
  expires_at: string
  lifecycle: "active" | "in_fire"
  mine: boolean
  client_nonce: string | null
  author: {
    id: number
    display_username: string
    avatar_url: string | null
  } | null
  masked_author: {
    display_username: string
    avatar_seed: string
  } | null
}

export type ChatEntryPreview = {
  author?: { display_username: string; avatar_url: string | null }
  id: number
  creation_origin?: string | null
  reply_participants?: Array<{ id: number; username: string; avatar_url: string | null }>
  format: EntryFormat
  format_data: EntryFormatData
  content: Prisma.JsonValue
  reply_count: number
  available: boolean
  project: { id: number; name: string; icon_url: string | null } | null
}

export type ChatMessagesPayload = {
  messages: ChatMessagePayload[]
  next_cursor: number | null
  present_user_ids: number[]
  viewer_user_id: number
  server_time: string
  viewer_access: {
    kind: RoomAccessKind
    history_limit: number | null
    can_paginate: boolean
    can_send: true
  }
}

@Injectable()
export class ChatService {
  @Inject(UploadsService) private readonly uploads!: UploadsService

  @Inject(RoundLifecycleService)
  private readonly activityLifecycle!: RoundLifecycleService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RealtimeService)
  private readonly realtime!: RealtimeService

  @Inject(RoomsService)
  private readonly rooms!: RoomsService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  @Inject(PagesWriteService)
  private readonly pages!: PagesWriteService

  @Inject(BossService)
  private readonly boss!: BossService

  async markMessagesSeen(roomId: number, userId: number, messageIds: unknown): Promise<void> {
    if (!Array.isArray(messageIds) || messageIds.length > 100 ||
        messageIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException("Invalid messageIds")
    }
    const access = await this.accessContext(roomId, userId)
    const now = new Date()
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        room_id: roomId,
        ...availableChatMessageWhere(now),
        ...(hasLimitedRoomHistory(access) ? {} : { id: { in: messageIds } }),
      },
      select: { id: true },
      orderBy: { id: "desc" },
      ...(hasLimitedRoomHistory(access) ? { take: 10 } : {}),
    })
    const readableIds = messages.filter(message => messageIds.includes(message.id))
    if (!readableIds.length) return
    const recorded = await this.prisma.chatMessageRead.createMany({
      data: readableIds.map(message => ({ user_id: userId, message_id: message.id, seen_at: now })),
      skipDuplicates: true,
    })
    if (recorded?.count) capturePosthogEvent({ distinctId: userId, event: "chat_messages_read", properties: {
      room_id: roomId, message_count: recorded.count,
    } })
  }

  async listMessages(
    roomId: number,
    userId: number,
    input: { before?: number; after?: number; limit?: number; now?: Date } = {},
  ): Promise<ChatMessagesPayload> {
    const now = input.now ?? new Date()
    const access = await this.accessContext(roomId, userId)
    const beforeInput = input.before === undefined ? undefined : this.positiveInteger(input.before, "before")
    const requestedLimit = input.limit === undefined ? DEFAULT_PAGE_SIZE : this.positiveInteger(input.limit, "limit")
    const limitedHistory = hasLimitedRoomHistory(access)
    if (input.after !== undefined && (!Number.isSafeInteger(input.after) || input.after < 0)) throw new BadRequestException("Invalid after")
    if (input.after !== undefined && beforeInput !== undefined) throw new BadRequestException("Use before or after")
    const after = limitedHistory ? undefined : input.after
    const before = limitedHistory ? undefined : beforeInput
    const limit = limitedHistory ? 10 : Math.min(MAX_PAGE_SIZE, requestedLimit)
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        room_id: roomId,
        ...availableChatMessageWhere(now),
        ...(before ? { id: { lt: before } } : after !== undefined ? { id: { gt: after } } : {}),
      },
      include: { author: { select: { id: true, username: true } } },
      orderBy: { id: after === undefined ? "desc" : "asc" },
      take: limitedHistory ? limit : limit + 1,
    })

    const hasMore = !limitedHistory && rows.length > limit
    const selected = after === undefined ? rows.slice(0, limit).reverse() : rows.slice(0, limit)
    const page = await this.normalizeWallAnnouncements(selected, roomId)
    const members = await this.memberMap(roomId, userId)
    const presentUserIds = limitedHistory ? [] : await this.presentUserIds(roomId, now)
    const postPreviewMap = await this.postPreviewMap(page, members, userId)
    const replyCountMap = await this.chatReplyCountMap(page)

    return {
      messages: page.map((message) =>
        this.serializeMessage(
          message,
          userId,
          members,
          now,
          postPreviewMap.get(this.messagePostId(message) ?? 0) ?? null,
          replyCountMap.get(message.id),
        ),
      ),
      next_cursor: hasMore && selected.length > 0 ? (after === undefined ? selected[0].id : selected[selected.length - 1].id) : null,
      present_user_ids: presentUserIds,
      viewer_user_id: userId,
      server_time: now.toISOString(),
      viewer_access: {
        kind: access.kind,
        history_limit: limitedHistory ? 10 : null,
        can_paginate: !limitedHistory,
        can_send: true,
      },
    }
  }

  async sendMessage(
    roomId: number,
    userId: number,
    input: { body?: unknown; content?: unknown; clientNonce?: unknown; draftId?: unknown; now?: Date },
  ): Promise<ChatMessagePayload> {
    if (hasChatAttachment(input.content) || input.draftId !== undefined && input.draftId !== null) {
      throw new BadRequestException("Chat supports text and links. Remove media from this draft before sending; share media as a Room entry.")
    }
    const now = input.now ?? new Date()
    const body = this.cleanBody(input.body)
    const content =
      input.content === undefined
        ? (chatMessageDocument(body) as Prisma.InputJsonValue)
        : this.cleanContent(input.content)
    return this.deliverMessage(roomId, userId, { body, content, clientNonce: input.clientNonce, now })
  }

  async createDraftMessage(roomId: number, userId: number, input: { clientNonce?: unknown; now?: Date } = {}) {
    const clientNonce = this.cleanClientNonce(input.clientNonce) ?? crypto.randomUUID()
    await this.circleAccess.requireMember(roomId, userId)
    if (clientNonce) {
      const existing = await this.prisma.chatMessage.findUnique({
        where: { author_id_client_nonce: { author_id: userId, client_nonce: clientNonce } },
        select: { id: true, status: true, room_id: true },
      })
      if (existing) {
        if (existing.room_id !== roomId || existing.status !== "draft") {
          throw new BadRequestException("client_nonce is already in use")
        }
        return { id: existing.id }
      }
    }
    throw new BadRequestException("Chat supports text and links. New media drafts are unavailable.")
  }

  async deleteDraftMessage(roomId: number, messageId: number, userId: number) {
    await this.circleAccess.requireMember(roomId, userId)
    const id = this.positiveInteger(messageId, "message_id")
    const blobs = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM chat_messages WHERE id = ${id} FOR UPDATE`
      const draft = await tx.chatMessage.findFirst({ where: { id, room_id: roomId, author_id: userId, status: "draft" } })
      if (!draft) return []
      const discarded = await this.uploads.discardChatDraftMedia(tx, id)
      await tx.chatMessage.delete({ where: { id } })
      return discarded
    })
    await this.uploads.purgeDiscardedBlobs(blobs)
    return { ok: true }
  }

  async message(roomId: number, messageId: number, userId: number) {
    const now = new Date()
    const access = await this.accessContext(roomId, userId)
    const storedRow = await this.prisma.chatMessage.findFirst({
      where: { id: this.positiveInteger(messageId, "message_id", NotFoundException), room_id: roomId, ...availableChatMessageWhere(now) },
      include: { author: { select: { id: true, username: true } } },
    })
    if (!storedRow) throw new NotFoundException("Message not found")
    const [row] = await this.normalizeWallAnnouncements([storedRow], roomId)
    if (!row) throw new NotFoundException("Message not found")
    if (hasLimitedRoomHistory(access)) {
      const visible = await this.prisma.chatMessage.findMany({
        where: { room_id: roomId, ...availableChatMessageWhere(now) },
        orderBy: { id: "desc" },
        take: 10,
        select: { id: true },
      })
      if (!visible.some(({ id }) => id === row.id)) throw new NotFoundException("Message not found")
    }
    const [members, counts] = await Promise.all([
      this.memberMap(roomId, userId),
      this.chatReplyCountMap([row]),
    ])
    const previews = await this.postPreviewMap([row], members, userId)
    return this.serializeMessage(
      row,
      userId,
      members,
      new Date(),
      previews.get(this.messagePostId(row) ?? 0) ?? null,
      counts.get(row.id),
    )
  }

  async listPeopleMessages(roomId: number, userId: number) {
    const now = new Date()
    const access = await this.accessContext(roomId, userId)
    let rows: ChatMessageRow[]
    if (hasLimitedRoomHistory(access)) {
      const visible = await this.prisma.chatMessage.findMany({
        where: { room_id: roomId, ...availableChatMessageWhere(now), timeline_kind: "message", OR: [{ entry_origin: null }, { entry_origin: { not: "wall_publication" } }] },
        orderBy: { id: "desc" },
        take: 10,
        include: { author: { select: { id: true, username: true } } },
      })
      const seenAuthors = new Set<number>()
      rows = visible.filter(row => {
        if (seenAuthors.has(row.author_id)) return false
        seenAuthors.add(row.author_id)
        return true
      })
    } else {
      rows = await this.prisma.chatMessage.findMany({
        where: {
          room_id: roomId,
          ...availableChatMessageWhere(now),
          timeline_kind: "message",
          OR: [{ entry_origin: null }, { entry_origin: { not: "wall_publication" } }],
        },
        distinct: ["author_id"],
        orderBy: [{ author_id: "asc" }, { id: "desc" }],
        include: { author: { select: { id: true, username: true } } },
      })
    }
    rows.sort((left, right) => right.id - left.id)
    const [members, counts] = await Promise.all([
      this.memberMap(roomId, userId),
      this.chatReplyCountMap(rows),
    ])
    return {
      messages: rows.map(row => this.serializeMessage(row, userId, members, new Date(), null, counts.get(row.id))),
    }
  }

  async listActivities(roomId: number, userId: number) {
    const access = await this.accessContext(roomId, userId)
    await this.activityLifecycle.reconcileCircle(roomId)
    const activities = await this.prisma.round.findMany({
      where: {
        ...activityScope({ id: 0, room_id: roomId }),
        status: { in: access.kind === "visitor" ? ["active"] : ["active", "draft"] },
      },
      orderBy: [{ started_at: "asc" }, { created_at: "asc" }],
      include: {
        _count: {
          select: {
            submission_records: { where: { superseded_at: null } },
            participations: { where: { role: "participant", status: "active" } },
          },
        },
      },
    })
    return {
      rounds: activities.map(activity => ({
        id: activity.id,
        name: activity.name,
        description: activity.prompt,
        status: activity.status,
        completed: Boolean(activity.closed_at) || ["closed", "archived", "completed"].includes(activity.status),
        submitted_count: activity._count.submission_records,
        participant_count: activity._count.participations,
        occurred_at: (activity.started_at ?? activity.created_at).toISOString(),
      })),
    }
  }

  // Shared delivery for user-authored text and server-constructed post links.
  private async deliverMessage(
    roomId: number,
    userId: number,
    input: { body: string; content: Prisma.InputJsonValue; clientNonce: unknown; now?: Date; postLink?: boolean },
  ): Promise<ChatMessagePayload> {
    const { body, content } = input
    const now = input.now ?? new Date()
    const clientNonce = this.cleanClientNonce(input.clientNonce)
    await this.accessContext(roomId, userId)

    if (clientNonce) {
      const existing = await this.prisma.chatMessage.findUnique({
        where: { author_id_client_nonce: { author_id: userId, client_nonce: clientNonce } },
        include: { author: { select: { id: true, username: true } } },
      })
      if (existing) {
        if (existing.room_id !== roomId) throw new BadRequestException("client_nonce is already in use")
        const members = await this.memberMap(roomId, userId)
        return this.serializeMessage(existing, userId, members, now)
      }
    }

    const fireAt = new Date(now.getTime() + CHAT_VISIBLE_DAYS * DAY_MS)
    const expiresAt = new Date(now.getTime() + CHAT_TOTAL_DAYS * DAY_MS)
    // Resolve response dependencies and initialize Boss before entering the short DB transaction.
    const members = await this.memberMap(roomId, userId)
    await this.boss.start()
    let newlyCreated = false
    const message = await this.prisma.$transaction(async (transaction) => {
      await lockMentionReferenceAccess(transaction, this.circleAccess, [content], userId, roomId)
      if (clientNonce) {
        // Serializes retries from concurrent requests without duplicate messages or jobs.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${clientNonce}`}, 0))`
        const existing = await transaction.chatMessage.findUnique({
          where: { author_id_client_nonce: { author_id: userId, client_nonce: clientNonce } },
          include: { author: { select: { id: true, username: true } } },
        })
        if (existing) {
          if (existing.room_id !== roomId) throw new BadRequestException("client_nonce is already in use")
          return existing
        }
      }
      const authorizedContent = await authorizeMentionReferences(transaction, this.circleAccess, content, userId, roomId)
      const created = await transaction.chatMessage.create({
        data: {
          room_id: roomId,
          author_id: userId,
          body,
          content: authorizedContent,
          ...(input.postLink ? { timeline_kind: "post_link" } : {}),
          // The legacy column remains required, but masking is intentionally dormant.
          masked_alias: "",
          client_nonce: clientNonce,
          fire_at: fireAt,
          expires_at: expiresAt,
          created_at: now,
          updated_at: now,
        },
      })

      const notificationEvent = await transaction.notificationEvent.create({
        data: {
          event_type: "chat_message_created", actor_id: userId, room_id: roomId,
          target_user_id: null,
          payload: { chat_message_id: created.id, excerpt: body.slice(0, 180) },
          target_path: `/app/rooms/${roomId}/chat#chat-${created.id}`,
          created_at: now, updated_at: now,
        },
      })
      await this.boss.enqueueInTransaction(transaction, "notifications.fanout", { eventId: notificationEvent.id })
      newlyCreated = true
      return transaction.chatMessage.findUniqueOrThrow({
        where: { id: created.id },
        include: { author: { select: { id: true, username: true } } },
      })
    })

    if (newlyCreated) capturePosthogEvent({ distinctId: userId, event: "chat_message_sent", properties: {
      room_id: roomId, message_id: message.id, message_kind: input.postLink ? "post_link" : "message",
      ...summarizeContentForAnalytics(content),
    } })
    // No queue calls after commit: a persisted message is immediately announced.
    this.realtime.emit("ChatChannel", this.realtime.chatRoom(roomId), {
      type: "message_created",
      room_id: roomId,
      message_id: message.id,
    })
    return this.serializeMessage(message, userId, members, now)
  }

  async linkPostToChat(roomId: number, postId: number, userId: number, clientNonce: unknown) {
    await this.circleAccess.requireMember(roomId, userId)
    const post = await this.prisma.entry.findFirst({
      where: { id: this.positiveInteger(postId, "entry_id"), status: "published", room_id: roomId },
      select: { id: true },
    })
    if (!post) throw new NotFoundException("Post not found in this circle")
    const path = `/app/entries/${post.id}`
    return this.deliverMessage(roomId, userId, {
      body: "View post", clientNonce, postLink: true,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "View post", marks: [{ type: "link", attrs: { href: path } }] }] }] },
    })
  }

  async saveMessageAsPost(_communityId: number, _messageId: number, _userId: number): Promise<never> {
    throw new GoneException("Direct Chat-to-Room conversion is no longer supported. Save to a Project before sharing your own Entry.")
  }

  async copyMessageToNote(
    roomId: number,
    messageId: number,
    userId: number,
    now = new Date(),
    noteId?: number,
    idempotencyKey?: unknown,
  ) {
    await this.circleAccess.requireMember(roomId, userId)
    const message = await this.actionableMessage(roomId, messageId, userId, now)
    const copyKey = this.cleanIdempotencyKey(idempotencyKey, message.id, noteId)
    const priorCopy = await this.prisma.chatNoteCopy.findUnique({
      where: { copied_by_id_idempotency_key: { copied_by_id: userId, idempotency_key: copyKey } },
      select: { note_id: true, message_id: true },
    })
    if (priorCopy) {
      if (priorCopy.message_id !== message.id) throw new BadRequestException("idempotency_key is already in use")
      return { note_id: priorCopy.note_id, path: `/app/note/${priorCopy.note_id}` }
    }

    const saver = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } })
    if (!saver) throw new NotFoundException("User not found")
    const speaker =
      message.author ??
      (await this.prisma.user.findUnique({ where: { id: message.author_id }, select: { id: true, username: true } }))
    if (!speaker) throw new NotFoundException("Message author not found")
    const linkedEntryDocument =
      message.entry?.status === "published"
        ? await this.prisma.document.findFirst({
            where: { docable_type: "Post", docable_id: message.entry.id },
            select: { content: true },
          })
        : null
    const originalDocument = linkedEntryDocument?.content ?? chatMessageDocument(message.body, message.content)
    const copyDocument =
      message.author_id === userId
        ? originalDocument
        : this.attributedQuoteDocument(
            originalDocument,
            message.id,
            roomId,
            speaker.username,
            saver.username,
          )

    if (noteId !== undefined) {
      const id = this.positiveInteger(noteId, "note_id")
      const note = await this.prisma.page.findFirst({
        where: { id, room_id: roomId, deleted_at: null },
        select: { id: true },
      })
      if (!note) throw new NotFoundException("Note not found")

      await this.pages.prependContentBlocks(note.id, userId, {
        blocks: (copyDocument as { content?: unknown[] }).content ?? [],
        position: "top",
      })
      await this.recordNoteCopy(message.id, note.id, userId, copyKey, now)
      return {
        note_id: note.id,
        path: `/app/note/${note.id}`,
        source_message_id: message.id,
        copied_by: { id: saver.id, display_username: saver.username },
      }
    }

    const title = `Chat note - ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(now)}`
    const created = await this.pages.createPage(userId, { room_id: roomId, title })
    await this.pages.saveContent(created.page.id, userId, copyDocument)
    await this.recordNoteCopy(message.id, created.page.id, userId, copyKey, now)
    return {
      note_id: created.page.id,
      path: `/app/note/${created.page.id}`,
      source_message_id: message.id,
      copied_by: { id: saver.id, display_username: saver.username },
    }
  }

  async requestMessageSave(roomId: number, messageId: number, userId: number, now = new Date()) {
    await this.circleAccess.requireMember(roomId, userId)
    const message = await this.actionableMessage(roomId, messageId, userId, now)
    if (message.author_id === userId) throw new BadRequestException("Authors do not need to request permission")

    const existing = await this.prisma.chatSaveRequest.findUnique({
      where: { message_id_requester_id: { message_id: message.id, requester_id: userId } },
    })
    if (existing) return { request_id: existing.id, status: existing.status }

    const request = await this.prisma.chatSaveRequest.create({
      data: {
        message_id: message.id,
        requester_id: userId,
        owner_id: message.author_id,
        status: "pending",
        created_at: now,
        updated_at: now,
      },
    })
    const event = await this.prisma.notificationEvent.create({
      data: {
        event_type: "chat_save_requested",
        actor_id: userId,
        room_id: roomId,
        target_user_id: message.author_id,
        payload: { chat_message_id: message.id, chat_save_request_id: request.id, excerpt: message.body.slice(0, 180) },
        target_path: `/app/rooms/${roomId}/chat`,
        created_at: now,
        updated_at: now,
      },
    })
    await this.boss.enqueue("notifications.fanout", { eventId: event.id })
    return { request_id: request.id, status: request.status }
  }

  private async accessContext(roomId: number, userId: number) {
    if (!Number.isInteger(roomId) || roomId <= 0) throw new NotFoundException("Not Found")
    return this.circleAccess.require(roomId, userId)
  }

  private async actionableMessage(roomId: number, messageId: number, userId: number, now: Date) {
    await this.accessContext(roomId, userId)
    const id = this.positiveInteger(messageId, "message_id", NotFoundException)
    const message = await this.prisma.chatMessage.findFirst({
      where: {
        id,
        room_id: roomId,
        ...availableChatMessageWhere(now),
      },
      include: { entry: true, author: true, saved_by: true },
    })
    if (!message) throw new NotFoundException("Message not found")
    return message
  }

  private attributedQuoteDocument(
    source: Prisma.JsonValue,
    messageId: number,
    roomId: number,
    speaker: string,
    saver: string,
  ): Prisma.InputJsonObject {
    const sourceBlocks =
      source && typeof source === "object" && !Array.isArray(source) && Array.isArray(source.content)
        ? source.content
        : []
    return {
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: {
            sourceMessageId: messageId,
            sourceHref: `/app/rooms/${roomId}/chat#chat-${messageId}`,
          },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `${speaker} said:` }],
            },
            ...sourceBlocks,
            {
              type: "paragraph",
              content: [{ type: "text", text: `Saved from Chat by ${saver}` }],
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Source: " },
                {
                  type: "text",
                  text: "View in Chat",
                  marks: [
                    {
                      type: "link",
                      attrs: { href: `/app/rooms/${roomId}/chat#chat-${messageId}` },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
  }

  private async recordNoteCopy(messageId: number, noteId: number, copiedById: number, idempotencyKey: string, now: Date) {
    await this.prisma.chatNoteCopy.create({
      data: {
        message_id: messageId,
        note_id: noteId,
        copied_by_id: copiedById,
        idempotency_key: idempotencyKey,
        created_at: now,
      },
    })
  }

  private async memberMap(roomId: number, userId: number) {
    const response = await this.rooms.listMembersForChat(roomId, userId)
    return new Map(response.members.map((member) => [member.user_id, member]))
  }

  private async presentUserIds(roomId: number, now: Date) {
    const activeSince = new Date(now.getTime() - CHAT_PRESENCE_TTL_MS)
    const sessions = await this.prisma.chatPresenceSession.findMany({
      where: {
        room_id: roomId,
        left_at: null,
        last_seen_at: { gte: activeSince },
      },
      select: { user_id: true },
    })
    return Array.from(new Set(sessions.map((session) => session.user_id)))
  }

  private serializeMessage(
    message: ChatMessageRow,
    viewerId: number,
    members: Map<number, RoomMemberPayload>,
    now: Date,
    postPreview: ChatEntryPreview | null = null,
    replies: { count: number; userIds: number[] } = { count: 0, userIds: [] },
  ): ChatMessagePayload {
    const systemEvent = message.timeline_kind === "round_event"
    const mine = !systemEvent && message.author_id === viewerId
    const member = members.get(message.author_id)

    return {
      id: message.id,
      round_event: message.timeline_kind === "round_event" ? ((message.content as unknown as { round_event?: import("../../v1/rounds/round-chat").RoundChatCard; activity_event?: import("../../v1/rounds/round-chat").RoundChatCard })?.round_event ?? (message.content as any)?.activity_event) : null,
      can_convert: false,
      kind: message.timeline_kind === "post_link" ? "post_link" : message.timeline_kind === "post_announcement" ? "post_announcement" : "message",
      announcement_type:
        message.entry_origin === "direct_chat_post"
          ? "direct"
          : message.entry_origin === "converted_message"
            ? "converted"
            : null,
      saved_at: message.saved_at?.toISOString() ?? null,
      pinned_at: message.pinned_at?.toISOString() ?? null,
      reply_count: hasChatAttachment(message.content) && postPreview ? postPreview.reply_count : replies.count,
      reply_participants: hasChatAttachment(message.content) && postPreview ? postPreview.reply_participants ?? [] : replies.userIds.flatMap(id => {
        const participant = members.get(id)
        return participant ? [{ id, username: participant.display_username, avatar_url: participant.avatar_url ?? null }] : []
      }).slice(0, 3),
      entry: postPreview,
      body: message.body,
      content: message.content,
      created_at: message.created_at.toISOString(),
      fire_at: message.fire_at.toISOString(),
      expires_at: message.expires_at.toISOString(),
      lifecycle: "active",
      mine,
      client_nonce: mine ? message.client_nonce : null,
      author: systemEvent ? null : {
        id: message.author_id,
        display_username: member?.display_username ?? message.author.username,
        avatar_url: member?.display_avatar_url ?? member?.avatar_url ?? null,
      },
      masked_author: null,
    }
  }

  /** Authorize Wall identity for both current and legacy notices; never infer it from body text. */
  private async normalizeWallAnnouncements(rows: ChatMessageRow[], roomId: number): Promise<ChatMessageRow[]> {
    const legacy = rows.filter(row => wallAnnouncementId(row))
    if (!legacy.length) return rows
    const walls = await this.prisma.roundResult.findMany({
      where: { room_id: roomId, round: activityScope({ id: 0, room_id: roomId }), id: { in: legacy.map(row => wallAnnouncementId(row)!) } }, include: wallChatInclude,
    })
    const byId = new Map(walls.map(wall => [wall.id, wall]))
    return rows.flatMap(row => {
      const wallId = wallAnnouncementId(row)
      if (!wallId) return [row]
      const wall = byId.get(wallId)
      return wall ? [{ ...row, timeline_kind: "round_event", content: { round_event: wallRoundCard(wall) }, created_at: wall.published_at }] : []
    })
  }

  private async chatReplyCountMap(messages: Array<Pick<ChatMessageRow, "id">>) {
    const ids = messages.map(message => message.id)
    const summaries = new Map<number, { count: number; userIds: number[] }>()
    if (ids.length === 0) return summaries
    const groups = await this.prisma.reply.groupBy({
      by: ["chat_message_id", "user_id"],
      where: { chat_message_id: { in: ids }, status: "published" },
      _count: { _all: true },
    })
    for (const group of groups) {
      if (group.chat_message_id === null) continue
      const summary = summaries.get(group.chat_message_id) ?? { count: 0, userIds: [] }
      summary.count += group._count._all
      if (group.user_id != null) summary.userIds.push(group.user_id)
      summaries.set(group.chat_message_id, summary)
    }
    for (const summary of summaries.values()) summary.userIds.sort((a, b) => a - b)
    return summaries
  }

  private messagePostId(message: Pick<ChatMessageRow, "entry_id" | "timeline_kind" | "content">): number | null {
    if (message.timeline_kind !== "post_link") return message.entry_id
    // Post links keep their target in the canonical rich-text link; post_id is
    // reserved for the original chat-to-post conversion, not subsequent shares.
    const document = message.content as { content?: Array<{ content?: Array<{ marks?: Array<{ type?: string; attrs?: { href?: string } }> }> }> } | null
    const href = document?.content?.[0]?.content?.[0]?.marks?.find(mark => mark.type === "link")?.attrs?.href
    const match = typeof href === "string" ? href.match(/^\/app\/entries\/(\d+)$/) : null
    return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null
  }

  private async postPreviewMap(messages: ChatMessageRow[], members: Map<number, RoomMemberPayload>, userId: number) {
    const postIds = messages
      .map((message) => this.messagePostId(message))
      .filter((postId): postId is number => Boolean(postId))
    if (postIds.length === 0) return new Map<number, ChatEntryPreview>()

    const countedEntryIds = messages.filter(message => message.timeline_kind !== "post_link").map(message => message.entry_id).filter((id): id is number => Boolean(id))
    const [posts, documents, replies] = await Promise.all([
      this.prisma.entry.findMany({ where: { id: { in: postIds }, status: "published", room_id: { in: messages.map(message => message.room_id) } }, include: { user: { select: { username: true } }, project: true } }),
      this.prisma.document.findMany({ where: { docable_type: "Post", docable_id: { in: postIds } } }),
      countedEntryIds.length ? this.prisma.reply.findMany({
        where: { entry_id: { in: countedEntryIds }, status: "published" },
        select: { entry_id: true, user_id: true },
      }) : Promise.resolve([]),
    ])
    const documentMap = new Map(documents.map((document) => [document.docable_id, document.content]))
    const projectIds = Array.from(new Set(posts.flatMap(post => post.project ? [post.project.id] : [])))
    const visibleProjectIds = new Set((await Promise.all(projectIds.map(async id => await canViewProject(this.prisma, id, userId) ? id : null))).filter((id): id is number => id !== null))
    const projectIcons = visibleProjectIds.size
      ? await this.prisma.activeStorageAttachment.findMany({
          where: { record_type: "Project", record_id: { in: [...visibleProjectIds] }, name: "icon" },
          select: { record_id: true, blob_id: true },
          orderBy: { created_at: "desc" },
        })
      : []
    const projectIconMap = new Map<number, number>()
    projectIcons.forEach(icon => {
      if (!projectIconMap.has(icon.record_id)) projectIconMap.set(icon.record_id, icon.blob_id)
    })
    const replyCounts = new Map<number, number>()
    replies.forEach((reply) => {
      if (reply.entry_id !== null) replyCounts.set(reply.entry_id, (replyCounts.get(reply.entry_id) ?? 0) + 1)
    })

    return new Map(
      posts.map((post) => [
        post.id,
        {
          id: post.id,
          creation_origin: post.creation_origin,
          reply_participants: [...new Set(replies.filter(reply => reply.entry_id === post.id).flatMap(reply => reply.user_id == null ? [] : [reply.user_id]))].sort((a, b) => a - b).flatMap(id => {
            const participant = members.get(id)
            return participant ? [{ id, username: participant.display_username, avatar_url: participant.display_avatar_url ?? participant.avatar_url ?? null }] : []
          }).slice(0, 3),
          author: {
            display_username: (post.user_id ? members.get(post.user_id)?.display_username : null) ?? post.user?.username ?? "Unknown",
            avatar_url: (post.user_id ? members.get(post.user_id)?.display_avatar_url ?? members.get(post.user_id)?.avatar_url : null) ?? null,
          },
          ...sharedEntryPresentation(post),
          format: parseEntryFormat(post.format),
          format_data: parseEntryFormatData(post.format_data),
          content: (documentMap.get(post.id) ?? chatMessageDocument("")) as Prisma.JsonValue,
          reply_count: replyCounts.get(post.id) ?? 0,
          available: true,
          project: post.project && visibleProjectIds.has(post.project.id)
            ? {
                id: post.project.id,
                name: post.project.name,
                icon_url: projectIconMap.has(post.project.id)
                  ? uploadVariantUrl(`/api/v1/uploads/${projectIconMap.get(post.project.id)}`, "icon160")
                  : null,
              }
            : null,
        },
      ]),
    )
  }

  private cleanBody(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("body is required")
    const body = value.trim()
    if (!body) throw new BadRequestException("body is required")
    if (body.length > MAX_MESSAGE_LENGTH) throw new BadRequestException(`body must be ${MAX_MESSAGE_LENGTH} characters or fewer`)
    return body
  }

  private cleanContent(value: unknown): Prisma.InputJsonValue {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("content is required")
    }

    const input = value as Record<string, unknown>
    if (input.type !== "doc" || !Array.isArray(input.content)) {
      throw new BadRequestException("content is invalid")
    }

    const paragraphs = input.content.map((node) => this.cleanContentNode(node))
    return { type: "doc", content: paragraphs }
  }

  private cleanContentNode(value: unknown): Prisma.InputJsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("content is invalid")
    }

    const node = value as Record<string, unknown>
    if (node.type === "paragraph") {
      const content = Array.isArray(node.content) ? node.content.map((child) => this.cleanContentNode(child)) : []
      return { type: "paragraph", content }
    }
    if (node.type === "hardBreak") return { type: "hardBreak" }
    if (node.type === "text" && typeof node.text === "string") {
      const marks = Array.isArray(node.marks) ? node.marks.flatMap(mark => {
        if (!mark || typeof mark !== "object") return []
        if (["bold", "italic", "strike", "underline", "code"].includes(String(mark.type))) return [{ type: String(mark.type) }]
        if (mark.type !== "link") return []
        const href = contentLink(mark.attrs?.href)
        return href ? [{ type: "link", attrs: { href } }] : []
      }) : []
      return { type: "text", text: node.text, ...(marks.length ? { marks } : {}) }
    }
    if (node.type === "file") {
      const attrs = node.attrs as Record<string, unknown> | null
      if (!attrs || typeof attrs.src !== "string" || !/^\/api\/v1\/uploads\/\d+$/.test(attrs.src) || typeof attrs.filename !== "string" || !attrs.filename.trim() || !Number.isSafeInteger(attrs.size) || Number(attrs.size) < 0 || typeof attrs.contentType !== "string") throw new BadRequestException("file is invalid")
      return { type: "file", attrs: { src: attrs.src, filename: attrs.filename.slice(0, 255), size: Number(attrs.size), contentType: attrs.contentType.slice(0, 255) } }
    }
    if (node.type === "image") {
      const attrs = this.cleanMediaAttrs(node.attrs)
      if (typeof attrs.src !== "string" || !/^\/api\/v1\/uploads\/\d+$/.test(attrs.src)) {
        throw new BadRequestException("image is invalid")
      }
      return { type: "image", attrs }
    }
    if (node.type === "audio") {
      const attrs = this.cleanMediaAttrs(node.attrs)
      if (!Number.isSafeInteger(attrs.audioAssetId) || Number(attrs.audioAssetId) <= 0) {
        throw new BadRequestException("audio is invalid")
      }
      return { type: "audio", attrs }
    }
    if (node.type === "video") {
      const attrs = this.cleanMediaAttrs(node.attrs)
      if (!Number.isSafeInteger(attrs.videoAssetId) || Number(attrs.videoAssetId) <= 0) {
        throw new BadRequestException("video is invalid")
      }
      return { type: "video", attrs }
    }
    if (node.type === "mention") {
      const attrs = node.attrs
      if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) {
        throw new BadRequestException("mention is invalid")
      }
      const source = attrs as Record<string, unknown>
      const targetType = normalizeMentionTargetType(source.targetType)
      const targetId = typeof source.targetId === "string" ? source.targetId : ""
      const label = typeof source.label === "string" ? source.label.trim().slice(0, 160) : ""
      if (!targetType || !/^\d+$/.test(targetId) || !label) {
        throw new BadRequestException("mention is invalid")
      }

      const href = typeof source.href === "string" && source.href.startsWith("/app/") ? source.href : null
      const avatarUrl = typeof source.avatarUrl === "string" && source.avatarUrl.startsWith("/api/") ? source.avatarUrl : null
      const icon = typeof source.icon === "string" ? source.icon.slice(0, 16) : null
      return {
        type: "mention",
        attrs: {
          id: `${String(targetType)}:${targetId}`,
          targetType: String(targetType),
          targetId,
          label,
          href,
          avatarUrl,
          icon,
        },
      }
    }

    throw new BadRequestException("content contains an unsupported node")
  }

  private cleanMediaAttrs(value: unknown): Prisma.InputJsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("media is invalid")
    const source = value as Record<string, unknown>
    const attrs: Record<string, Prisma.InputJsonValue> = {}
    for (const key of ["src", "alt", "title", "status", "nodeId", "posterUrl", "playbackUrl", "thumbnailUrl"] as const) {
      if (typeof source[key] === "string") attrs[key] = source[key].slice(0, 2_000)
    }
    for (const key of ["width", "height", "durationMs", "audioAssetId", "videoAssetId"] as const) {
      if (Number.isSafeInteger(source[key]) && Number(source[key]) > 0) attrs[key] = Number(source[key])
    }
    return attrs
  }

  private cleanClientNonce(value: unknown) {
    if (value === undefined || value === null || value === "") return null
    if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new BadRequestException("client_nonce is invalid")
    }
    return value
  }

  private cleanIdempotencyKey(value: unknown, messageId: number, noteId?: number) {
    if (value === undefined || value === null || value === "") return `chat-note-${messageId}-${noteId ?? "new"}`
    if (typeof value !== "string" || value.length > 96 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new BadRequestException("idempotency_key is invalid")
    }
    return value
  }

  private positiveInteger(
    value: number,
    field: string,
    ExceptionType: typeof BadRequestException | typeof NotFoundException = BadRequestException,
  ) {
    if (!Number.isInteger(value) || value <= 0) throw new ExceptionType(`${field} is invalid`)
    return value
  }

}
