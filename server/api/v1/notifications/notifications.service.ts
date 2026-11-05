import { BadRequestException, Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import {
  NotificationInboxSerializer,
  noticeReplyBundleKey,
  type NotificationInboxRecord,
} from "../../../notifications/notification-inbox.serializer"

export type NotificationInboxPayload = {
  items: NotificationInboxRecord[]
  highlightAfter: string
  visitSeenThroughAt: string
  nextCursor: string | null
}

const DEFAULT_NOTICE_LIMIT = 10
const NOTICE_FETCH_MULTIPLIER = 5
const MAX_NOTICE_FETCH = 250

@Injectable()
export class NotificationsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(NotificationInboxSerializer)
  private readonly inboxSerializer!: NotificationInboxSerializer

  async inbox(userId: number, limit = DEFAULT_NOTICE_LIMIT, cursor?: number): Promise<NotificationInboxPayload> {
    const visitSeenThroughAt = new Date()
    if (!userId) {
      return {
        items: [],
        highlightAfter: visitSeenThroughAt.toISOString(),
        visitSeenThroughAt: visitSeenThroughAt.toISOString(),
        nextCursor: null,
      }
    }
    const noticeCursor = await this.prisma.userNoticeCursor.findUnique({
      where: { user_id: userId },
      select: { seen_through_at: true },
    })
    const bounded = this.normalizeLimit(limit)
    const cursorId = this.normalizeCursor(cursor)
    const fetchLimit = Math.min(bounded * NOTICE_FETCH_MULTIPLIER + 1, MAX_NOTICE_FETCH)
    const query = {
      where: { user_id: userId },
      include: { notification_event: { include: { actor: true, room: true } } },
      orderBy: [{ created_at: "desc" as const }, { id: "desc" as const }],
      take: fetchLimit,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    }
    const records = await this.prisma.notificationInboxItem.findMany(query)
    const serialized = await this.inboxSerializer.serialize(records)
    const bundled = this.bundleDisplayNotices(serialized, bounded, records.length === fetchLimit)

    return {
      items: bundled.items,
      highlightAfter: (noticeCursor?.seen_through_at ?? new Date(0)).toISOString(),
      visitSeenThroughAt: visitSeenThroughAt.toISOString(),
      // A fully filtered page must still advance through retained inbox history.
      nextCursor: bundled.nextCursor ?? (records.length === fetchLimit ? String(records[records.length - 1].id) : null),
    }
  }

  private bundleDisplayNotices(
    records: NotificationInboxRecord[],
    limit: number,
    hasMoreRawRecords: boolean,
  ): { items: NotificationInboxRecord[]; nextCursor: string | null } {
    const items: NotificationInboxRecord[] = []
    const replyGroups = new Map<string, NotificationInboxRecord>()
    let consumedIndex = -1
    let overflow = false

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      const bundleKey = this.replyBundleKey(record)

      if (bundleKey) {
        const existing = replyGroups.get(bundleKey)
        if (existing) {
          this.mergeReplyBundle(existing, record, bundleKey)
          consumedIndex = index
          continue
        }

        if (items.length >= limit) {
          overflow = true
          break
        }

        const bundle = this.initialReplyBundle(record, bundleKey)
        replyGroups.set(bundleKey, bundle)
        items.push(bundle)
        consumedIndex = index
        continue
      }

      if (items.length >= limit) {
        overflow = true
        break
      }

      items.push(record)
      consumedIndex = index
    }

    return {
      items,
      nextCursor: overflow || (hasMoreRawRecords && consumedIndex >= 0) ? records[consumedIndex]?.id ?? null : null,
    }
  }

  private initialReplyBundle(record: NotificationInboxRecord, key: string): NotificationInboxRecord {
    const actor = this.bundleActor(record)
    return {
      ...record,
      bundle: {
        type: "reply",
        key,
        itemIds: [record.id],
        replyCount: 1,
        actors: actor ? [actor] : [],
      },
    }
  }

  private mergeReplyBundle(bundle: NotificationInboxRecord, record: NotificationInboxRecord, key: string): void {
    const event = bundle.notificationEvent
    const incomingEvent = record.notificationEvent
    const existingActor = this.bundleActor(bundle)
    const currentBundle = bundle.bundle ?? {
      type: "reply" as const,
      key,
      itemIds: [bundle.id],
      replyCount: 1,
      actors: existingActor ? [existingActor] : [],
    }
    const incomingActor = this.bundleActor(record)
    const currentActors = this.mergeBundleActors(currentBundle.actors, incomingActor, !record.contentSeen)
    const targetReplyId = this.targetReplyIdForBundle(bundle, record)

    bundle.contentSeen = bundle.contentSeen && record.contentSeen
    bundle.bundle = {
      ...currentBundle,
      itemIds: [...currentBundle.itemIds, record.id],
      replyCount: currentBundle.replyCount + 1,
      actors: currentActors,
    }
    event.actorUsername = currentActors[0]?.username ?? event.actorUsername
    event.actorAvatarUrl = currentActors[0]?.avatarUrl ?? null
    event.replyId = targetReplyId
    event.targetPath = event.entryId && targetReplyId ? `/app/entries/${event.entryId}#reply-${targetReplyId}` : event.targetPath
    event.payload = {
      ...event.payload,
      replyCount: bundle.bundle.replyCount,
      bundledInboxItemIds: bundle.bundle.itemIds,
    }

    if (!event.postAuthorUsername && incomingEvent.postAuthorUsername) {
      event.postAuthorUsername = incomingEvent.postAuthorUsername
    }
  }

  private mergeBundleActors(
    actors: Array<{ username: string; avatarUrl?: string | null; unseen?: boolean }>,
    incoming: { username: string; avatarUrl?: string | null; unseen?: boolean } | null,
    incomingUnseen: boolean,
  ): Array<{ username: string; avatarUrl?: string | null; unseen?: boolean }> {
    if (!incoming) return actors

    const incomingActor = { ...incoming, unseen: incomingUnseen || incoming.unseen }
    const deduped = actors.filter((actor) => actor.username !== incomingActor.username)
    if (!incomingActor.unseen) return [...deduped, incomingActor]

    const firstSeenIndex = deduped.findIndex((actor) => !actor.unseen)
    if (firstSeenIndex === -1) return [...deduped, incomingActor]
    return [...deduped.slice(0, firstSeenIndex), incomingActor, ...deduped.slice(firstSeenIndex)]
  }

  private targetReplyIdForBundle(bundle: NotificationInboxRecord, incoming: NotificationInboxRecord): string | null | undefined {
    if (!bundle.contentSeen && incoming.contentSeen) return bundle.notificationEvent.replyId
    if (!bundle.contentSeen && !incoming.contentSeen) return incoming.notificationEvent.replyId
    if (bundle.contentSeen && !incoming.contentSeen) return incoming.notificationEvent.replyId
    return bundle.notificationEvent.replyId
  }

  private bundleActor(record: NotificationInboxRecord): { username: string; avatarUrl?: string | null; unseen?: boolean } | null {
    const username = record.notificationEvent.actorUsername
    if (!username) return null
    return { username, avatarUrl: record.notificationEvent.actorAvatarUrl ?? null, unseen: !record.contentSeen }
  }

  private replyBundleKey(record: NotificationInboxRecord): string | null {
    return noticeReplyBundleKey(record)
  }

  async markNoticesSeen(userId: number, noticeIds: unknown): Promise<void> {
    if (!Array.isArray(noticeIds) || noticeIds.length > 100 ||
        noticeIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException("Invalid noticeIds")
    }
    if (!userId || !noticeIds.length) return
    await this.prisma.notificationInboxItem.updateMany({
      where: { user_id: userId, id: { in: noticeIds }, seen_at: null },
      data: { seen_at: new Date() },
    })
  }

  async markSeenThrough(userId: number, seenThroughAtValue: string): Promise<void> {
    if (!userId) return
    const seenThroughAt = new Date(seenThroughAtValue)
    if (Number.isNaN(seenThroughAt.getTime())) {
      throw new BadRequestException("Invalid seenThroughAt")
    }

    const existing = await this.prisma.userNoticeCursor.findUnique({
      where: { user_id: userId },
      select: { id: true, seen_through_at: true },
    })
    const now = new Date()
    if (seenThroughAt > now) {
      throw new BadRequestException("Invalid seenThroughAt")
    }
    if (!existing) {
      try {
        await this.prisma.userNoticeCursor.create({
          data: {
            user_id: userId,
            seen_through_at: seenThroughAt,
            created_at: now,
            updated_at: now,
          },
        })
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) throw error
        await this.advanceExistingCursor(userId, seenThroughAt, now)
      }
      return
    }
    if (existing.seen_through_at >= seenThroughAt) return

    await this.advanceExistingCursor(userId, seenThroughAt, now)
  }

  private async advanceExistingCursor(userId: number, seenThroughAt: Date, now: Date): Promise<void> {
    const existing = await this.prisma.userNoticeCursor.findUnique({
      where: { user_id: userId },
      select: { seen_through_at: true },
    })
    if (existing && existing.seen_through_at >= seenThroughAt) return

    await this.prisma.userNoticeCursor.update({
      where: { user_id: userId },
      data: { seen_through_at: seenThroughAt, updated_at: now },
    })
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (error as { code?: string })?.code === "P2002"
  }

  private normalizeLimit(limit: number | undefined): number {
    return Number.isFinite(limit) ? Math.min(Math.max(limit ?? DEFAULT_NOTICE_LIMIT, 1), 100) : DEFAULT_NOTICE_LIMIT
  }

  private normalizeCursor(cursor: number | undefined): number | undefined {
    if (cursor === undefined) return undefined
    if (!Number.isInteger(cursor) || cursor <= 0) {
      throw new BadRequestException("Invalid cursor")
    }
    return cursor
  }
}
