import { canReadContentNotice, postIdFor, replyIdFor } from "./notification-access"
import { RoomAccessService } from "../api/v1/rooms/room-access.service"
import { Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../prisma/prisma.service"
import { tiptapImageVariantUrls, uploadVariantUrl } from "../api/v1/uploads/upload-urls"

type NotificationEventForInbox = {
  id: number
  event_type: string
  actor_id: number
  room_id: number
  entry_id?: number | null
  target_user_id?: number | null
  payload?: unknown
  target_path?: string | null
  created_at: Date
  actor?: { id: number; username: string } | null
  room?: { id: number; name: string | null; porosity?: string | null } | null
}

export type NotificationInboxItemForSerialization = {
  id: number
  user_id?: number | null
  delivery_state: string
  delivered_at?: Date | null
  seen_at?: Date | null
  notification_event: NotificationEventForInbox
}

export type NotificationInboxRecord = {
  id: string
  deliveryState: string
  deliveredAt?: string | null
  contentSeen: boolean
  bundle?: {
    type: "reply"
    key: string
    itemIds: string[]
    replyCount: number
    actors: Array<{ username: string; avatarUrl?: string | null; unseen?: boolean }>
  }
  notificationEvent: {
    id: string
    eventType: string
    actorUsername?: string | null
    actorAvatarUrl?: string | null
    roomName?: string | null
    roomAvatarUrl?: string | null
    targetPath?: string | null
    entryId?: string | null
    replyId?: string | null
    postAuthorUsername?: string | null
    postCreatedAt?: string | null
    postPublishedAt?: string | null
    payload: Record<string, unknown>
    postContent?: unknown | null
    replyContent?: unknown | null
    createdAt: string
  }
}

export function noticeReplyBundleKey(record: NotificationInboxRecord): string | null {
  const event = record.notificationEvent
  if (!event.entryId || !event.replyId || !event.eventType.toLowerCase().includes("reply")) return null
  return `reply-post:${event.entryId}`
}

@Injectable()
export class NotificationInboxSerializer {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  async serialize(items: NotificationInboxItemForSerialization[]): Promise<NotificationInboxRecord[]> {
    // Each authorization can traverse Room ancestry and read several sources.
    // Bound database pressure without caching access across requests or dropping
    // older notices. A failed batch rejects before any content hydration.
    const authorized: NotificationInboxItemForSerialization[] = []
    const accessBatchSize = 8
    for (let offset = 0; offset < items.length; offset += accessBatchSize) {
      const batch = items.slice(offset, offset + accessBatchSize)
      const readable = await Promise.all(batch.map(item => canReadContentNotice(this.circleAccess, this.prisma, item.user_id, item.notification_event)))
      authorized.push(...batch.filter((_item, index) => readable[index]))
    }
    items = authorized
    if (!items.length) return []
    const events = items.map((item) => item.notification_event)
    const userIds = uniqueNumbers(items.map((item) => item.user_id))
    const actorIds = uniqueNumbers(events.map((event) => event.actor_id))
    const communityIds = uniqueNumbers(events.map((event) => event.room_id))
    const postIds = uniqueNumbers(events.map((event) => postIdFor(event.entry_id, event.target_path)))
    const replyIds = uniqueNumbers(events.map((event) => replyIdFor(recordPayload(event.payload), event.target_path)))
    const chatMessageIds = uniqueNumbers(
      events.map((event) => numberId(recordPayload(event.payload).chat_message_id)),
    )
    const introductionIds = uniqueNumbers(
      events
        .filter((event) => isIntroductionNotice(event.event_type))
        .map((event) => {
          const payload = recordPayload(event.payload)
          return numberId(payload.introductionId ?? payload.introduction_id)
        }),
    )

    const [
      postDocuments,
      replyDocuments,
      posts,
      replies,
      postViewStates,
      communityAvatars,
      chatMessages,
      introductionRecipients,
    ] = await Promise.all([
      postIds.length
        ? this.prisma.document.findMany({
            where: { docable_type: "Post", docable_id: { in: postIds } },
            select: { docable_id: true, content: true },
          })
        : [],
      replyIds.length
        ? this.prisma.document.findMany({
            where: { docable_type: "Reply", docable_id: { in: replyIds } },
            select: { docable_id: true, content: true },
          })
        : [],
      postIds.length
        ? this.prisma.entry.findMany({
            where: { id: { in: postIds } },
            select: {
              id: true,
              user_id: true,
              created_at: true,
              published_at: true,
              user: { select: { id: true, username: true } },
            },
          })
        : [],
      replyIds.length
        ? this.prisma.reply.findMany({
            where: { id: { in: replyIds } },
            select: { id: true, entry_id: true, created_at: true, published_at: true },
          })
        : [],
      userIds.length && postIds.length
        ? this.prisma.entryViewState.findMany({
            where: { user_id: { in: userIds }, entry_id: { in: postIds } },
            select: {
              user_id: true,
              entry_id: true,
              entry_seen_at: true,
              reply_seen_through_at: true,
              reply_seen_through_id: true,
            },
          })
        : [],
      this.avatarMap("Circle", communityIds, "icon160"),
      chatMessageIds.length
        ? this.prisma.chatMessage.findMany({
            where: { id: { in: chatMessageIds } },
            include: {
              read_receipts: { where: { user_id: { in: userIds } }, select: { user_id: true } },
              identity_grants: {
                where: { user_id: { in: userIds } },
                select: { user_id: true },
              },
            },
          })
        : [],
      userIds.length && introductionIds.length
        ? this.prisma.introductionRecipient.findMany({
            where: {
              introduction_id: { in: introductionIds },
              user_id: { in: userIds },
            },
            select: { introduction_id: true, user_id: true, seen_at: true },
          })
        : [],
    ])

    const postUserIds = uniqueNumbers(posts.map((post) => post.user_id))
    const membershipUserIds = uniqueNumbers([...actorIds, ...postUserIds])
    const [memberships, userAvatars] = await Promise.all([
      membershipUserIds.length && communityIds.length
        ? this.prisma.roomMembership.findMany({
            where: {
              user_id: { in: membershipUserIds },
              room_id: { in: communityIds },
              disabled: false,
            },
            select: { id: true, user_id: true, room_id: true, username_override: true },
          })
        : [],
      this.avatarMap("User", actorIds, "avatarStripe40"),
    ])

    const membershipAvatars = await this.avatarMap(
      "CircleMembership",
      memberships.map((membership) => membership.id),
      "avatarStripe40",
    )
    const documentsByPostId = new Map(postDocuments.map((document) => [Number(document.docable_id), document.content] as const))
    const documentsByReplyId = new Map(
      replyDocuments.map((document) => [Number(document.docable_id), document.content] as const),
    )
    const postsByPostId = new Map(posts.map((post) => [Number(post.id), post] as const))
    const chatMessagesById = new Map(chatMessages.map((message) => [Number(message.id), message] as const))
    const repliesByReplyId = new Map(replies.map((reply) => [Number(reply.id), reply] as const))
    const viewStatesByUserAndPost = new Map(
      postViewStates.map((state) => [`${Number(state.user_id)}:${Number(state.entry_id)}`, state] as const),
    )
    const introductionSeenAtByUserAndIntroduction = new Map(
      introductionRecipients.map((recipient) => [
        `${Number(recipient.user_id)}:${Number(recipient.introduction_id)}`,
        recipient.seen_at,
      ] as const),
    )
    const membershipsByUserAndCommunity = new Map(
      memberships.map((membership) => [
        `${Number(membership.user_id)}:${Number(membership.room_id)}`,
        membership,
      ] as const),
    )

    return items.map((item) => {
      const event = item.notification_event
      const payload = recordPayload(event.payload)
      const postId = postIdFor(event.entry_id, event.target_path)
      const replyId = replyIdFor(payload, event.target_path)
      const replyIdNumber = numberId(replyId)
      const userId = numberId(item.user_id)
      const membership = membershipsByUserAndCommunity.get(`${Number(event.actor_id)}:${Number(event.room_id)}`)
      let actorUsername = membership?.username_override || event.actor?.username || "Someone"
      let actorAvatarUrl = membership
        ? membershipAvatars.get(Number(membership.id)) ?? userAvatars.get(Number(event.actor_id)) ?? null
        : userAvatars.get(Number(event.actor_id)) ?? null
      const chatMessageId = numberId(payload.chat_message_id)
      const chatMessage = chatMessageId ? chatMessagesById.get(chatMessageId) : null
      const identityVisible =
        !chatMessage ||
        event.room?.porosity === "open" ||
        Number(event.actor_id) === userId ||
        chatMessage.identity_grants.some((grant) => Number(grant.user_id) === userId)
      if (!identityVisible && chatMessage) {
        actorUsername = chatMessage.masked_alias
        actorAvatarUrl = null
      }
      const post = postId ? postsByPostId.get(postId) : null
      const postMembership = post
        ? membershipsByUserAndCommunity.get(`${Number(post.user_id)}:${Number(event.room_id)}`)
        : null
      const postAuthorUsername = postMembership?.username_override || post?.user?.username || null
      const postContent = postId ? documentsByPostId.get(postId) ?? null : null
      const replyContent = replyIdNumber ? documentsByReplyId.get(replyIdNumber) ?? null : null
      const viewState = userId && postId ? viewStatesByUserAndPost.get(`${userId}:${postId}`) ?? null : null
      const reply = replyIdNumber ? repliesByReplyId.get(replyIdNumber) ?? null : null
      const introductionId = isIntroductionNotice(event.event_type)
        ? numberId(payload.introductionId ?? payload.introduction_id)
        : null
      const introductionSeenAt = userId && introductionId
        ? introductionSeenAtByUserAndIntroduction.get(`${userId}:${introductionId}`) ?? null
        : null

      return {
        id: String(item.id),
        deliveryState: item.delivery_state,
        deliveredAt: item.delivered_at?.toISOString() ?? null,
        contentSeen: Boolean(item.seen_at) || contentSeenForNotice({
          entry: post,
          reply,
          replyId: replyIdNumber,
          viewState,
          chatSeen: Boolean(chatMessage?.read_receipts?.some(receipt => receipt.user_id === userId)),
          isChatNotice: isChatContentNotice(event.event_type) || Boolean(chatMessageId && !replyIdNumber),
          isChatReply: Boolean(chatMessageId && replyIdNumber),
          isIntroductionNotice: isIntroductionNotice(event.event_type),
          introductionSeenAt,
        }),
        notificationEvent: {
          id: String(event.id),
          eventType: event.event_type,
          actorUsername,
          actorAvatarUrl,
          roomName: event.room?.name ?? null,
          roomAvatarUrl: communityAvatars.get(Number(event.room_id)) ?? null,
          targetPath:
            chatMessage && chatMessage.fire_at <= new Date() && postId
              ? `/app/entries/${postId}`
              : event.target_path ?? null,
          entryId: postId ? String(postId) : null,
          replyId,
          postAuthorUsername,
          postCreatedAt: post?.created_at?.toISOString() ?? null,
          postPublishedAt: post?.published_at?.toISOString() ?? null,
          payload,
          postContent: postContent ? tiptapImageVariantUrls(postContent, "w600") : null,
          replyContent: replyContent ? tiptapImageVariantUrls(replyContent, "w600") : null,
          createdAt: event.created_at.toISOString(),
        },
      }
    })
  }

  private async avatarMap(
    recordType: "Circle" | "CircleMembership" | "User",
    recordIds: number[],
    variationDigest: string,
  ): Promise<Map<number, string>> {
    const ids = uniqueNumbers(recordIds)
    if (ids.length === 0) return new Map()

    const attachments = await this.prisma.activeStorageAttachment.findMany({
      where: { record_type: recordType, record_id: { in: ids }, name: "avatar" },
      orderBy: { created_at: "desc" },
      select: { record_id: true, blob_id: true },
    })

    const map = new Map<number, string>()
    attachments.forEach((attachment) => {
      const key = Number(attachment.record_id)
      if (map.has(key)) return
      const url = uploadVariantUrl(`/api/v1/uploads/${String(attachment.blob_id)}`, variationDigest)
      if (url) map.set(key, url)
    })
    return map
  }
}

function uniqueNumbers(values: Array<number | string | null | undefined>): number[] {
  return Array.from(
    new Set(
      values
        .map((value) => numberId(value))
        .filter((value): value is number => Boolean(value)),
    ),
  )
}

function contentSeenForNotice({
  entry: post,
  reply,
  replyId,
  viewState,
  chatSeen,
  isChatNotice,
  isChatReply,
  isIntroductionNotice,
  introductionSeenAt,
}: {
  entry?: { created_at: Date; published_at?: Date | null } | null
  reply?: { id: number; created_at: Date; published_at?: Date | null } | null
  replyId?: number | null
  viewState?: {
    entry_seen_at: Date | null
    reply_seen_through_at: Date | null
    reply_seen_through_id: number | null
  } | null
  chatSeen?: boolean
  isChatNotice?: boolean
  isChatReply?: boolean
  isIntroductionNotice?: boolean
  introductionSeenAt?: Date | null
}): boolean {
  if (isIntroductionNotice) return Boolean(introductionSeenAt)

  // Chat replies use their own visibility acknowledgements (inbox seen_at),
  // never the retired post view cursor or the parent message's receipt.
  if (isChatReply) return !reply

  if (isChatNotice) {
    return Boolean(chatSeen)
  }

  if (replyId) {
    if (!reply) return true
    if (!viewState?.reply_seen_through_at) return false

    return compareSeenCursor(
      {
        at: viewState.reply_seen_through_at,
        id: viewState.reply_seen_through_id ?? 0,
      },
      {
        at: reply.published_at ?? reply.created_at,
        id: Number(reply.id),
      },
    ) >= 0
  }

  if (!post) return true
  if (!viewState?.entry_seen_at) return false

  return viewState.entry_seen_at >= (post.published_at ?? post.created_at)
}

function isChatContentNotice(eventType: string): boolean {
  return eventType === "chat_message_created" || eventType === "chat_save_requested"
}

function isIntroductionNotice(eventType: string): boolean {
  return eventType === "introduction_created"
}

function compareSeenCursor(a: { at: Date; id: number }, b: { at: Date; id: number }): number {
  const time = a.at.getTime() - b.at.getTime()
  if (time !== 0) return time
  return a.id - b.id
}

function numberId(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function recordPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
