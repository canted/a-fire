import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import { BossService } from "../../../queue/boss.service"
import { withActiveRoomTransaction } from "../rooms/room-membership-transaction"
import { roomEntryRoomId } from "../entries/room-entry-scope"
import { identityImageUrls } from "../uploads/identity-images"

const MAX_NOTE_LENGTH = 1000

export type IntroductionParticipantPayload = {
  id: string
  displayUsername: string
  avatarUrl?: string | null
  squareId?: string | null
}

export type IntroductionSummaryPayload = {
  id: string
  note: string
  createdAt: string
  entryId?: string | null
  throughPost: boolean
  viewerIsRecipient: boolean
  viewerSeenAt?: string | null
  canHide: boolean
  canRetract: boolean
  createdBy: IntroductionParticipantPayload
  participants: IntroductionParticipantPayload[]
  otherUser: IntroductionParticipantPayload
}

export type IntroductionOverviewPayload = {
  count: number
  unseenCount: number
  authors: IntroductionParticipantPayload[]
  remainingAuthorCount: number
  unseenIntroductions: IntroductionSummaryPayload[]
}

type CreateIntroductionInput = {
  room_id?: unknown
  roomId?: unknown
  recipient_user_ids?: unknown
  recipientUserIds?: unknown
  note?: unknown
  entry_id?: unknown
  entryId?: unknown
}

type IntroductionForSummary = Prisma.IntroductionGetPayload<{
  include: {
    created_by: true
    recipients: { include: { user: true } }
  }
}>

@Injectable()
export class IntroductionsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(BossService)
  private readonly boss!: BossService

  async create(userId: number, input: CreateIntroductionInput) {
    const communityId = numericId(input.room_id ?? input.roomId)
    if (!communityId) throw new BadRequestException("Circle is required")

    const recipientUserIds = uniqueNumericIds(input.recipient_user_ids ?? input.recipientUserIds)
    if (recipientUserIds.length !== 2) {
      throw new BadRequestException("Choose exactly two people to introduce")
    }
    if (recipientUserIds.includes(userId)) {
      throw new BadRequestException("Choose two other people to introduce")
    }

    const note = typeof input.note === "string" ? input.note.trim() : ""
    if (!note) throw new BadRequestException("What overlap do you see?")
    if (note.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(`Keep the introduction under ${MAX_NOTE_LENGTH} characters`)
    }

    const postId = numericId(input.entry_id ?? input.entryId)
    const now = new Date()

    return withActiveRoomTransaction(this.prisma, communityId, async transaction => {
      const actorMembership = await transaction.roomMembership.findFirst({
        where: { room_id: communityId, user_id: userId, disabled: false },
        include: { user: true },
      })
      if (!actorMembership) throw new ForbiddenException("Not authorized to introduce people in this circle")

      const recipientMemberships = await transaction.roomMembership.findMany({
        where: { room_id: communityId, user_id: { in: recipientUserIds }, disabled: false },
        include: { user: true },
      })
      if (recipientMemberships.length !== 2) {
        throw new BadRequestException("Both people must be active members of this circle")
      }

      const existingIntroduction = await transaction.introduction.findFirst({
        where: {
          room_id: communityId,
          created_by_id: userId,
          retracted_at: null,
          AND: recipientUserIds.map((recipientUserId) => ({
            recipients: { some: { user_id: recipientUserId } },
          })),
        },
        select: { id: true },
      })
      if (existingIntroduction) {
        return { introduction: { id: String(existingIntroduction.id) }, existing: true }
      }

      const post = postId
        ? await transaction.entry.findFirst({
            where: { id: postId, status: "published" },
          })
        : null
      if (postId && (!post || post.project_id != null || roomEntryRoomId(post) !== communityId)) {
        throw new BadRequestException("Post context must belong to this circle")
      }

      const introduction = await transaction.introduction.create({
        data: {
          room_id: communityId,
          created_by_id: userId,
          entry_id: postId,
          note,
          created_at: now,
          updated_at: now,
          recipients: {
            create: recipientUserIds.map((recipientUserId) => ({
              user_id: recipientUserId,
              created_at: now,
              updated_at: now,
            })),
          },
        },
        include: {
          created_by: true,
          recipients: { include: { user: true } },
        },
      })

      await this.enqueueRecipientNotices(transaction, {
        actorUserId: userId,
        roomId: communityId,
        introductionId: introduction.id,
        note,
        entryId: postId,
        recipientUserIds,
        recipientMemberships,
      })

      return {
        introduction: {
          id: String(introduction.id),
        },
      }
    })
  }

  async listCreatedPairs(userId: number, communityId: number) {
    if (!communityId) throw new BadRequestException("Circle is required")
    const membership = await this.prisma.roomMembership.findFirst({
      where: { room_id: communityId, user_id: userId, disabled: false },
      select: { id: true },
    })
    if (!membership) throw new ForbiddenException("Not authorized to introduce people in this circle")

    const introductions = await this.prisma.introduction.findMany({
      where: { room_id: communityId, created_by_id: userId, retracted_at: null },
      select: { id: true, recipients: { select: { user_id: true } } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    })

    return {
      pairs: introductions.flatMap((introduction) => {
        const recipientUserIds = uniqueNumericIds(
          introduction.recipients.map((recipient) => recipient.user_id),
        ).sort((left, right) => left - right)
        if (recipientUserIds.length !== 2) return []
        return [{
          introduction_id: String(introduction.id),
          recipient_user_ids: recipientUserIds,
        }]
      }),
    }
  }

  async hide(userId: number, introductionId: number) {
    const recipient = await this.prisma.introductionRecipient.findFirst({
      where: { introduction_id: introductionId, user_id: userId },
      include: { introduction: true },
    })
    if (!recipient || recipient.introduction.retracted_at) throw new NotFoundException("Not Found")

    await this.prisma.introductionRecipient.update({
      where: { id: recipient.id },
      data: { hidden_at: new Date(), updated_at: new Date() },
    })

    return { success: true }
  }

  async retract(userId: number, introductionId: number) {
    const introduction = await this.prisma.introduction.findUnique({ where: { id: introductionId } })
    if (!introduction) throw new NotFoundException("Not Found")
    if (introduction.created_by_id !== userId) throw new ForbiddenException("Only the introducer can retract this")

    await this.prisma.introduction.update({
      where: { id: introductionId },
      data: {
        retracted_at: introduction.retracted_at ?? new Date(),
        retracted_by_id: userId,
        updated_at: new Date(),
      },
    })

    return { success: true }
  }

  async markSeen(userId: number, introductionIds: unknown) {
    const ids = uniqueNumericIds(introductionIds)
    if (ids.length === 0) return { success: true, markedCount: 0 }

    const result = await this.prisma.introductionRecipient.updateMany({
      where: {
        introduction_id: { in: ids },
        user_id: userId,
        seen_at: null,
        introduction: { retracted_at: null },
      },
      data: { seen_at: new Date(), updated_at: new Date() },
    })

    return { success: true, markedCount: result.count }
  }

  async pageForMember(params: {
    roomId: number; viewedUserId: number; viewedSquareId?: number; viewerUserId: number;
    cursor?: string; target?: string;
  }): Promise<{ introductions: IntroductionSummaryPayload[]; nextCursor: string | null }> {
    const parseId = (value: string | undefined) => {
      if (value === undefined) return undefined
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new BadRequestException("Invalid introduction cursor or target")
      return Number(value)
    }
    const cursor = parseId(params.cursor), target = parseId(params.target)
    const scope: Prisma.IntroductionWhereInput = {
      room_id: params.roomId, recipients: { some: { user_id: params.viewedUserId } },
    }
    const visible: Prisma.IntroductionWhereInput = { ...scope, retracted_at: null,
      OR: [{ created_by_id: params.viewerUserId }, { recipients: { some: { user_id: params.viewerUserId, hidden_at: null } } }],
    }
    if (cursor && !await this.prisma.introduction.findFirst({ where: { ...scope, id: cursor }, select: { id: true } })) throw new BadRequestException("Invalid introduction cursor")
    const rows = await this.prisma.introduction.findMany({
      where: { ...visible, ...(cursor ? { id: { not: cursor } } : {}) },
      include: { created_by: true, recipients: { include: { user: true } } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 31,
      ...(cursor ? { cursor: { id: cursor } } : {}),
    })
    const page = rows.slice(0, 30)
    const nextCursor = rows.length > 30 ? String(page.at(-1)!.id) : null
    // A notification can address an old introduction without loading all intervening history.
    if (!cursor && target && !page.some(row => row.id === target)) {
      const highlighted = await this.prisma.introduction.findFirst({ where: { ...visible, id: target }, include: { created_by: true, recipients: { include: { user: true } } } })
      if (highlighted) page.push(highlighted)
    }
    return { introductions: await this.serializeSummaries(page, params), nextCursor }
  }

  async overviewForMember(params: { roomId: number; viewedUserId: number; viewedSquareId?: number; viewerUserId: number }): Promise<IntroductionOverviewPayload | null> {
    // Aggregate in PostgreSQL; only three authors and three unseen cards cross into presentation.
    const [summary] = await this.prisma.$queryRaw<Array<{ count: bigint; unseen_count: bigint; author_count: bigint; author_ids: number[]; unseen_ids: number[] }>>`
      WITH visible AS MATERIALIZED (
        SELECT i.id, i.created_by_id, i.created_at,
          EXISTS (SELECT 1 FROM introduction_recipients r WHERE r.introduction_id = i.id AND r.user_id = ${params.viewerUserId} AND r.seen_at IS NULL) AS unseen
        FROM introductions i
        WHERE i.room_id = ${params.roomId} AND i.retracted_at IS NULL
          AND EXISTS (SELECT 1 FROM introduction_recipients r WHERE r.introduction_id = i.id AND r.user_id = ${params.viewedUserId})
          AND EXISTS (SELECT 1 FROM introduction_recipients r WHERE r.introduction_id = i.id AND r.user_id <> ${params.viewedUserId})
          AND (i.created_by_id = ${params.viewerUserId} OR EXISTS (
            SELECT 1 FROM introduction_recipients r WHERE r.introduction_id = i.id AND r.user_id = ${params.viewerUserId} AND r.hidden_at IS NULL
          ))
      ), authors AS (
        SELECT DISTINCT ON (created_by_id) id, created_at, created_by_id
        FROM visible ORDER BY created_by_id, created_at DESC, id DESC
      )
      SELECT count(*) AS count, count(*) FILTER (WHERE unseen) AS unseen_count,
        count(DISTINCT created_by_id) AS author_count,
        ARRAY(SELECT id FROM authors ORDER BY created_at DESC, id DESC LIMIT 3) AS author_ids,
        ARRAY(SELECT id FROM visible WHERE unseen ORDER BY created_at DESC, id DESC LIMIT 3) AS unseen_ids
      FROM visible
    `
    if (!summary || !Number(summary.count)) return null
    const ids = [...new Set([...summary.author_ids, ...summary.unseen_ids])]
    const rows = await this.prisma.introduction.findMany({
      where: { id: { in: ids }, room_id: params.roomId, retracted_at: null,
        recipients: { some: { user_id: params.viewedUserId } },
        OR: [{ created_by_id: params.viewerUserId }, { recipients: { some: { user_id: params.viewerUserId, hidden_at: null } } }],
      },
      include: { created_by: true, recipients: { include: { user: true } } },
    })
    const cards = new Map((await this.serializeSummaries(rows, params)).map(card => [Number(card.id), card]))
    const authors = summary.author_ids.flatMap(id => cards.get(id) ? [cards.get(id)!.createdBy] : [])
    return {
      count: Number(summary.count), unseenCount: Number(summary.unseen_count), authors,
      remainingAuthorCount: Math.max(Number(summary.author_count) - authors.length, 0),
      unseenIntroductions: summary.unseen_ids.flatMap(id => cards.get(id) ? [cards.get(id)!] : []),
    }
  }

  private async serializeSummaries(
    introductions: IntroductionForSummary[],
    params: { roomId: number; viewedUserId: number; viewedSquareId?: number; viewerUserId: number },
  ): Promise<IntroductionSummaryPayload[]> {
    if (introductions.length === 0) return []

    const userIds = uniqueNumericIds([
      ...introductions.map((introduction) => introduction.created_by_id),
      ...introductions.flatMap((introduction) => introduction.recipients.map((recipient) => recipient.user_id)),
    ])
    const memberships = await this.prisma.roomMembership.findMany({
      where: { room_id: params.roomId, user_id: { in: userIds }, disabled: false },
      include: { user: true },
    })
    const [membershipAvatars, userAvatars] = await Promise.all([
      identityImageUrls(
        this.prisma,
        "CircleMembership",
        memberships.map((membership) => membership.id),
      ),
      identityImageUrls(this.prisma, "User", userIds),
    ])

    const membershipByUserId = new Map(memberships.map((membership) => [Number(membership.user_id), membership]))
    const participantFor = (user: { id: number; username: string }): IntroductionParticipantPayload => {
      const membership = membershipByUserId.get(Number(user.id))
      return {
        id: String(user.id),
        displayUsername: membership?.username_override || user.username || "Someone",
        avatarUrl: membership
          ? membershipAvatars.get(Number(membership.id)) ?? userAvatars.get(Number(user.id)) ?? null
          : userAvatars.get(Number(user.id)) ?? null,
        squareId: null, // Compatibility only; participants are Room/member identities.
      }
    }

    return introductions.flatMap((introduction) => {
      const participants = introduction.recipients.map((recipient) => participantFor(recipient.user))
      const viewedParticipant = participants.find((participant) => participant.id === String(params.viewedUserId))
      if (!viewedParticipant) return []
      const otherParticipant = participants.find((participant) => participant.id !== viewedParticipant.id)
      if (!otherParticipant) return []

      const viewerRecipient = introduction.recipients.find(
        (recipient) => Number(recipient.user_id) === params.viewerUserId,
      )
      const viewerIsRecipient = Boolean(viewerRecipient)

      return {
        id: String(introduction.id),
        note: introduction.note,
        createdAt: introduction.created_at.toISOString(),
        entryId: introduction.entry_id ? String(introduction.entry_id) : null,
        throughPost: Boolean(introduction.entry_id),
        viewerIsRecipient,
        viewerSeenAt: viewerRecipient?.seen_at?.toISOString() ?? null,
        canHide: Boolean(viewerRecipient && !viewerRecipient.hidden_at),
        canRetract: Number(introduction.created_by_id) === params.viewerUserId,
        createdBy: participantFor(introduction.created_by),
        participants,
        otherUser: otherParticipant,
      }
    })
  }

  private async enqueueRecipientNotices(transaction: Prisma.TransactionClient, {
    actorUserId,
    roomId: communityId,
    introductionId,
    note,
    entryId: postId,
    recipientUserIds,
    recipientMemberships,
  }: {
    actorUserId: number
    roomId: number
    introductionId: number
    note: string
    entryId: number | null
    recipientUserIds: number[]
    recipientMemberships: Array<{ user_id: number; username_override: string | null; user: { username: string } }>
  }) {
    const membershipByUserId = new Map(recipientMemberships.map((membership) => [Number(membership.user_id), membership]))
    for (const recipientUserId of recipientUserIds) {
      const otherRecipientUserId = recipientUserIds.find((id) => id !== recipientUserId)
      if (!otherRecipientUserId) continue

      const otherMembership = membershipByUserId.get(otherRecipientUserId)
      const targetPath = `/app/rooms/${communityId}/members/${otherRecipientUserId}/introductions?introduction=${introductionId}`
      const payload = {
        introductionId: String(introductionId),
        otherRecipientUserId: String(otherRecipientUserId),
        otherRecipientName: otherMembership?.username_override || otherMembership?.user.username || "someone",
        note,
        entryId: postId ? String(postId) : null,
        throughPost: Boolean(postId),
      }

      const event = await transaction.notificationEvent.create({
        data: {
          event_type: "introduction_created",
          actor_id: actorUserId,
          room_id: communityId,
          entry_id: postId,
          target_user_id: recipientUserId,
          payload,
          target_path: targetPath,
          created_at: new Date(),
          updated_at: new Date(),
        },
        include: { actor: true, room: true },
      })

      await this.boss.enqueueInTransaction(transaction, "notifications.fanout", { eventId: event.id })
    }
  }
}

function uniqueNumericIds(value: unknown): number[] {
  const values = Array.isArray(value) ? value : []
  return Array.from(
    new Set(
      values
        .map((entry) => numericId(entry))
        .filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry > 0),
    ),
  )
}

function numericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
