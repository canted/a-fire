import { Inject, Injectable } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import type { RoomNotificationDeliveriesPayload, RoomNotificationDeliveryPayload } from "./rooms.types"

type NotificationDeliveryRow = Prisma.NotificationPushDeliveryGetPayload<{
  select: {
    id: true
    notification_event_id: true
    user_id: true
    state: true
    due_at: true
    sent_at: true
    cancelled_at: true
    skip_reason: true
    last_error: true
    created_at: true
    user: { select: { username: true } }
    notification_event: {
      select: {
        id: true
        event_type: true
        entry_id: true
        payload: true
        target_path: true
      }
    }
  }
}>

type NotificationDeliveryEntry = {
  id: number
  created_at: Date
  published_at: Date | null
}

type NotificationDeliveryReply = {
  id: number
  created_at: Date
  published_at: Date | null
}

type NotificationDeliveryViewState = {
  user_id: number
  entry_id: number
  entry_seen_at: Date | null
  reply_seen_through_at: Date | null
  reply_seen_through_id: number | null
}

/** Presents delivery and seen-state history after the facade verifies circle ownership. */
@Injectable()
export class RoomNotificationDeliveriesService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async listForCommunity(communityId: number): Promise<RoomNotificationDeliveriesPayload> {

    const deliveries = await this.prisma.notificationPushDelivery.findMany({
      where: {
        notification_event: {
          room_id: Number(communityId ?? 0),
        },
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        id: true,
        notification_event_id: true,
        user_id: true,
        state: true,
        due_at: true,
        sent_at: true,
        cancelled_at: true,
        skip_reason: true,
        last_error: true,
        created_at: true,
        user: { select: { username: true } },
        notification_event: {
          select: {
            id: true,
            event_type: true,
            entry_id: true,
            payload: true,
            target_path: true,
          },
        },
      },
    })

    const contentSeenContext = await this.notificationDeliveryContentSeenContext(deliveries)

    return { items: deliveries.map((delivery) => this.serializeNotificationDelivery(delivery, contentSeenContext)) }
  }

  private async notificationDeliveryContentSeenContext(deliveries: NotificationDeliveryRow[]) {
    const postIds = Array.from(
      new Set(
        deliveries
          .map((delivery) => {
            const event = delivery.notification_event
            return this.postIdFor(event.entry_id, event.target_path)
          })
          .filter((value): value is number => Boolean(value)),
      ),
    )
    const replyIds = Array.from(
      new Set(
        deliveries
          .map((delivery) => {
            const event = delivery.notification_event
            return this.numberId(this.replyIdFor(this.recordPayload(event.payload), event.target_path))
          })
          .filter((value): value is number => Boolean(value)),
      ),
    )
    const userIds = Array.from(new Set(deliveries.map((delivery) => Number(delivery.user_id ?? 0)).filter(Boolean)))

    const [posts, replies, postViewStates] = await Promise.all([
      postIds.length
        ? this.prisma.entry.findMany({
            where: { id: { in: postIds } },
            select: { id: true, created_at: true, published_at: true },
          })
        : [],
      replyIds.length
        ? this.prisma.reply.findMany({
            where: { id: { in: replyIds } },
            select: { id: true, created_at: true, published_at: true },
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
    ])

    return {
      postsByPostId: new Map(posts.map((post: NotificationDeliveryEntry) => [Number(post.id), post] as const)),
      repliesByReplyId: new Map(replies.map((reply: NotificationDeliveryReply) => [Number(reply.id), reply] as const)),
      viewStatesByUserAndPost: new Map(
        postViewStates.map((state: NotificationDeliveryViewState) => [`${Number(state.user_id)}:${Number(state.entry_id)}`, state] as const),
      ),
    }
  }

  private serializeNotificationDelivery(
    delivery: NotificationDeliveryRow,
    context: Awaited<ReturnType<RoomNotificationDeliveriesService["notificationDeliveryContentSeenContext"]>>,
  ): RoomNotificationDeliveryPayload {
    const event = delivery.notification_event
    const payload = this.recordPayload(event.payload)
    const replyId = this.replyIdFor(payload, event.target_path)
    const replyIdNumber = this.numberId(replyId)
    const postId = this.postIdFor(event.entry_id, event.target_path)
    const linkPath = this.deliveryLinkPath(event.target_path, postId, replyId)
    const viewState = postId ? context.viewStatesByUserAndPost.get(`${Number(delivery.user_id ?? 0)}:${postId}`) ?? null : null
    const post = postId ? context.postsByPostId.get(postId) ?? null : null
    const reply = replyIdNumber ? context.repliesByReplyId.get(replyIdNumber) ?? null : null

    return {
      id: Number(delivery.id ?? 0),
      notification_event_id: Number(delivery.notification_event_id ?? 0),
      user_id: Number(delivery.user_id ?? 0),
      user_name: delivery.user?.username || `User ${Number(delivery.user_id ?? 0)}`,
      state: delivery.state,
      created_at: delivery.created_at.toISOString(),
      due_at: delivery.due_at?.toISOString() ?? null,
      sent_at: delivery.sent_at?.toISOString() ?? null,
      cancelled_at: delivery.cancelled_at?.toISOString() ?? null,
      skip_reason: delivery.skip_reason,
      last_error: delivery.last_error,
      event_type: event.event_type,
      entry_id: postId,
      reply_id: replyId,
      link_path: linkPath,
      link_label: replyId ? `Reply ${replyId}` : postId ? `Post ${postId}` : `Event ${Number(event.id ?? 0)}`,
      content_seen: this.contentSeenForDelivery({ entry: post, reply, replyId: replyIdNumber, viewState }),
    }
  }

  private contentSeenForDelivery({
    entry: post,
    reply,
    replyId,
    viewState,
  }: {
    entry?: NotificationDeliveryEntry | null
    reply?: NotificationDeliveryReply | null
    replyId?: number | null
    viewState?: NotificationDeliveryViewState | null
  }): boolean {
    if (replyId) {
      if (!reply) return true
      if (!viewState?.reply_seen_through_at) return false

      return this.compareSeenCursor(
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

  private compareSeenCursor(a: { at: Date; id: number }, b: { at: Date; id: number }): number {
    const time = a.at.getTime() - b.at.getTime()
    if (time !== 0) return time
    return a.id - b.id
  }

  private deliveryLinkPath(targetPath: string | null | undefined, postId: number | null, replyId: string | null) {
    if (targetPath) return targetPath
    if (!postId) return null
    return replyId ? `/app/entries/${postId}#reply-${replyId}` : `/app/entries/${postId}`
  }

  private replyIdFor(payload: Record<string, unknown>, targetPath?: string | null): string | null {
    const payloadReplyId = payload.replyId ?? payload.reply_id
    if (typeof payloadReplyId === "string" || typeof payloadReplyId === "number") return String(payloadReplyId)

    const match = targetPath?.match(/#reply-([^/?#]+)/)
    return match?.[1] ?? null
  }

  private postIdFor(postId: number | string | null | undefined, targetPath?: string | null): number | null {
    const eventEntryId = this.numberId(postId)
    if (eventEntryId) return eventEntryId

    const match = targetPath?.match(/\/(?:posts?|entries)\/([^/?#]+)/i)
    return this.numberId(match?.[1])
  }

  private numberId(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null
    const parsed = typeof value === "number" ? value : Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  private recordPayload(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as Record<string, unknown>
  }
}
