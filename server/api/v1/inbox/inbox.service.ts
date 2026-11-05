import { recentRoomMemberEntryIds } from "../entries/room-entry-history"
import { Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { extractPlainText } from "../../../realtime/document-content"
import { tiptapImageVariantUrls } from "../uploads/upload-urls"

type InboxBucket = "respond" | "review" | "remember"

export type InboxTask = {
  taskKey: string
  bucket: InboxBucket
  score: number
  reasons: string[]
  entryId: string
  targetPath: string
  roomId: string | null
  authorName: string
  excerpt: string
  content: unknown | null
  latestRoundAt: string
  replyCount: number
  isMine: boolean
  hasReplied: boolean
  reflectionCount: number
  hasMyReflection: boolean
}

export type InboxPayload = {
  respond: InboxTask[]
  review: InboxTask[]
  remember: InboxTask[]
}

type TaskCandidate = InboxTask | null

type ReflectionStats = {
  total: number
  mine: number
}

type ReviewStats = {
  count: number
  directMention: boolean
  latestAt: Date
}

type MentionStats = {
  latestAt: Date
  postLevelLatestAt: Date | null
  replyLevelLatestAt: Date | null
}

type TaskBase = {
  entryId: number
  targetPath: string
  roomId: number | null
  authorName: string
  excerpt: string
  content: unknown | null
  latestRoundAt: Date
  replyCount: number
  isMine: boolean
  hasReplied: boolean
  reflectionCount: number
  hasMyReflection: boolean
  isCurrentPost: boolean
}

const BUCKET_LIMIT = 10
const MAX_POSTS = 300
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

@Injectable()
export class InboxService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async inbox(userId: number): Promise<InboxPayload> {
    const now = new Date()
    const communityIds = await this.communityIdsFor(userId)
    if (communityIds.length === 0) return this.emptyPayload()

    const cutoff30 = new Date(now.getTime() - 30 * DAY_MS)
    const recentRoundFilter = {
      OR: [
        { published_at: { gte: cutoff30 } },
        { created_at: { gte: cutoff30 } },
        {
          replies: {
            some: {
              status: "published",
              OR: [{ published_at: { gte: cutoff30 } }, { created_at: { gte: cutoff30 } }],
            },
          },
        },
        {
          notification_events: {
            some: {
              event_type: "mention",
              target_user_id: userId,
              created_at: { gte: cutoff30 },
            },
          },
        },
      ],
    }

    const posts = await this.prisma.entry.findMany({
      where: {
        status: "published",
        AND: [
          {
            room_id: { in: communityIds },
          },
          recentRoundFilter,
        ],
      },
      include: {
        user: true,
        replies: {
          where: { status: "published" },
          select: { id: true, user_id: true, created_at: true, published_at: true },
        },
      },
      orderBy: [{ published_at: "desc" }, { created_at: "desc" }],
      take: MAX_POSTS,
    })

    if (posts.length === 0) return this.emptyPayload()

    const members = new Map<string, { roomId: number; userId: number }>()
    for (const post of posts) {
      const roomId = post.room_id
      if (roomId) members.set(`${roomId}:${post.user_id}`, { roomId, userId: post.user_id })
    }
    const currentEntryIds = new Set(await recentRoomMemberEntryIds(this.prisma, [...members.values()], 1))

    const postIds = posts.map((post) => this.toNumber(post.id)).filter(Boolean)
    const replyIds = posts.flatMap((post) => post.replies.map((reply) => this.toNumber(reply.id))).filter(Boolean)
    const authorIds = Array.from(new Set(posts.map((post) => this.toNumber(post.user_id)).filter(Boolean)))

    const [documents, mentionEvents, reflections, authorMemberships, postViewStates] = await Promise.all([
      this.prisma.document.findMany({
        where: { docable_type: "Post", docable_id: { in: postIds } },
        select: { docable_id: true, content: true },
      }),
      this.prisma.notificationEvent.findMany({
        where: {
          event_type: "mention",
          target_user_id: userId,
          entry_id: { in: postIds },
        },
        select: { entry_id: true, target_path: true, created_at: true },
      }),
      this.prisma.reflection.findMany({
        where: {
          OR: [
            { reflectable_type: "Post", reflectable_id: { in: postIds } },
            ...(replyIds.length > 0 ? [{ reflectable_type: "Reply", reflectable_id: { in: replyIds } }] : []),
          ],
        },
        select: { reflectable_type: true, reflectable_id: true, user_id: true },
      }),
      this.prisma.roomMembership.findMany({
        where: {
          room_id: { in: communityIds },
          user_id: { in: authorIds },
          disabled: false,
        },
        select: { room_id: true, user_id: true, username_override: true },
      }),
      this.prisma.entryViewState.findMany({
        where: { user_id: userId, entry_id: { in: postIds } },
        select: {
          entry_id: true,
          entry_seen_at: true,
          reply_seen_through_at: true,
          reply_seen_through_id: true,
        },
      }),
    ])

    const documentMap = new Map(documents.map((document) => [this.toNumber(document.docable_id), document.content]))
    const replyEntryMap = new Map<number, number>()
    posts.forEach((post) => {
      post.replies.forEach((reply) => replyEntryMap.set(this.toNumber(reply.id), this.toNumber(post.id)))
    })
    const reflectionMap = this.groupReflections(reflections, replyEntryMap, userId)
    const mentionMap = this.groupMentions(mentionEvents)
    const stateMap = new Map(postViewStates.map((state) => [this.toNumber(state.entry_id), state]))
    const reviewMap = this.groupReviewStats(posts, stateMap, mentionMap, userId)
    const membershipMap = new Map(
      authorMemberships.map((membership) => [
        `${this.toNumber(membership.user_id)}:${this.toNumber(membership.room_id)}`,
        membership.username_override,
      ]),
    )

    const payload = this.emptyPayload()

    posts.forEach((post) => {
      const postId = this.toNumber(post.id)
      const replies = post.replies
      const isMine = this.toNumber(post.user_id) === userId
      const hasReplied = replies.some((reply) => this.toNumber(reply.user_id) === userId)
      const communityId = this.toNumber(post.room_id) || null
      const latestRoundAt = this.latestRoundAt(post.published_at ?? post.created_at, replies)
      const reflectionStats = reflectionMap.get(postId) ?? { total: 0, mine: 0 }
      const content = documentMap.get(postId) ?? null
      const base = {
        entryId: postId,
        targetPath: `/app/entries/${postId}`,
        roomId: communityId,
        authorName:
          membershipMap.get(`${this.toNumber(post.user_id)}:${communityId ?? ""}`) ||
          post.user?.username ||
          "Someone",
        excerpt: this.excerptFor(documentMap.get(postId)),
        content: content ? tiptapImageVariantUrls(content, "w600") : null,
        latestRoundAt,
        replyCount: replies.length,
        isMine,
        hasReplied,
        reflectionCount: reflectionStats.total,
        hasMyReflection: reflectionStats.mine > 0,
        isCurrentPost: currentEntryIds.has(postId),
      }

      const respond = this.respondCandidate(base, replies, mentionMap.get(postId), userId, now)
      const review = this.reviewCandidate(base, reviewMap.get(postId), now)
      const remember = this.rememberCandidate(base, replies, now)

      if (respond) {
        payload.respond.push(respond)
      } else if (review) {
        payload.review.push(review)
      } else if (remember) {
        payload.remember.push(remember)
      }
    })

    return {
      respond: this.sortedLimited(payload.respond),
      review: this.sortedLimited(payload.review),
      remember: this.sortedLimited(payload.remember),
    }
  }

  private async communityIdsFor(userId: number): Promise<number[]> {
    const memberships = await this.prisma.roomMembership.findMany({
      where: { user_id: userId, disabled: false },
      select: { room_id: true },
    })
    return memberships.map((membership) => this.toNumber(membership.room_id)).filter(Boolean)
  }

  private respondCandidate(
    base: TaskBase,
    replies: Array<{ user_id: number | null; created_at: Date; published_at: Date | null }>,
    mention: MentionStats | undefined,
    userId: number,
    now: Date,
  ): TaskCandidate {
    if (base.isMine) return null

    const directMention = Boolean(mention)
    const latestMyReplyAt = this.latestReplyAt(replies.filter((reply) => this.toNumber(reply.user_id) === userId))
    const mentionAfterMyReply = directMention && (!latestMyReplyAt || mention!.latestAt > latestMyReplyAt)
    const needsResponse = !base.hasReplied || mentionAfterMyReply
    const ageMs = now.getTime() - base.latestRoundAt.getTime()
    if (!needsResponse) return null
    if (!directMention && ageMs > 14 * DAY_MS) return null

    const reasons: string[] = []
    let score = 45

    if (directMention) {
      score += 40
      reasons.push("mentioned you")
    }
    if (base.replyCount === 0) {
      score += 30
      reasons.push("no replies yet")
    }
    if (!base.hasReplied) {
      score += 20
      reasons.push("you have not responded")
    }
    if (base.isCurrentPost) {
      score += 15
      reasons.push("current work")
    }
    if (ageMs >= 6 * HOUR_MS && ageMs <= 48 * HOUR_MS) {
      score += 15
    } else if (ageMs < 6 * HOUR_MS) {
      score += 8
    }
    if (ageMs > 7 * DAY_MS) score -= 15
    if (ageMs > 14 * DAY_MS && !directMention) score -= 30

    return this.task("respond", base, score, reasons)
  }

  private reviewCandidate(
    base: TaskBase,
    review: ReviewStats | undefined,
    now: Date,
  ): TaskCandidate {
    if (!review) return null
    if (!base.isMine && !review.directMention && !base.hasReplied) return null

    const ageMs = now.getTime() - review.latestAt.getTime()
    const reasons: string[] = ["new replies"]
    let score = 50

    if (base.isMine) {
      score += 30
      reasons.push("on your post")
    }
    if (review.directMention) {
      score += 25
      reasons.push("mentioned you")
    }
    if (!base.isMine && base.hasReplied) {
      score += 8
      reasons.push("thread you joined")
    }

    score += Math.min(review.count * 6, 18)
    if (ageMs < DAY_MS) score += 12
    if (ageMs > 7 * DAY_MS) score -= 20

    return this.task("review", { ...base, latestRoundAt: review.latestAt }, score, reasons)
  }

  private rememberCandidate(
    base: TaskBase,
    replies: Array<{ user_id: number | null; created_at: Date; published_at: Date | null }>,
    now: Date,
  ): TaskCandidate {
    if (base.replyCount === 0 || base.hasMyReflection) return null

    const latestRoundAt = this.latestRoundAt(base.latestRoundAt, replies)
    const ageMs = now.getTime() - latestRoundAt.getTime()
    if (ageMs < 6 * HOUR_MS) return null

    const replyAuthorCount = new Set(replies.map((reply) => this.toNumber(reply.user_id)).filter(Boolean)).size
    const reasons: string[] = ["ready to save", "active exchange"]
    let score = 35

    if (base.isMine) score += 10
    if (base.replyCount === 1) score += 12
    if (base.replyCount === 2) score += 22
    if (base.replyCount >= 3) score += 30
    score += Math.min(replyAuthorCount * 8, 24)

    if (base.reflectionCount === 0) {
      score += 25
      reasons.push("not saved yet")
    } else {
      score += 10
      reasons.push("saved by others")
    }

    if (ageMs >= 6 * HOUR_MS && ageMs <= 3 * DAY_MS) score += 15
    if (ageMs > 3 * DAY_MS && ageMs <= 14 * DAY_MS) score += 8
    if (ageMs > 30 * DAY_MS) score -= 20

    return this.task("remember", { ...base, latestRoundAt }, score, reasons)
  }

  private task(
    bucket: InboxBucket,
    base: TaskBase,
    score: number,
    reasons: string[],
  ): InboxTask {
    return {
      taskKey: `${bucket}:post:${base.entryId}`,
      bucket,
      score,
      reasons: Array.from(new Set(reasons)),
      entryId: String(base.entryId),
      targetPath: base.targetPath,
      roomId: base.roomId ? String(base.roomId) : null,
      authorName: base.authorName,
      excerpt: base.excerpt,
      content: base.content,
      latestRoundAt: base.latestRoundAt.toISOString(),
      replyCount: base.replyCount,
      isMine: base.isMine,
      hasReplied: base.hasReplied,
      reflectionCount: base.reflectionCount,
      hasMyReflection: base.hasMyReflection,
    }
  }

  private groupReviewStats(
    posts: Array<{
      id: number
      replies: Array<{ id: number; user_id: number | null; created_at: Date; published_at: Date | null }>
    }>,
    stateMap: Map<number, {
      entry_seen_at: Date | null
      reply_seen_through_at: Date | null
      reply_seen_through_id: number | null
    }>,
    mentionMap: Map<number, MentionStats>,
    userId: number,
  ): Map<number, ReviewStats> {
    const map = new Map<number, ReviewStats>()
    posts.forEach((post) => {
      const postId = this.toNumber(post.id)
      if (!postId) return
      const state = stateMap.get(postId)
      const postSeenAt = state?.entry_seen_at ?? null
      const cursorAt = state?.reply_seen_through_at ?? null
      const cursorId = this.toNumber(state?.reply_seen_through_id)
      const unseenReplies = post.replies.filter((reply) => {
        if (this.toNumber(reply.user_id) === userId) return false
        return this.isAfterReplyCursor(reply, cursorAt, cursorId)
      })
      const mention = mentionMap.get(postId)
      const postMentionAt = mention?.postLevelLatestAt ?? null
      const replyMentionAt = mention?.replyLevelLatestAt ?? null
      const unseenEntryMention = Boolean(postMentionAt && (!postSeenAt || postMentionAt > postSeenAt))
      const unseenReplyMention = Boolean(replyMentionAt && (!cursorAt || replyMentionAt > cursorAt))
      const directMention = unseenEntryMention || unseenReplyMention
      if (unseenReplies.length === 0 && !directMention) return

      const latestReplyAt = this.latestReplyAt(unseenReplies)
      const latestMentionAt = this.latestDate([
        unseenEntryMention ? postMentionAt : null,
        unseenReplyMention ? replyMentionAt : null,
      ])
      const latestAt =
        latestReplyAt && (!latestMentionAt || latestReplyAt > latestMentionAt)
          ? latestReplyAt
          : latestMentionAt ?? latestReplyAt
      if (!latestAt) return

      map.set(postId, {
        count: unseenReplies.length + (directMention ? 1 : 0),
        directMention,
        latestAt,
      })
    })
    return map
  }

  private isAfterReplyCursor(
    reply: { id: number; created_at: Date; published_at: Date | null },
    cursorAt: Date | null,
    cursorId: number,
  ) {
    if (!cursorAt) return true
    const replyAt = reply.published_at ?? reply.created_at
    if (replyAt > cursorAt) return true
    return replyAt.getTime() === cursorAt.getTime() && this.toNumber(reply.id) > cursorId
  }

  private groupMentions(
    events: Array<{ entry_id: number | null; target_path?: string | null; created_at: Date }>,
  ): Map<number, MentionStats> {
    const map = new Map<number, MentionStats>()
    events.forEach((event) => {
      const postId = this.toNumber(event.entry_id)
      if (!postId) return
      const current = map.get(postId)
      const isReplyMention = Boolean(event.target_path?.includes("#reply-"))
      map.set(postId, {
        latestAt: !current || event.created_at > current.latestAt ? event.created_at : current.latestAt,
        postLevelLatestAt:
          !isReplyMention && (!current?.postLevelLatestAt || event.created_at > current.postLevelLatestAt)
            ? event.created_at
            : current?.postLevelLatestAt ?? null,
        replyLevelLatestAt:
          isReplyMention && (!current?.replyLevelLatestAt || event.created_at > current.replyLevelLatestAt)
            ? event.created_at
            : current?.replyLevelLatestAt ?? null,
      })
    })
    return map
  }

  private latestDate(dates: Array<Date | null | undefined>): Date | null {
    return dates.reduce<Date | null>((latest, date) => {
      if (!date) return latest
      return !latest || date > latest ? date : latest
    }, null)
  }

  private groupReflections(
    reflections: Array<{ reflectable_type: string; reflectable_id: number; user_id: number | null }>,
    replyEntryMap: Map<number, number>,
    userId: number,
  ): Map<number, ReflectionStats> {
    const map = new Map<number, ReflectionStats>()
    reflections.forEach((reflection) => {
      const postId =
        reflection.reflectable_type === "Post"
          ? this.toNumber(reflection.reflectable_id)
          : replyEntryMap.get(this.toNumber(reflection.reflectable_id))
      if (!postId) return
      const current = map.get(postId) ?? { total: 0, mine: 0 }
      map.set(postId, {
        total: current.total + 1,
        mine: current.mine + (this.toNumber(reflection.user_id) === userId ? 1 : 0),
      })
    })
    return map
  }

  private latestRoundAt(
    fallback: Date,
    replies: Array<{ created_at: Date; published_at: Date | null }>,
  ): Date {
    const latestReplyAt = this.latestReplyAt(replies)
    return latestReplyAt && latestReplyAt > fallback ? latestReplyAt : fallback
  }

  private latestReplyAt(replies: Array<{ created_at: Date; published_at: Date | null }>): Date | null {
    return replies.reduce<Date | null>((latest, reply) => {
      const candidate = reply.published_at ?? reply.created_at
      return !latest || candidate > latest ? candidate : latest
    }, null)
  }

  private sortedLimited(tasks: InboxTask[]): InboxTask[] {
    return tasks
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return Date.parse(b.latestRoundAt) - Date.parse(a.latestRoundAt)
      })
      .slice(0, BUCKET_LIMIT)
  }

  private excerptFor(documentContent?: unknown): string {
    const normalized = extractPlainText(documentContent).replace(/\s+/g, " ").trim()
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
  }

  private emptyPayload(): InboxPayload {
    return { respond: [], review: [], remember: [] }
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? Number(value) : Number(value)
  }
}
