import { roomEntryRoomId } from "./room-entry-scope"
import type { Prisma } from "@prisma/client"
import { Inject, Injectable } from "@nestjs/common"
import { extractMentionedUserIds } from "../../../notifications/mention-targets"
import { PrismaService } from "../../../prisma/prisma.service"
import { BossService } from "../../../queue/boss.service"
import { CHAT_EXPIRE_QUEUE } from "../../../queue/queue-names"
import { extractPlainText } from "../../../realtime/document-content"
import { chatSourceDocument } from "./post-content"
import { parseEntryFormat, type EntryFormat } from "./entry-formats"

const DAY_MS = 24 * 60 * 60 * 1_000

/** Shared event contract for publication and retained legacy queue jobs. */
export function postCreatedNotificationData(post: {
  id: number
  user_id: number
  content?: string | null
  room_id?: number | null
}, content: unknown): Prisma.NotificationEventUncheckedCreateInput | null {
  const communityId = roomEntryRoomId(post)
  if (!communityId) return null
  const now = new Date()
  return {
    event_type: "post_created", actor_id: post.user_id, room_id: communityId,
    entry_id: post.id, target_user_id: null,
    payload: { excerpt: extractPlainText(content) }, target_path: `/app/entries/${post.id}`,
    created_at: now, updated_at: now,
  }
}

/** Creates post notification events and chat announcements when publishing requests them. */
@Injectable()
export class EntryNotificationsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(BossService)
  private readonly boss!: BossService

  async createPostNotification(post: Parameters<typeof postCreatedNotificationData>[0], content: unknown, tx: Prisma.TransactionClient = this.prisma) {
    const data = postCreatedNotificationData(post, content)
    return data ? tx.notificationEvent.create({ data }) : null
  }

  async createChatPreservationNotification(
    post: {
      id: number
      user_id: number
      room_id?: number | null
      format?: string | null
    },
    messageId: number,
    content: unknown,
    now: Date,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const communityId = this.publicationRoomId(post)
    if (!communityId) return null
    const existing = await tx.notificationEvent.findFirst({
      where: {
        event_type: "chat_message_saved_as_post",
        entry_id: post.id,
      },
    })
    if (existing) return existing
    const excerpt = extractPlainText(content)
    const mentionedUserIds = extractMentionedUserIds(content).filter((id) => id !== post.user_id)
    return tx.notificationEvent.create({
      data: {
        event_type: "chat_message_saved_as_post",
        actor_id: post.user_id,
        room_id: communityId,
        entry_id: post.id,
        target_user_id: null,
        payload: {
          chat_message_id: messageId,
          excerpt,
          format: parseEntryFormat(post.format),
          mentioned_user_ids: mentionedUserIds,
        },
        target_path: `/app/rooms/${communityId}/chat#chat-${messageId}`,
        created_at: now,
        updated_at: now,
      },
    })
  }

  async createDirectChatAnnouncement(
    post: {
      id: number
      user_id: number
      room_id?: number | null
      format?: string | null
    },
    content: unknown,
    now: Date,
    transaction?: Prisma.TransactionClient,
  ) {
    const tx = transaction ?? this.prisma
    const communityId = this.publicationRoomId(post)
    if (!communityId) return null
    const format = parseEntryFormat(post.format)
    const body = this.directChatAnnouncementCopy(format)
    const fireAt = new Date(now.getTime() + 7 * DAY_MS)
    const expiresAt = new Date(now.getTime() + 14 * DAY_MS)
    const existing = await tx.chatMessage.findUnique({ where: { entry_id: post.id } })
    if (existing) return existing.id
    const created = await tx.chatMessage.create({
      data: {
        room_id: communityId,
        author_id: post.user_id,
        entry_id: post.id,
        timeline_kind: "post_announcement",
        entry_origin: "direct_chat_post",
        saved_at: now,
        body,
        content: chatSourceDocument(extractPlainText(content), null),
        // The legacy column remains required, but masking is intentionally dormant.
        masked_alias: "",
        client_nonce: null,
        fire_at: fireAt,
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
      },
    })
    if (transaction) await this.boss.enqueueInTransaction(transaction, CHAT_EXPIRE_QUEUE, { messageId: created.id }, { startAfter: expiresAt })
    else await this.boss.enqueueAfter(CHAT_EXPIRE_QUEUE, { messageId: created.id }, expiresAt)
    return created.id
  }

  private publicationRoomId(post: { room_id?: number | null }) {
    return roomEntryRoomId(post)
  }

  private directChatAnnouncementCopy(_format: EntryFormat) {
    return "shared an entry"
  }

  async createMentionNotifications(
    post: {
      id: number
      user_id: number
      content?: string | null
      room_id?: number | null
    },
    content: unknown,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const communityId = this.publicationRoomId(post)
    const actorId = Number(post.user_id ?? 0)
    if (!communityId || !actorId) return []

    const mentionedUserIds = extractMentionedUserIds(content).filter((userId) => userId !== actorId)
    if (mentionedUserIds.length === 0) return []

    const memberships = await tx.roomMembership.findMany({
      where: { room_id: communityId, user_id: { in: mentionedUserIds }, disabled: false },
      select: { user_id: true },
    })
    const targetUserIds = Array.from(new Set(memberships.map((membership) => Number(membership.user_id ?? 0)).filter(Boolean)))
    if (targetUserIds.length === 0) return []

    const excerpt = extractPlainText(content)
    const now = new Date()
    return Promise.all(
      targetUserIds.map((targetUserId) =>
        tx.notificationEvent.create({
          data: {
            event_type: "mention",
            actor_id: actorId,
            room_id: communityId,
            entry_id: post.id,
            target_user_id: targetUserId,
            payload: { excerpt },
            target_path: `/app/entries/${post.id}`,
            created_at: now,
            updated_at: now,
          },
        }),
      ),
    )
  }

  async enqueueNotificationEvents(events: Array<{ id: number | string | null | undefined } | null>, tx?: Prisma.TransactionClient) {
    for (const event of events) {
      if (!event) continue
      const data = { eventId: Number(event.id ?? 0) }
      if (tx) await this.boss.enqueueInTransaction(tx, "notifications.fanout", data)
      else await this.boss.enqueue("notifications.fanout", data)
    }
  }
}
