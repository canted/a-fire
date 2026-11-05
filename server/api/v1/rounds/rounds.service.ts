import { entryBody } from "../entries/post-content"
import { completedFeedbackUsers } from "./completed-feedback-users"
import { readParticipationPreviews } from "../entries/participation-previews"
import { readRoomCoverPreviews } from "./room-cover-previews"
import { readRoomParticipation } from "./room-participation"
import { readRoomHistory } from "./room-history"
import { notifyRoomChanged } from "../../../realtime/room-change"
import { isDeepStrictEqual } from "node:util"
import { roomFeedbackSettings } from "../rooms/room-feedback-settings"
import { canReadRoundStatus } from "./round-visibility"
import { hasLimitedRoomHistory } from "../rooms/room-door-policy"
import { sharedEntryPresentation } from "../entries/shared-entry-presentation"
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import type { Prisma, ActivityParticipation } from "@prisma/client"
import { syncRoundChat } from "./round-chat"
import { lockRound, publishRoundWall } from "./publish-round-wall"
import { activityScope, roomRoundScope } from "./round-scope"
import { RoomAccessService, type RoomAccessKind } from "../rooms/room-access.service"
import {
  parseEntryFeedbackRequest,
  feedbackRequestFromDefaults,
  serializeEntryFeedbackRequest,
  type FeedbackRequestPayload,
} from "../feedback-settings"
import { parseEntryFormat, parseEntryFormatData } from "../entries/entry-formats"
import { serializeStoredEntrySubject } from "../entries/entry-subjects"
import { postFormatDataVariantUrls, tiptapImageVariantUrls, uploadVariantUrl } from "../uploads/upload-urls"
import { RoundNotificationsService } from "./round-notifications.service"
import { RoundLifecycleService } from "./round-lifecycle.service"
import {
  ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS,
  activityTemplateDefinition,
} from "./runtime/round-template.definition"
import { RoundRuntime } from "./runtime/round-runtime.registry"
import type {
  RoundArtifactInput,
  RoundChoiceInput,
  RoundRemovalInput,
} from "./runtime/round-runtime.types"
import type {
  RoundDetailPayload,
  RoundFeedbackRequestInput,
  RoundInput,
  RoundNotificationJob,
  RoundParticipantPayload,
  RoundParticipationInput,
  RoundPhase,
  RoundRole,
  RoundStatus,
  RoundSummaryPayload,
  RoundViewerStatePayload,
} from "./rounds.types"
import { ACTIVITY_ROLES, ACTIVITY_STATUSES } from "./rounds.types"

export { ACTIVITY_ROLES, ACTIVITY_STATUSES } from "./rounds.types"

export type {
  RoundDetailPayload,
  RoundInput,
  RoundNotificationJob,
  RoundNotificationMilestone,
  RoundParticipantPayload,
  RoundParticipationInput,
  RoundSubmissionPayload,
  RoundSummaryPayload,
  RoundViewerStatePayload,
} from "./rounds.types"



type ViewerRound = {
  id: number
  status: string
  template_key?: string | null
  submit_by?: Date | null
  feedback_due_at?: Date | null
}
type ViewerParticipation = Pick<ActivityParticipation, "role" | "status" | "submitted_entry_id">

@Injectable()
export class RoundsService {
  @Inject(RoundRuntime)
  private readonly rounds!: RoundRuntime

  @Inject(RoundNotificationsService)
  private readonly notifications!: RoundNotificationsService

  @Inject(RoundLifecycleService)
  private readonly activityLifecycle!: RoundLifecycleService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService


  async overviewForRoom(roomId: number, userId: number) {
    await this.circleAccess.require(roomId, userId)
    await this.activityLifecycle.reconcileCircle(roomId)
    return this.prisma.$transaction(async tx => {
      const access = await this.circleAccess.requireAccessInTransaction(tx, roomId, userId)
      const member = access.kind === "member", limited = hasLimitedRoomHistory(access)
      const scope = roomRoundScope(roomId)
      const [current, draft, history, participation] = await Promise.all([
        tx.round.findMany({ where: { ...scope, status: "active" }, orderBy: [{ started_at: "desc" }, { id: "desc" }] }),
        member ? tx.round.findFirst({ where: { ...scope, status: "draft" }, orderBy: [{ created_at: "desc" }, { id: "desc" }] }) : null,
        limited ? null : readRoomHistory(tx, roomId, { limit: 3 }),
        member ? readRoomParticipation(tx, roomId, userId, { limit: 3 }) : null,
      ])
      const covers = member ? await readRoomCoverPreviews(tx, roomId, userId, [
        ...(history?.items.flatMap(item => item.roundId ? [Number(item.roundId)] : []) ?? []),
        ...(participation?.items.map(item => Number(item.round.id)) ?? []),
      ]) : new Map()
      const previews = member ? await readParticipationPreviews(tx, roomId, userId, participation?.items.map(item => item.contribution) ?? []) : new Map()
      const states = member ? await this.viewerStates([...current, ...(draft ? [draft] : [])], userId, tx) : new Map<number, RoundViewerStatePayload>()
      const summary = async (activity: typeof current[number]) => ({
        ...await this.serializeActivitySummary(activity, userId, states.get(activity.id), access.kind, limited),
        roomId: String(roomId),
      })
      const currentRounds = await Promise.all(current.map(summary))
      return {
        roomId: String(roomId), currentRounds: currentRounds, activeRound: currentRounds[0] ?? null,
        nextRound: draft ? await summary(draft) : null, recentRounds: [],
        roomHistory: (history?.items ?? []).map(item => ({ ...item, cover: covers.get(Number(item.roundId)) ?? null })),
        participationPreview: (participation?.items ?? []).map(item => ({ ...item, contribution: { ...item.contribution, preview: previews.get(Number(item.contribution.entryId)) ?? null }, round: { ...item.round, cover: covers.get(Number(item.round.id)) ?? null } })),
        viewerAccess: { kind: access.kind, canParticipate: member, scope: limited ? "active_published_only" : "all" },
      }
    })
  }

  async participationForRoom(roomId: number, userId: number, options: { cursor?: string; limit?: number } = {}) {
    return this.prisma.$transaction(async tx => {
      const access = await this.circleAccess.requireAccessInTransaction(tx, roomId, userId)
      if (access.kind !== "member") throw new ForbiddenException("Members only")
      const page = await readRoomParticipation(tx, roomId, userId, options)
      const covers = await readRoomCoverPreviews(tx, roomId, userId, page.items.map(item => Number(item.round.id)))
      const previews = await readParticipationPreviews(tx, roomId, userId, page.items.map(item => item.contribution))
      return { ...page, items: page.items.map(item => ({ ...item, contribution: { ...item.contribution, preview: previews.get(Number(item.contribution.entryId)) ?? null }, round: { ...item.round, cover: covers.get(Number(item.round.id)) ?? null } })) }
    })
  }

  async historyForRoom(roomId: number, userId: number, options: { cursor?: string; limit?: number } = {}) {
    return this.prisma.$transaction(async tx => {
      const access = await this.circleAccess.requireAccessInTransaction(tx, roomId, userId)
      if (hasLimitedRoomHistory(access)) throw new ForbiddenException("Room history is unavailable during this visit")
      const page = await readRoomHistory(tx, roomId, options)
      const covers = access.kind === "member" ? await readRoomCoverPreviews(tx, roomId, userId, page.items.flatMap(item => item.roundId ? [Number(item.roundId)] : [])) : new Map()
      return { ...page, items: page.items.map(item => ({ ...item, cover: covers.get(Number(item.roundId)) ?? null })) }
    })
  }

  async listForRoom(roomId: number, userId: number) {
    const access = await this.circleAccess.require(roomId, userId)
    await this.activityLifecycle.reconcileCircle(roomId)
    return this.listForScope({ where: roomRoundScope(roomId), roomId, viewerAccessKind: access.kind, limitedHistory: hasLimitedRoomHistory(access) }, userId)
  }

  private async listForScope(scope: { where: Prisma.RoundWhereInput; roomId: number | null; viewerAccessKind: RoomAccessKind; limitedHistory: boolean }, userId: number) {
    if (scope.viewerAccessKind === "visitor") {
      const activities = await this.prisma.round.findMany({
        where: { ...scope.where, status: "active" },
        orderBy: { started_at: "desc" },
      })
      const currentRounds = await Promise.all(activities.map(async activity => ({ ...await this.serializeActivitySummary(activity, userId, undefined, "visitor", scope.limitedHistory), ...(scope.roomId ? { roomId: String(scope.roomId) } : {}) })))
      const recent = scope.limitedHistory ? [] : await this.prisma.round.findMany({
        where: { ...scope.where, status: "archived" },
        orderBy: [{ closed_at: "desc" }, { id: "desc" }], take: 20,
      })
      const recentRounds = await Promise.all(recent.map(activity => this.serializeActivitySummary(activity, userId, undefined, "visitor", false)))
      return {
        currentRounds: currentRounds,
        activeRound: currentRounds[0] ?? null,
        nextRound: null,
        recentRounds: recentRounds,
        viewerAccess: { kind: "visitor", canParticipate: false, scope: scope.limitedHistory ? "active_published_only" : "all" },
      }
    }
    const [activeActivity, draftActivity, recentRounds] = await Promise.all([
      this.prisma.round.findFirst({
        where: { ...scope.where, status: "active" },
        orderBy: { started_at: "desc" },
      }),
      this.prisma.round.findFirst({
        where: { ...scope.where, status: "draft" },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.round.findMany({
        where: { ...scope.where, status: { in: ["archived", "cancelled"] } },
        orderBy: [{ closed_at: "desc" }, { updated_at: "desc" }],
      }),
    ])

    const currentRounds = await this.prisma.round.findMany({
      where: { ...scope.where, status: "active" }, orderBy: { started_at: "desc" },
    })
    const memberships = scope.roomId ? await this.prisma.roomMembership.findMany({
      where: { room_id: scope.roomId, disabled: false, revoked_at: null },
      select: { id: true, created_at: true, username_override: true, user: { select: { username: true } } },
      orderBy: { created_at: "desc" },
    }) : []
    const activityIds = [...new Set([...currentRounds, activeActivity, draftActivity, ...recentRounds].filter((activity) => activity !== null).map((activity) => activity.id))]
    const posts = activityIds.length ? await this.prisma.entry.findMany({
      where: { round_id: { in: activityIds }, status: "published", OR: [{ user_id: userId }, { replies: { some: { user_id: userId, status: "published" } } }] },
      select: { id: true, published_at: true, round_id: true, user_id: true, replies: { where: { user_id: userId, status: "published" }, select: { id: true, published_at: true } }, _count: { select: { replies: { where: { status: "published" } } } } },
      orderBy: [{ published_at: "desc" }, { id: "desc" }],
    }) : []
    const choices = activityIds.length ? await this.prisma.activityOffer.findMany({
      where: { round_id: { in: activityIds }, user_id: userId, chosen_artifact_id: { not: null } },
      select: { round_id: true, updated_at: true, chosen_artifact: { select: { entry_id: true, status: true } } },
    }) : []
    const contributions = new Map<number, NonNullable<RoundSummaryPayload["viewerContributions"]>>()
    const forRound = (id: number) => {
      let items = contributions.get(id)
      if (!items) { items = []; contributions.set(id, items) }
      return items
    }
    // Index once: serializing each Round must not rescan the whole Room's history.
    for (const post of posts) {
      if (post.round_id === null) continue
      const items = forRound(post.round_id)
      if (post.user_id === userId) items.push({ entryId: String(post.id), kind: "submission", replyCount: post._count.replies, occurredAt: post.published_at?.toISOString(), label: "Your shared work" })
      for (const reply of post.replies) items.push({ entryId: String(post.id), kind: "reply", replyId: String(reply.id), occurredAt: reply.published_at?.toISOString(), label: "Your feedback" })
    }
    for (const choice of choices) {
      if (choice.chosen_artifact?.status === "active") forRound(choice.round_id).push({ entryId: String(choice.chosen_artifact.entry_id), kind: "choice", occurredAt: choice.updated_at.toISOString(), label: "Your cover choice" })
    }
    const listed = [...currentRounds, activeActivity, draftActivity, ...recentRounds].filter((activity) => activity !== null)
    const viewerStates = await this.viewerStates(listed, userId)
    const summary = async (activity: NonNullable<typeof activeActivity>) => ({
      ...await this.serializeActivitySummary(activity, userId, viewerStates.get(activity.id)),
      // Every activity in this scope belongs explicitly to the authorized Room.
      ...(scope.roomId ? { roomId: String(scope.roomId) } : {}),
      viewerContributions: contributions.get(activity.id) ?? [],
    })
    return {
      currentRounds: await Promise.all(currentRounds.map(summary)),
      roomHistory: [
        ...memberships.map(member => ({ id: `member:${member.id}`, label: `${member.username_override || member.user.username} joined the circle`, occurredAt: member.created_at.toISOString() })),
        ...recentRounds.filter(activity => activity.status === "archived").map(activity => ({ id: `activity:${activity.id}`, label: `${activity.name} completed`, occurredAt: (activity.closed_at || activity.updated_at).toISOString(), roundId: String(activity.id) })),
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      activeRound: activeActivity ? await summary(activeActivity) : null,
      nextRound: draftActivity ? await summary(draftActivity) : null,
      recentRounds: await Promise.all(recentRounds.map(summary)),
      viewerAccess: { kind: "member", canParticipate: true, scope: "all" },
    }
  }

  async createForRoom(roomId: number, userId: number, input: RoundInput) {
    const access = await this.circleAccess.requireManager(roomId, userId)
    return this.createInScope({ room_id: roomId, name: access.room.name }, userId, input)
  }

  private async createInScope(room: { room_id: number | null; name: string | null }, userId: number, input: RoundInput) {
    const status = this.cleanStatus(input.status) === "draft" ? "draft" : "active"
    await this.reconcileScope(room)

    const now = new Date()
    const template = activityTemplateDefinition(input.template_key ?? input.templateKey ?? input.activity_key ?? input.activityKey)
    if (status === "active") await this.assertActivityHasEnoughMembers(template, room.room_id)
    const templateConfig = template.normalizeConfig(input.template_config ?? input.templateConfig ?? input.activity_config ?? input.activityConfig)
    const submitBy = this.parseDate(input.submit_by ?? input.submitBy)
    const feedbackDueAt = this.parseDate(input.feedback_due_at ?? input.feedbackDueAt)
    this.validateActivityDates(template.key, submitBy, feedbackDueAt)
    const feedback = await this.feedbackRequestForInput(input, room.room_id)
    const activity = await this.prisma.$transaction(async tx => {
      await this.requireRoomManagementInTransaction(tx, room, userId)
      if (status === "active") await this.assertActivityHasEnoughMembers(template, room.room_id, tx)
      await this.assertNoConflictingActivity(tx, room, status)
      const created = await tx.round.create({
      data: {
        room_id: room.room_id,
        host_id: userId,
        name: this.cleanName(input.name, room.name ?? "Room"),
        prompt: this.cleanOptionalText(input.prompt),
        status,
        reply_mode: feedback.reply_mode,
        requested_feedback_types: feedback.reply_mode === "guided" ? feedback.requested_feedback_types : [],
        idea_guidance: feedback.reply_mode === "guided" ? feedback.idea_guidance : null,
        template_key: template.key,
        template_version: template.version,
        template_config: templateConfig,
        started_at: status === "active" ? now : null,
        submit_by: submitBy,
        feedback_due_at: feedbackDueAt,
        closed_at: null,
        created_at: now,
        updated_at: now,
      },
      })
      await this.notifications.scheduleActivityNotifications(created, tx)
      await this.rounds.syncChat(created.id, tx)
      if (room.room_id) await notifyRoomChanged(tx, room.room_id)
      return created
    })

    return this.serializeActivitySummary(activity, userId)
  }

  async show(activityId: number, userId: number): Promise<RoundDetailPayload> {
    let activity = await this.findActivity(activityId)
    const roomAccess = await this.assertRoomAccess(activity.room_id, userId)
    const visitor = roomAccess.viewerAccessKind === "visitor"
    if (!canReadRoundStatus(activity.status, roomAccess.viewerAccessKind, roomAccess.limitedHistory)) throw new ForbiddenException("Forbidden")
    if (await this.activityLifecycle.reconcileActivity(activity.id)) {
      activity = await this.findActivity(activityId)
      if (!canReadRoundStatus(activity.status, roomAccess.viewerAccessKind, roomAccess.limitedHistory)) throw new ForbiddenException("Forbidden")
    }
    if (activity.template_key === "art_before_chorus") {
      await this.rounds.prepareForDetail(activity, userId, roomAccess.viewerAccessKind)
      activity = await this.findActivity(activityId)
      if (!canReadRoundStatus(activity.status, roomAccess.viewerAccessKind, roomAccess.limitedHistory)) throw new ForbiddenException("Forbidden")
    }

    const participations = await this.prisma.activityParticipation.findMany({
      where: { round_id: activity.id },
      include: { user: true },
      orderBy: [{ joined_at: "asc" }, { id: "asc" }],
    })
    const submittedEntryIds = participations
      .map((participation) => Number(participation.submitted_entry_id ?? 0))
      .filter((id) => id > 0)
    const [submittedPosts, submissionRecords, [replyTotals, viewerReplies], memberPreviews] = await Promise.all([
      submittedEntryIds.length
        ? this.prisma.entry.findMany({
            where: { id: { in: submittedEntryIds }, status: "published", project_id: null },
            include: { subject: true },
          })
        : [],
      submittedEntryIds.length
        ? this.prisma.activitySubmission.findMany({
            where: { round_id: activity.id, entry_id: { in: submittedEntryIds }, superseded_at: null },
            select: { entry_id: true, submitted_at: true },
          })
        : [],
      submittedEntryIds.length
        ? Promise.all([
            this.prisma.reply.groupBy({
              by: ["entry_id"], where: { entry_id: { in: submittedEntryIds }, status: "published" },
              _count: { _all: true },
            }),
            visitor ? Promise.resolve([]) : this.prisma.reply.groupBy({
              by: ["entry_id"], where: { entry_id: { in: submittedEntryIds }, status: "published", user_id: userId },
            }),
          ])
        : [[], []],
      this.memberPreviewMap(
        activity.room_id ? Number(activity.room_id ?? 0) : null,
        participations.map((participation) => Number(participation.user_id ?? 0)),
      ),
    ])
    const documents = submittedEntryIds.length
      ? await this.prisma.document.findMany({
          where: { docable_type: "Post", docable_id: { in: submittedEntryIds } },
          select: { docable_id: true, content: true },
        })
      : []
    const visitorVisibleEntryIds = new Set(
      visitor
        ? (
            await Promise.all(
              submittedPosts.map(async (post) => {
                return roomAccess.roomAccess && await this.circleAccess.canReadPublishedPostWithRoomHistory(post, roomAccess.roomAccess) ? post.id : 0
              }),
            )
          ).filter((postId) => postId > 0)
        : submittedPosts.map((post) => Number(post.id ?? 0)),
    )
    const submittedEntryMap = new Map(
      submittedPosts
        .filter((post) => visitorVisibleEntryIds.has(Number(post.id ?? 0)))
        .map((post) => [Number(post.id ?? 0), post] as const),
    )
    const submittedAtMap = new Map(
      submissionRecords.map((record) => [Number(record.entry_id ?? 0), record.submitted_at] as const),
    )
    const documentMap = new Map(documents.map((document) => [Number(document.docable_id ?? 0), document.content] as const))
    const visibleReplyTotals = replyTotals.filter(reply => visitorVisibleEntryIds.has(Number(reply.entry_id ?? 0)))
    const replyCounts = new Map(visibleReplyTotals.map(reply => [Number(reply.entry_id), reply._count._all]))

    const participantPayloads = participations.map((participation) =>
      this.serializeParticipation(participation, memberPreviews.get(Number(participation.user_id ?? 0))),
    )
    const phase = this.activityPhase(activity)
    const submissions = participations
      .filter(
        (participation) =>
          participation.status === "active" &&
          Number(participation.submitted_entry_id ?? 0) > 0 &&
          visitorVisibleEntryIds.has(Number(participation.submitted_entry_id ?? 0)),
      )
      .map((participation) => {
        const postId = Number(participation.submitted_entry_id ?? 0)
        const post = submittedEntryMap.get(postId)
        return {
          ...(post ? sharedEntryPresentation(post) : {}),
          id: String(participation.id),
          entryId: String(postId),
          userId: String(participation.user_id),
          displayUsername: this.displayUsername(participation),
          avatarUrl: memberPreviews.get(Number(participation.user_id ?? 0))?.avatarUrl ?? null,
          submittedAt: (submittedAtMap.get(postId) ?? post?.published_at ?? post?.created_at ?? new Date(0)).toISOString(),
          publishedAt: (post?.published_at ?? post?.created_at)?.toISOString() ?? null,
          replyCount: replyCounts.get(postId) ?? 0,
          content: tiptapImageVariantUrls(
            entryBody(documentMap.get(postId)),
            "w600",
          ),
          format: parseEntryFormat(post?.format),
          formatData: postFormatDataVariantUrls(parseEntryFormatData(post?.format_data), "w600"),
          subject: serializeStoredEntrySubject(post?.subject),
        }
      })
      .sort((a, b) => {
        if (phase === "feedback") {
          const feedbackOrder = Number(a.replyCount > 0) - Number(b.replyCount > 0)
          if (feedbackOrder !== 0) return feedbackOrder
        }
        return Date.parse(a.submittedAt) - Date.parse(b.submittedAt)
      })

    const viewerState = visitor ? this.visitorViewerState() : await this.viewerState(activity, userId)
    const activityState = activity.template_key === "art_before_chorus" && !roomAccess.limitedHistory
      ? await this.rounds.detail(activity, userId, roomAccess.viewerAccessKind)
      : undefined
    const viewerFeedbackEntryIds = new Set(
      viewerReplies
        .filter(reply => visitorVisibleEntryIds.has(Number(reply.entry_id ?? 0)))
        .map((reply) => Number(reply.entry_id ?? 0)),
    )
    return {
      viewerUserId: String(userId),
      round: await this.serializeActivitySummary(activity, userId, viewerState, roomAccess.viewerAccessKind, roomAccess.limitedHistory),
      phase,
      viewerState,
      participants: visitor ? [] : participantPayloads.filter((participation) => participation.role === "participant"),
      reviewers: visitor ? [] : participantPayloads.filter((participation) => participation.role === "reviewer"),
      followers: visitor ? [] : participantPayloads.filter((participation) => participation.role === "follower"),
      submissions,
      feedbackSummary: {
        submittedCount: submissions.length,
        reviewedCount: submissions.filter((submission) => submission.replyCount > 0).length,
        replyCount: visibleReplyTotals.reduce((total, reply) => total + reply._count._all, 0),
      },
      feedbackProgress: {
        givenCount: visitor ? 0 : viewerFeedbackEntryIds.size,
        totalCount: visitor ? 0 : submissions.length,
      },
      viewerAccess: {
        kind: roomAccess.viewerAccessKind,
        canParticipate: !visitor,
        scope: roomAccess.limitedHistory ? "active_published_only" : "all",
      },
      ...(activityState ? { roundState: activityState } : {}),
    }
  }

  async update(activityId: number, userId: number, input: RoundInput) {
    let activity = await this.findActivity(activityId)
    const room = await this.assertRoomManage(activity.room_id, userId)
    if (await this.activityLifecycle.reconcileActivity(activity.id)) activity = await this.findActivity(activityId)
    if (!["draft", "active"].includes(activity.status) || (activity.status === "active" && this.activityPhase(activity) === "complete")) {
      throw new BadRequestException("Completed Activities cannot be edited")
    }
    const feedback = await this.feedbackRequestForInput(input, room.room_id, activity)
    const template = activityTemplateDefinition(activity.template_key)
    const templateConfig =
      input.template_config !== undefined || input.templateConfig !== undefined || input.activity_config !== undefined || input.activityConfig !== undefined
        ? template.normalizeConfig(input.template_config ?? input.templateConfig ?? input.activity_config ?? input.activityConfig)
        : template.normalizeConfig(activity.template_config)
    const submitBy = input.submit_by !== undefined || input.submitBy !== undefined
      ? this.parseDate(input.submit_by ?? input.submitBy)
      : activity.submit_by
    const feedbackDueAt = input.feedback_due_at !== undefined || input.feedbackDueAt !== undefined
      ? this.parseDate(input.feedback_due_at ?? input.feedbackDueAt)
      : activity.feedback_due_at
    this.validateActivityDates(template.key, submitBy, feedbackDueAt)
    const updated = await this.prisma.$transaction(async tx => {
      await this.requireRoomManagementInTransaction(tx, room, userId)
      await lockRound(tx, activity.id)
      const current = await tx.round.findUnique({ where: { id: activity.id } })
      if (!current || !isDeepStrictEqual(current, activity)) throw new ConflictException("This Round changed. Review it before editing.")
      if (current.status === "active" && this.activityPhase(current) === "complete") throw new BadRequestException("Completed Activities cannot be edited")
      const updated = await tx.round.update({
      where: { id: activity.id },
      data: {
        ...(input.name !== undefined ? { name: this.cleanName(input.name, room.name ?? "Room") } : {}),
        ...(input.prompt !== undefined ? { prompt: this.cleanOptionalText(input.prompt) } : {}),
        ...(input.submit_by !== undefined || input.submitBy !== undefined ? { submit_by: submitBy } : {}),
        ...(input.feedback_due_at !== undefined || input.feedbackDueAt !== undefined
          ? { feedback_due_at: feedbackDueAt }
          : {}),
        reply_mode: feedback.reply_mode,
        requested_feedback_types: feedback.reply_mode === "guided" ? feedback.requested_feedback_types : [],
        idea_guidance: feedback.reply_mode === "guided" ? feedback.idea_guidance : null,
        template_config: templateConfig,
        updated_at: new Date(),
      },
    })
      await this.notifications.scheduleActivityNotifications(updated, tx)
      await this.rounds.syncChat(updated.id, tx)
      if (room.room_id) await notifyRoomChanged(tx, room.room_id)
      return updated
    })
    return this.serializeActivitySummary(updated, userId)
  }

  async start(activityId: number, userId: number) {
    let activity = await this.findActivity(activityId)
    const room = await this.assertRoomManage(activity.room_id, userId)
    if (await this.activityLifecycle.reconcileActivity(activity.id)) activity = await this.findActivity(activityId)
    if (activity.status === "active") {
      await this.notifications.scheduleActivityNotifications(activity)
      return this.serializeActivitySummary(activity, userId)
    }
    if (activity.status !== "draft") throw new BadRequestException("Completed Activities cannot be restarted")
    await this.reconcileScope(room)
    await this.assertActivityHasEnoughMembers(activityTemplateDefinition(activity.template_key), room.room_id)
    const updated = await this.prisma.$transaction(async tx => {
      await this.requireRoomManagementInTransaction(tx, room, userId)
      await lockRound(tx, activity.id)
      const current = await tx.round.findUnique({ where: { id: activity.id } })
      if (!current || !isDeepStrictEqual(current, activity)) throw new ConflictException("This Round changed. Review it before starting.")
      await this.assertActivityHasEnoughMembers(activityTemplateDefinition(current.template_key), room.room_id, tx)
      await this.assertNoConflictingActivity(tx, room, "active")
      const updated = await tx.round.update({
      where: { id: activity.id },
      data: { status: "active", started_at: new Date(), updated_at: new Date() },
      })
      await this.notifications.scheduleActivityNotifications(updated, tx)
      await this.rounds.syncChat(updated.id, tx)
      if (room.room_id) await notifyRoomChanged(tx, room.room_id)
      return updated
    })
    return this.serializeActivitySummary(updated, userId)
  }

  async archive(activityId: number, userId: number) {
    const activity = await this.findActivity(activityId)
    const room = await this.assertRoomManage(activity.room_id, userId)
    if (activity.template_key === "art_before_chorus") {
      await this.rounds.complete(activity.id, activity.template_key, true, async tx => {
        await this.requireRoomManagementInTransaction(tx, room, userId)
        await lockRound(tx, activity.id)
        const current = await tx.round.findUniqueOrThrow({ where: { id: activity.id } })
        if (current.room_id !== activity.room_id || current.template_key !== activity.template_key) throw new ConflictException("This Round changed. Review it before ending.")
      })
      return this.serializeActivitySummary(await this.findActivity(activity.id), userId)
    }
    const updated = await this.prisma.$transaction(async tx => {
      await this.requireRoomManagementInTransaction(tx, room, userId)
      await lockRound(tx, activity.id)
      const current = await tx.round.findUniqueOrThrow({ where: { id: activity.id } })
      if (current.room_id !== activity.room_id || current.template_key !== activity.template_key) throw new ConflictException("This Round changed. Review it before ending.")
      if (current.status === "archived" || current.status === "cancelled") return current
      const completed = await tx.round.update({
        where: { id: activity.id },
        data: { status: current.status === "draft" ? "cancelled" : "archived", closed_at: new Date(), updated_at: new Date() },
      })
      await publishRoundWall(tx, activity.id)
      await syncRoundChat(tx, activity.id)
      if (completed.status === "cancelled" && room.room_id) await notifyRoomChanged(tx, room.room_id)
      return completed
    })
    return this.serializeActivitySummary(updated, userId)
  }

  async remindParticipantToSubmit(activityId: number, targetUserId: number, userId: number) {
    const activity = await this.findActivity(activityId)
    await this.assertRoomManage(activity.room_id, userId)
    const phase = this.activityPhase(activity)
    if (activity.template_key !== "art_before_chorus" && phase !== "submission") {
      throw new BadRequestException("Submission reminders are only available during the submission phase")
    }
    if (phase !== "submission" && phase !== "feedback") {
      throw new BadRequestException("Reminders are not available in this Activity phase")
    }

    const participation = await this.prisma.activityParticipation.findUnique({
      where: {
        round_id_user_id: {
          round_id: activity.id,
          user_id: Number(targetUserId ?? 0),
        },
      },
    })
    if (
      !participation ||
      participation.status !== "active" ||
      participation.role !== "participant" ||
      (activity.template_key !== "art_before_chorus" && participation.submitted_entry_id)
    ) {
      throw new BadRequestException("This participant does not need a submission reminder")
    }

    if (activity.template_key === "art_before_chorus") {
      const artifact = await this.prisma.activityArtifact.findUnique({
        where: {
          round_id_user_id_kind: {
            round_id: activity.id,
            user_id: Number(targetUserId ?? 0),
            kind: phase === "submission" ? "cover" : "response",
          },
        },
        select: { status: true },
      })
      if (artifact?.status === "active") {
        throw new BadRequestException("This participant has already completed this step")
      }
    }

    await this.notifications.enqueueReminder(activity, userId, Number(targetUserId ?? 0), phase)
    return { sent: 1, phase }
  }

  async remindForCurrentPhase(activityId: number, userId: number) {
    const activity = await this.findActivity(activityId)
    await this.assertRoomManage(activity.room_id, userId)
    const phase = this.activityPhase(activity)
    if (phase !== "submission" && phase !== "feedback") {
      throw new BadRequestException("Reminders are not available in this Activity phase")
    }

    const participations = await this.prisma.activityParticipation.findMany({
      where: {
        round_id: activity.id,
        status: "active",
        role: phase === "submission" ? "participant" : { in: ["participant", "reviewer"] },
      },
      select: {
        user_id: true,
        submitted_entry_id: true,
      },
    })

    let targetUserIds: number[]
    if (activity.template_key === "art_before_chorus") {
      const artifacts = await this.prisma.activityArtifact.findMany({
        where: {
          round_id: activity.id,
          kind: phase === "submission" ? "cover" : "response",
          status: "active",
        },
        select: { user_id: true },
      })
      const completedUserIds = new Set(artifacts.map((artifact) => Number(artifact.user_id)))
      targetUserIds = participations
        .map((participation) => Number(participation.user_id ?? 0))
        .filter((targetId) => !completedUserIds.has(targetId))
    } else if (phase === "submission") {
      targetUserIds = participations
        .filter((participation) => !participation.submitted_entry_id)
        .map((participation) => Number(participation.user_id ?? 0))
    } else {
      const postIds = participations
        .map((participation) => Number(participation.submitted_entry_id ?? 0))
        .filter((postId) => postId > 0)
      const completedUserIds = await completedFeedbackUsers(
        this.prisma, postIds, participations.map(participation => participation.user_id),
      )
      targetUserIds = participations
        .map((participation) => Number(participation.user_id ?? 0))
        .filter((targetId) => !completedUserIds.has(targetId))
    }

    const uniqueTargetUserIds = [...new Set(targetUserIds)].filter((targetId) => targetId !== userId)
    await Promise.all(uniqueTargetUserIds.map((targetId) => this.notifications.enqueueReminder(activity, userId, targetId, phase)))
    return { sent: uniqueTargetUserIds.length, phase }
  }

  async handleScheduledNotification(job: RoundNotificationJob) {
    const result = await this.notifications.handleScheduledNotification(job)
    if (job.milestone === "round_completed") {
      await this.activityLifecycle.reconcileActivity(Number(job.roundId ?? 0))
    }
    return result
  }

  async scheduleActiveActivityNotifications() {
    return this.notifications.scheduleActiveActivityNotifications()
  }

  async updateParticipation(activityId: number, userId: number, input: RoundParticipationInput) {
    const activity = await this.findActivity(activityId)
    const room = await this.assertRoomMember(activity.room_id, userId)
    const role = this.cleanRole(input.role)
    if (activity.template_key === "art_before_chorus" && role !== "participant") {
      throw new BadRequestException("This Activity template has one participant role")
    }
    const roomId = activity.room_id ?? room.room_id
    if (!roomId) throw new ForbiddenException("Round has no Room")

    const now = new Date()
    await this.prisma.$transaction(async tx => {
      await this.circleAccess.requireMemberInTransaction(tx, roomId, userId)
      await lockRound(tx, activity.id)
      const current = await tx.round.findUnique({ where: { id: activity.id } })
      if (!current || !isDeepStrictEqual(current, activity)) throw new ConflictException("This Round changed. Review it before joining.")
      await tx.activityParticipation.upsert({
        where: { round_id_user_id: { round_id: activity.id, user_id: userId } },
        create: {
          round_id: activity.id,
          user_id: userId,
          role,
          status: "active",
          joined_at: now,
          withdrawn_at: null,
          created_at: now,
          updated_at: now,
        },
        update: {
          role,
          status: "active",
          withdrawn_at: null,
          updated_at: now,
        },
      })
      await notifyRoomChanged(tx, roomId)
    })
    return this.show(activity.id, userId)
  }

  async withdrawParticipation(activityId: number, userId: number) {
    const activity = await this.findActivity(activityId)
    const room = await this.assertRoomMember(activity.room_id, userId)
    await this.prisma.$transaction(async tx => {
      const roomId = activity.room_id ?? room.room_id
      if (roomId) await this.circleAccess.requireMemberInTransaction(tx, roomId, userId)
      await lockRound(tx, activity.id)
      const current = await tx.round.findUnique({ where: { id: activity.id } })
      if (!current || !isDeepStrictEqual(current, activity)) throw new ConflictException("This Round changed. Review it before leaving.")
      const existing = await tx.activityParticipation.findUnique({
        where: { round_id_user_id: { round_id: activity.id, user_id: userId } },
      })
      if (!existing || existing.status === "withdrawn") return
      const now = new Date()
      await tx.activityParticipation.update({
        where: { id: existing.id },
        data: { status: "withdrawn", withdrawn_at: now, updated_at: now },
      })
      if (roomId) await notifyRoomChanged(tx, roomId)
    })
    return this.show(activity.id, userId)
  }

  async validateActivitySubmission(
    activityId: number,
    userId: number,
    creationOrigin?: string | null,
    transaction?: Prisma.TransactionClient,
  ) {
    const database = transaction ?? this.prisma
    if (transaction) {
      await lockRound(transaction, activityId)
      await transaction.$queryRaw`SELECT id FROM round_participations WHERE round_id = ${activityId} AND user_id = ${userId} FOR SHARE`
    }
    const activity = await database.round.findUnique({ where: { id: activityId } })
    if (!activity) throw new NotFoundException("Not Found")
    if (activity.template_key === "art_before_chorus") {
      return this.rounds.validateDraft(activity, userId, creationOrigin, transaction)
    }
    if (activity.status !== "active") throw new BadRequestException("Activity is not accepting submissions")
    if (activity.submit_by && activity.submit_by.getTime() < Date.now()) {
      throw new BadRequestException("Activity submissions are closed")
    }

    const roomId = activity.room_id
    if (!roomId) throw new ForbiddenException("Round has no Room")
    const access = transaction
      ? await this.circleAccess.resolve(roomId, userId, new Date(), transaction)
      : await this.circleAccess.requireMember(roomId, userId)
    if (access?.kind !== "member") throw new ForbiddenException("Members only")

    const participation = await database.activityParticipation.findUnique({
      where: { round_id_user_id: { round_id: activity.id, user_id: userId } },
    })
    if (!participation || participation.status !== "active" || participation.role !== "participant") {
      throw new ForbiddenException("Join this activity before submitting")
    }

    return { round: activity, participation }
  }

  async submitRoundArtifact(activityId: number, userId: number, input: RoundArtifactInput) {
    const activity = await this.findActivity(activityId)
    await this.assertRoomMember(activity.room_id, userId)
    const artifact = await this.rounds.submitArtifact(activity, userId, input)
    await this.emitActivityUpdated(activity)
    return artifact
  }

  async chooseActivityOption(activityId: number, userId: number, input: RoundChoiceInput) {
    const activity = await this.findActivity(activityId)
    await this.assertRoomMember(activity.room_id, userId)
    const choice = await this.rounds.choose(activity, userId, input)
    await this.emitActivityUpdated(activity)
    return choice
  }

  async removeRoundArtifact(activityId: number, userId: number, input: RoundRemovalInput) {
    const activity = await this.findActivity(activityId)
    await this.assertRoomManage(activity.room_id, userId)
    const removal = await this.rounds.removeArtifact(activity, userId, input)
    await this.emitActivityUpdated(activity)
    return removal
  }

  async markSubmitted(activityId: number, postId: number, userId: number, transaction?: Prisma.TransactionClient) {
    const normalizedRoundId = Number(activityId ?? 0)
    const normalizedEntryId = Number(postId ?? 0)
    const normalizedUserId = Number(userId ?? 0)

    const submit = async (tx: Prisma.TransactionClient) => {
      await lockRound(tx, normalizedRoundId)
      const current = await tx.round.findUniqueOrThrow({ where: { id: normalizedRoundId } })
      if (current.status !== "active") throw new BadRequestException("This round has completed")
      const existing = await tx.activityParticipation.findUnique({
        where: { round_id_user_id: { round_id: normalizedRoundId, user_id: normalizedUserId } },
        select: { id: true, submitted_entry_id: true },
      })
      if (!existing) throw new ForbiddenException("Join this activity before submitting")

      const previousEntryId = Number(existing.submitted_entry_id ?? 0)
      const now = new Date()
      if (previousEntryId && previousEntryId !== normalizedEntryId) {
        await tx.activitySubmission.updateMany({
          where: {
            round_id: normalizedRoundId,
            user_id: normalizedUserId,
            entry_id: previousEntryId,
            superseded_at: null,
          },
          data: { superseded_at: now, updated_at: now },
        })
        await tx.entry.updateMany({
          where: { id: previousEntryId, round_id: normalizedRoundId },
          data: { round_id: null, updated_at: now },
        })
      }

      if (previousEntryId !== normalizedEntryId) {
        await tx.activitySubmission.create({
          data: {
            round_id: normalizedRoundId,
            activity_participation_id: Number(existing.id ?? 0),
            entry_id: normalizedEntryId,
            user_id: normalizedUserId,
            submitted_at: now,
            created_at: now,
            updated_at: now,
          },
        })
      }

      await tx.activityParticipation.update({
        where: { round_id_user_id: { round_id: normalizedRoundId, user_id: normalizedUserId } },
        data: { submitted_entry_id: normalizedEntryId, updated_at: now },
      })
    }
    if (transaction) await submit(transaction)
    else await this.prisma.$transaction(submit)
  }

  private async emitActivityUpdated(activity: { id: number; room_id: number | null }) {
    if (activity.room_id) await this.prisma.$transaction(tx => notifyRoomChanged(tx, activity.room_id!))
  }

  private async findActivity(activityId: number) {
    const activity = await this.prisma.round.findUnique({ where: { id: Number(activityId ?? 0) } })
    if (!activity) throw new NotFoundException("Not Found")
    return activity
  }

  private async assertRoomAccess(roomId: number | null, userId: number) {
    if (!roomId) throw new ForbiddenException("Round has no Room")
    const access = await this.circleAccess.require(roomId, userId)
    return { room_id: roomId, name: access.room.name, roomAccess: access,
      limitedHistory: hasLimitedRoomHistory(access), viewerAccessKind: access.kind }
  }

  private async assertRoomMember(roomId: number | null, userId: number) {
    const room = await this.assertRoomAccess(roomId, userId)
    if (room.viewerAccessKind !== "member") throw new ForbiddenException("Members only")
    return room
  }

  private async assertRoomManage(roomId: number | null, userId: number) {
    if (!roomId) throw new ForbiddenException("Round has no Room")
    const access = await this.circleAccess.requireManager(roomId, userId)
    return { room_id: roomId, name: access.room.name }
  }

  /** Current Room and membership are locked before Round mutation. */
  private async requireRoomManagementInTransaction(tx: Prisma.TransactionClient, room: { room_id: number | null }, userId: number) {
    if (!room.room_id) throw new ForbiddenException("Round has no Room")
    const access = await this.circleAccess.requireMemberInTransaction(tx, room.room_id, userId)
    if (!access.canManage) throw new ForbiddenException("Room owner only")
  }

  private async reconcileScope(room: { room_id: number | null }) {
    if (room.room_id) await this.activityLifecycle.reconcileCircle(room.room_id)
  }

  private async assertNoConflictingActivity(tx: Prisma.TransactionClient, room: { room_id: number | null }, status: RoundStatus) {
    if (status !== "active" && status !== "draft") return
    if (!room.room_id) throw new ForbiddenException("Round has no Room")
    const key = `activity-circle:${room.room_id}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    const existing = await tx.round.findFirst({
      where: { ...activityScope(room), status },
      select: { id: true },
    })
    if (existing) throw new BadRequestException(`Room already has ${status === "active" ? "an ongoing" : "an upcoming"} round. Use a side room for a parallel round.`)
  }

  private async feedbackRequestForInput(
    input: RoundInput,
    roomId: number | null,
    fallback?: { reply_mode?: string | null; requested_feedback_types?: unknown; idea_guidance?: string | null },
  ): Promise<FeedbackRequestPayload> {
    const explicit = input.feedback_request ?? input.feedbackRequest
    if (explicit || input.reply_mode !== undefined || input.replyMode !== undefined) {
      const request = parseEntryFeedbackRequest((explicit ?? input) as RoundFeedbackRequestInput)
      return {
        reply_mode: request.replyMode,
        requested_feedback_types: request.requestedFeedbackTypes,
        idea_guidance: request.ideaGuidance,
      }
    }

    if (fallback) return serializeEntryFeedbackRequest(fallback)

    const room = await roomFeedbackSettings(this.prisma, roomId)
    const request = feedbackRequestFromDefaults(room)
    return { reply_mode: request.replyMode, requested_feedback_types: request.requestedFeedbackTypes, idea_guidance: request.ideaGuidance }
  }

  private async serializeActivitySummary(
    activity: {
      id: number
      room_id?: number | null
      host_id: number
      name: string
      prompt?: string | null
      status: string
      submit_by?: Date | null
      feedback_due_at?: Date | null
      closed_at?: Date | null
      reply_mode?: string | null
      requested_feedback_types?: unknown
      idea_guidance?: string | null
      template_key?: string | null
      template_version?: number | null
      template_config?: unknown
    },
    userId: number,
    viewerState?: RoundViewerStatePayload,
    accessKind: RoomAccessKind = "member",
    limitedHistory = accessKind === "visitor",
  ): Promise<RoundSummaryPayload> {
    const visitor = accessKind === "visitor"
    return {
      id: String(activity.id),
      roomId: activity.room_id ? String(activity.room_id) : null,
      ...(!visitor ? { hostId: String(activity.host_id) } : {}),
      name: activity.name,
      prompt: activity.prompt ?? null,
      status: this.cleanStatus(activity.status),
      submitBy: activity.submit_by?.toISOString() ?? null,
      feedbackDueAt: activity.feedback_due_at?.toISOString() ?? null,
      closedAt: activity.closed_at?.toISOString() ?? null,
      templateKey: activityTemplateDefinition(activity.template_key).key,
      templateVersion: Number(activity.template_version ?? 1),
      templateConfig: this.recordValue(activity.template_config),
      feedbackRequest: serializeEntryFeedbackRequest(activity),
      viewerState: visitor ? this.visitorViewerState() : viewerState ?? (await this.viewerState(activity, userId)),
      viewerAccess: { kind: accessKind, canParticipate: !visitor, scope: limitedHistory ? "active_published_only" : "all" },
    }
  }

  private awaitingCoverMinimum(activity: ViewerRound, now: number) {
    return activity.status === "active" && activity.template_key === "art_before_chorus" &&
      Boolean(activity.submit_by && activity.submit_by.getTime() < now) &&
      (!activity.feedback_due_at || activity.feedback_due_at.getTime() > now)
  }

  private viewerStateFrom(activity: ViewerRound, participation: ViewerParticipation | null, coverCount: number, now: number): RoundViewerStatePayload {
    const role = ACTIVITY_ROLES.includes(participation?.role as RoundRole) ? (participation?.role as RoundRole) : null
    const active = participation?.status === "active"
    const submissionsOpen = activity.status === "active" && (
      !activity.submit_by || activity.submit_by.getTime() >= now ||
      (this.awaitingCoverMinimum(activity, now) && coverCount < ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS)
    )
    return {
      role: active ? role : null,
      status: participation?.status ?? null,
      canJoin: submissionsOpen,
      canReview: activity.status === "active",
      canFollow: activity.status === "active",
      canSubmit: submissionsOpen && active && role === "participant",
      submittedEntryId: participation?.submitted_entry_id ? String(participation.submitted_entry_id) : null,
    }
  }

  private async viewerStates(activities: ViewerRound[], userId: number, database: Pick<Prisma.TransactionClient, "activityParticipation" | "activityArtifact"> = this.prisma) {
    const unique = [...new Map(activities.map(activity => [activity.id, activity])).values()]
    const states = new Map<number, RoundViewerStatePayload>()
    const now = Date.now()
    for (let start = 0; start < unique.length; start += 500) {
      const batch = unique.slice(start, start + 500)
      const coverIds = batch.filter(activity => this.awaitingCoverMinimum(activity, now)).map(activity => activity.id)
      const [participations, covers] = await Promise.all([
        database.activityParticipation.findMany({
          where: { round_id: { in: batch.map(activity => activity.id) }, user_id: userId },
          select: { round_id: true, role: true, status: true, submitted_entry_id: true },
        }),
        coverIds.length ? database.activityArtifact.groupBy({
          by: ["round_id"], where: { round_id: { in: coverIds }, kind: "cover", status: "active" }, _count: { _all: true },
        }) : [],
      ])
      const participationById = new Map(participations.map(participation => [participation.round_id, participation]))
      const coverCountById = new Map(covers.map(cover => [cover.round_id, cover._count._all]))
      for (const activity of batch) states.set(activity.id, this.viewerStateFrom(activity, participationById.get(activity.id) ?? null, coverCountById.get(activity.id) ?? 0, now))
    }
    return states
  }

  private async viewerState(activity: ViewerRound, userId: number): Promise<RoundViewerStatePayload> {
    const participation = await this.prisma.activityParticipation.findUnique({
      where: { round_id_user_id: { round_id: Number(activity.id ?? 0), user_id: Number(userId ?? 0) } },
    })
    const now = Date.now()
    const coverCount = this.awaitingCoverMinimum(activity, now)
      ? await this.prisma.activityArtifact.count({ where: { round_id: activity.id, kind: "cover", status: "active" } })
      : 0
    return this.viewerStateFrom(activity, participation, coverCount, now)
  }

  private visitorViewerState(): RoundViewerStatePayload {
    return {
      role: null,
      status: null,
      canJoin: false,
      canReview: false,
      canFollow: false,
      canSubmit: false,
      submittedEntryId: null,
    }
  }

  private async assertActivityHasEnoughMembers(
    template: ReturnType<typeof activityTemplateDefinition>,
    communityId: number | null,
    database: Pick<Prisma.TransactionClient, "roomMembership"> = this.prisma,
  ) {
    if (!template.minimumParticipants) return
    const memberCount = communityId
      ? await database.roomMembership.count({
          where: { room_id: communityId, disabled: false },
        })
      : 0
    if (memberCount < template.minimumParticipants) {
      throw new BadRequestException(
        `${template.name} needs at least ${template.minimumParticipants} participants`,
      )
    }
  }

  private serializeParticipation(participation: {
    id: number
    user_id: number
    role: string
    status: string
    joined_at: Date
    withdrawn_at?: Date | null
    submitted_entry_id?: number | null
    user?: { username?: string | null } | null
  }, memberPreview?: { username: string; avatarUrl: string | null }): RoundParticipantPayload {
    return {
      id: String(participation.id),
      userId: String(participation.user_id),
      role: this.cleanRole(participation.role),
      status: participation.status,
      joinedAt: participation.joined_at.toISOString(),
      withdrawnAt: participation.withdrawn_at?.toISOString() ?? null,
      submittedEntryId: participation.submitted_entry_id ? String(participation.submitted_entry_id) : null,
      displayUsername: memberPreview?.username ?? this.displayUsername(participation),
      avatarUrl: memberPreview?.avatarUrl ?? null,
    }
  }

  private displayUsername(participation: { user?: { username?: string | null } | null }) {
    return participation.user?.username?.trim() || "Member"
  }

  private activityPhase(activity: {
    status: string
    started_at?: Date | null
    submit_by?: Date | null
    feedback_due_at?: Date | null
  }): RoundPhase {
    if (activity.status !== "active") return "complete"
    const now = Date.now()
    if (activity.started_at && activity.started_at.getTime() > now) return "upcoming"
    if (!activity.submit_by || activity.submit_by.getTime() >= now) return "submission"
    if (!activity.feedback_due_at || activity.feedback_due_at.getTime() >= now) return "feedback"
    return "complete"
  }

  private async memberPreviewMap(communityId: number | null, userIds: number[]) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
    if (!communityId || uniqueUserIds.length === 0) {
      return new Map<number, { username: string; avatarUrl: string | null }>()
    }

    const [memberships, attachments] = await Promise.all([
      this.prisma.roomMembership.findMany({
        where: { room_id: communityId, user_id: { in: uniqueUserIds }, disabled: false },
        include: { user: true },
      }),
      this.prisma.activeStorageAttachment.findMany({
        where: { record_type: "User", record_id: { in: uniqueUserIds }, name: "avatar" },
        orderBy: { created_at: "desc" },
      }),
    ])
    const avatarMap = new Map<number, string>()
    attachments.forEach((attachment) => {
      const userId = Number(attachment.record_id ?? 0)
      if (!avatarMap.has(userId)) {
        avatarMap.set(
          userId,
          uploadVariantUrl(`/api/v1/uploads/${String(attachment.blob_id)}`, "avatarStripe40") ?? "",
        )
      }
    })
    return new Map(
      memberships.map((membership) => [
        Number(membership.user_id ?? 0),
        {
          username: membership.username_override || membership.user.username,
          avatarUrl: avatarMap.get(Number(membership.user_id ?? 0)) ?? null,
        },
      ] as const),
    )
  }

  private cleanStatus(value: unknown): RoundStatus {
    return ACTIVITY_STATUSES.includes(value as RoundStatus) ? (value as RoundStatus) : "active"
  }

  private cleanRole(value: unknown): RoundRole {
    return ACTIVITY_ROLES.includes(value as RoundRole) ? (value as RoundRole) : "participant"
  }

  private cleanName(value: unknown, fallback: string) {
    if (typeof value !== "string") return `${fallback} Activity`
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : `${fallback} Activity`
  }

  private cleanOptionalText(value: unknown) {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  private parseDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === "") return null
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value
    if (typeof value !== "string" && typeof value !== "number") throw new BadRequestException("Invalid date")
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException("Invalid date")
    return parsed
  }

  private recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  }

  private validateActivityDates(templateKey: string, submitBy: Date | null, feedbackDueAt: Date | null) {
    if (templateKey !== "art_before_chorus") return
    if (!submitBy || !feedbackDueAt) throw new BadRequestException("Set dates for the cover and response steps")
    if (feedbackDueAt.getTime() <= submitBy.getTime()) {
      throw new BadRequestException("The response date must come after the cover date")
    }
  }
}
