import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import { NotificationInboxSerializer, noticeReplyBundleKey } from "../../../notifications/notification-inbox.serializer"
import { isProjectEntry } from "../projects/project-access"

// Both read-state mutations must merge against the row locked by PostgreSQL.
const advanceViewStateOnConflict = Prisma.sql`
      ON CONFLICT (user_id, entry_id) DO UPDATE SET
        entry_seen_at = CASE
          WHEN EXCLUDED.entry_seen_at IS NULL THEN entry_view_states.entry_seen_at
          WHEN entry_view_states.entry_seen_at IS NULL OR entry_view_states.entry_seen_at < EXCLUDED.entry_seen_at
            THEN EXCLUDED.entry_seen_at
          ELSE entry_view_states.entry_seen_at
        END,
        reply_seen_through_at = CASE
          WHEN EXCLUDED.reply_seen_through_at IS NULL THEN entry_view_states.reply_seen_through_at
          WHEN entry_view_states.reply_seen_through_at IS NULL
            OR EXCLUDED.reply_seen_through_at > entry_view_states.reply_seen_through_at
            OR (
              EXCLUDED.reply_seen_through_at = entry_view_states.reply_seen_through_at
              AND COALESCE(EXCLUDED.reply_seen_through_id, 0) > COALESCE(entry_view_states.reply_seen_through_id, 0)
            )
            THEN EXCLUDED.reply_seen_through_at
          ELSE entry_view_states.reply_seen_through_at
        END,
        reply_seen_through_id = CASE
          WHEN EXCLUDED.reply_seen_through_at IS NULL THEN entry_view_states.reply_seen_through_id
          WHEN entry_view_states.reply_seen_through_at IS NULL
            OR EXCLUDED.reply_seen_through_at > entry_view_states.reply_seen_through_at
            OR (
              EXCLUDED.reply_seen_through_at = entry_view_states.reply_seen_through_at
              AND COALESCE(EXCLUDED.reply_seen_through_id, 0) > COALESCE(entry_view_states.reply_seen_through_id, 0)
            )
            THEN EXCLUDED.reply_seen_through_id
          ELSE entry_view_states.reply_seen_through_id
        END,
        updated_at = GREATEST(entry_view_states.updated_at, EXCLUDED.updated_at)
`

export type UnseenCount = {
  total: number
  entries: number
  replies: number
}

export type MarkEntrySeenInput = {
  postVisible?: boolean
  replyIds?: Array<number | string>
}

type ReplyCursor = { id: number; at: Date }

@Injectable()
export class UnseenContentService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(NotificationInboxSerializer)
  private readonly inboxSerializer!: NotificationInboxSerializer

  async countForUser(userId: number, communityId?: number): Promise<UnseenCount> {
    return (await this.collectCounts(userId, communityId)).overall
  }

  async countForUserWithRooms(userId: number, roomIds: number[]) {
    return this.collectCounts(userId, undefined, roomIds)
  }

  private async collectCounts(userId: number, communityId?: number, roomIds: number[] = []) {
    const rooms = new Map(roomIds.map(id => [id, { entries: 0, replies: new Set<string>() }]))
    const finish = (posts: number, replies: number) => ({
      overall: { total: posts + replies, entries: posts, replies },
      byRoom: new Map([...rooms].map(([id, count]) => [id, { total: count.entries + count.replies.size, entries: count.entries, replies: count.replies.size }])),
    })
    if (!userId) return finish(0, 0)

    // Use the same resolved read state and reply grouping as the Notices list.
    // Scan in bounded batches so older unread notices are not lost to pagination.
    let cursor: number | undefined
    let posts = 0
    const replyGroups = new Set<string>()
    for (;;) {
      const records = await this.prisma.notificationInboxItem.findMany({
        where: { user_id: userId, seen_at: null, ...(cursor ? { id: { gt: cursor } } : {}), ...(communityId ? { notification_event: { room_id: communityId } } : {}) },
        include: { notification_event: { include: { actor: true, room: true } } },
        orderBy: { id: "asc" },
        take: 250,
      })
      if (!records.length) break
      const notices = await this.inboxSerializer.serialize(records)
      const roomByItem = new Map(records.map(record => [String(record.id), record.notification_event?.room_id]))
      for (const notice of notices) {
        if (notice.contentSeen) continue
        const replyKey = noticeReplyBundleKey(notice)
        if (replyKey) replyGroups.add(replyKey)
        else posts += 1
        const roomId = roomByItem.get(notice.id)
        const room = roomId == null ? undefined : rooms.get(roomId)
        if (room) {
          if (replyKey) room.replies.add(replyKey)
          else room.entries++
        }
      }
      cursor = records[records.length - 1].id
      if (records.length < 250) break
    }
    const replies = replyGroups.size
    // Preserve the legacy response fields for existing clients. "posts" now
    // means non-reply notices; total is the number of unread notice cards.
    return finish(posts, replies)
  }

  /** Unseen replies to the viewer's work, using the same resolved state as the inbox. */
  async countResponsesToOwnPosts(userId: number, roomIds: number[]): Promise<number> {
    if (!userId || !roomIds.length) return 0
    const replyIds = new Set<string>()
    let cursor: number | undefined
    for (;;) {
      const records = await this.prisma.notificationInboxItem.findMany({
        where: { user_id: userId, seen_at: null, ...(cursor ? { id: { gt: cursor } } : {}), notification_event: {
          room_id: { in: roomIds },
          entry: { user_id: userId, status: "published", room_id: { in: roomIds } },
        } },
        include: { notification_event: { include: { actor: true, room: true } } },
        orderBy: { id: "asc" }, take: 250,
      })
      if (!records.length) break
      for (const notice of await this.inboxSerializer.serialize(records)) {
        if (!notice.contentSeen && noticeReplyBundleKey(notice) && notice.notificationEvent.replyId) replyIds.add(notice.notificationEvent.replyId)
      }
      cursor = records[records.length - 1].id
      if (records.length < 250) break
    }
    return replyIds.size
  }

  async markPostSeen(userId: number, postId: number, input: MarkEntrySeenInput): Promise<UnseenCount> {
    if (!userId || !postId) return this.countForUser(userId)

    const post = await this.prisma.entry.findUnique({
      where: { id: postId },
    })
    if (!post) throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) throw new ForbiddenException("Project material has no circle unread state")

    const communityId = this.toNumber(post.room_id)
    if (communityId) {
      const membership = await this.prisma.roomMembership.findFirst({
        where: { room_id: communityId, user_id: userId, disabled: false },
        select: { id: true },
      })
      if (!membership) throw new ForbiddenException("Forbidden")
    }

    const replyCursor = await this.latestReplyCursor(post.id, input.replyIds ?? [])
    if (input.postVisible || replyCursor) {
      const now = new Date()
      // These columns store UTC without a zone. Bind ISO text explicitly to
      // avoid converting Date parameters through the database session zone.
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO entry_view_states (
          user_id, entry_id, entry_seen_at, reply_seen_through_at,
          reply_seen_through_id, created_at, updated_at
        ) VALUES (
          ${userId}, ${post.id}, ${input.postVisible ? now.toISOString() : null}::timestamp,
          ${replyCursor?.at.toISOString() ?? null}::timestamp, ${replyCursor?.id ?? null},
          ${now.toISOString()}::timestamp, ${now.toISOString()}::timestamp
        )
        ${advanceViewStateOnConflict}
      `)
    }

    return this.countForUser(userId)
  }

  async markAllSeen(userId: number): Promise<UnseenCount> {
    if (!userId) return this.countForUser(userId)

    const now = new Date()
    // A data-modifying CTE executes even without a downstream reference. Keep
    // view positions and inbox state in one statement so both commit or neither.
    await this.prisma.$executeRaw(Prisma.sql`
      WITH readable_posts AS (
        SELECT
          p.id AS entry_id
        FROM entries p
        INNER JOIN room_memberships cm
          ON cm.room_id = p.room_id
         AND cm.user_id = ${userId}
         AND cm.disabled = false
        WHERE p.status = 'published'
          AND p.user_id <> ${userId}
          AND COALESCE(p.published_at, p.created_at) > cm.unseen_started_at
      ),
      latest_reply_cursors AS (
        SELECT DISTINCT ON (r.entry_id)
          r.entry_id AS entry_id,
          r.id AS reply_id,
          COALESCE(r.published_at, r.created_at) AS reply_at
        FROM replies r
        INNER JOIN entries p
          ON p.id = r.entry_id
        INNER JOIN room_memberships cm
          ON cm.room_id = p.room_id
         AND cm.user_id = ${userId}
         AND cm.disabled = false
        WHERE r.status = 'published'
          AND p.status = 'published'
          AND (r.user_id IS NULL OR r.user_id <> ${userId})
          AND COALESCE(r.published_at, r.created_at) > cm.unseen_started_at
        ORDER BY r.entry_id, COALESCE(r.published_at, r.created_at) DESC, r.id DESC
      ),
      targets AS (
        SELECT
          COALESCE(readable_posts.entry_id, latest_reply_cursors.entry_id) AS entry_id,
          CASE WHEN readable_posts.entry_id IS NULL THEN NULL ELSE ${now.toISOString()}::timestamp END AS entry_seen_at,
          latest_reply_cursors.reply_at AS reply_seen_through_at,
          latest_reply_cursors.reply_id AS reply_seen_through_id
        FROM readable_posts
        FULL OUTER JOIN latest_reply_cursors
          ON latest_reply_cursors.entry_id = readable_posts.entry_id
      ), updated_view_states AS (
      INSERT INTO entry_view_states (
        user_id,
        entry_id,
        entry_seen_at,
        reply_seen_through_at,
        reply_seen_through_id,
        created_at,
        updated_at
      )
      SELECT
        ${userId},
        targets.entry_id,
        targets.entry_seen_at,
        targets.reply_seen_through_at,
        targets.reply_seen_through_id,
        ${now.toISOString()}::timestamp,
        ${now.toISOString()}::timestamp
      FROM targets
      WHERE targets.entry_id IS NOT NULL
      ${advanceViewStateOnConflict}
      RETURNING id
      )
      UPDATE notification_inbox_items
      SET seen_at = ${now.toISOString()}::timestamp
      WHERE user_id = ${userId}
        AND seen_at IS NULL
        AND created_at <= ${now.toISOString()}::timestamp
    `)

    return this.countForUser(userId)
  }

  private async latestReplyCursor(postId: number, replyIds: Array<number | string>): Promise<ReplyCursor | null> {
    const ids = Array.from(new Set(replyIds.map((id) => this.toNumber(id)).filter(Boolean)))
    if (ids.length === 0) return null

    const replies = await this.prisma.reply.findMany({
      where: { id: { in: ids }, entry_id: postId, status: "published" },
      select: { id: true, created_at: true, published_at: true },
    })

    return replies.reduce<ReplyCursor | null>((latest, reply) => {
      const cursor = { id: this.toNumber(reply.id), at: reply.published_at ?? reply.created_at }
      if (!latest) return cursor
      return this.compareCursor(cursor, latest) > 0 ? cursor : latest
    }, null)
  }

  private compareCursor(a: ReplyCursor, b: ReplyCursor): number {
    const timeDiff = a.at.getTime() - b.at.getTime()
    if (timeDiff !== 0) return timeDiff
    return a.id - b.id
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? Number(value) : Number(value)
  }
}
