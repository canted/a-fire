import { authorizeMentionReferences, lockMentionReferenceAccess } from "../mentions/mention-reference-access"
import { roomFeedbackSettings } from "../rooms/room-feedback-settings"
import { notifyRoomChanged } from "../../../realtime/room-change"
import { roomEntryRoomId } from "./room-entry-scope"
import { recentRoomMemberEntryIds } from "./room-entry-history"
import { isDeepStrictEqual } from "node:util"
import { assertRoomEntrySource, roomEntryValidationContent } from "./room-entry-policy"
import { UploadsService } from "../uploads/uploads.service"
import { validateRoundEntryContent, validateEntryPublication } from "./entry-content";
import { canManageEntryDraft } from "./entry-draft-access";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import { trimTrailingBlankNodes } from "../../../realtime/document-content"
import { RealtimeService } from "../../../realtime/realtime.service"
import { capturePostPublished, capturePosthogEvent } from "../../../runtime/posthog"
import { RoomAccessService } from "../rooms/room-access.service"
import {
  DEFAULT_FEEDBACK_TYPES,
  DEFAULT_IDEA_GUIDANCE,
  normalizeFeedbackTypes,
  normalizeIdeaGuidance,
  normalizeReplyMode,
  parseEntryFeedbackRequest,
  feedbackRequestFromDefaults,
  serializeEntryFeedbackRequest,
  validateGuidedFeedbackTypes,
} from "../feedback-settings"
import { LinkPreviewsService } from "../link-previews/link-previews.service"
import { ProjectsService } from "../projects/projects.service"
import { isProjectEntry } from "../projects/project-access"
import { RoundsService } from "../rounds/rounds.service"
import { findUnsupportedMediaSrcs } from "../uploads/upload-urls"
import {
  DEFAULT_TIPTAP_DOC,
  normalizeUploadUrls,
  entryBody,
  recordValue,
} from "./post-content"
import { parseEntryFormatUpdate, parseEntryFormatData } from "./entry-formats"
import { EntryNotificationsService } from "./entry-notifications.service"
import {
  deriveEntrySubject,
  normalizeEntrySubjectPayload,
  postSubjectPersistenceData,
  serializeStoredEntrySubject,
} from "./entry-subjects"
import { EntriesReadService } from "./entries.read.service"
import type {
  DeleteLockedChatEntryPayload,
  EntryFeedbackRequestInput,
  EntryListItem,
  EntryShowResponse,
} from "./entries.types"

export type {
  DeleteLockedChatEntryPayload,
  EntryFeedbackRequestInput,
  EntryListItem,
  EntryNavigationLink,
  EntryShow,
  EntryShowResponse,
  EntryUser,
  ReplyPayload,
} from "./entries.types"

/** Coordinates post mutations, delegating reads and notification side effects. */
@Injectable()
export class EntriesService {
  @Inject(UploadsService) private readonly uploads!: UploadsService

  @Inject(EntryNotificationsService)
  private readonly notifications!: EntryNotificationsService

  @Inject(EntriesReadService)
  private readonly read!: EntriesReadService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RealtimeService)
  private readonly realtime!: RealtimeService

  @Inject(LinkPreviewsService)
  private readonly linkPreviews!: LinkPreviewsService

  @Inject(RoundsService)
  private readonly activitiesService!: RoundsService

  @Inject(ProjectsService)
  private readonly projectsService!: ProjectsService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  async listPosts(roomId: number | null, userId: number): Promise<EntryListItem[]> {
    return this.read.listPosts(roomId, userId)
  }

  /** Legacy DELETE transport shares the same authorization and lifecycle owner. */
  async deleteLockedChatPost(postId: number, userId: number): Promise<DeleteLockedChatEntryPayload> {
    const result = await this.withdrawRoomEntry(postId, userId)
    return { success: true, ...result }
  }

  async updateProject(postId: number, actorId: number, projectId: number | null) {
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (!post || post.status === "deleted") throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) throw new BadRequestException("Project material stays in its project")

    if (projectId) {
      await this.projectsService.assertCanAssociate(
        projectId,
        actorId,
        post.user_id,
        Number(post.room_id ?? 0) || null,
      )
      if (actorId !== post.user_id && post.room_id) {
        const membership = await this.prisma.roomMembership.findFirst({
          where: { room_id: post.room_id, user_id: actorId, disabled: false },
          select: { id: true },
        })
        if (!membership) throw new ForbiddenException("Forbidden")
      }
    } else if (actorId !== post.user_id) {
      if (!post.project_id) throw new ForbiddenException("Forbidden")
      const project = await this.prisma.project.findUnique({ where: { id: post.project_id } })
      if (!project || project.owner_id !== actorId) throw new ForbiddenException("Forbidden")
    }

    return this.prisma.entry.update({
      where: { id: post.id },
      data: { project_id: projectId || null, updated_at: new Date() },
      select: { id: true, project_id: true },
    })
  }

  async fetchDraft(postId: number, userId: number) {
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (!post || !(await canManageEntryDraft(this.prisma, this.circleAccess, post, userId, true))) {
      throw new ForbiddenException("Forbidden")
    }
    await this.syncDraftFeedbackRequest(post.id)
    return this.read.draftPayload(post.id, userId)
  }

  async updateDraftActivity(postId: number, userId: number, activityId: number | null) {
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (!post || Number(post.user_id ?? 0) !== userId) throw new ForbiddenException("Forbidden")
    if (isProjectEntry(post)) throw new BadRequestException("Share project material to a circle before adding it to a activity")
    if (post.status !== "draft") throw new BadRequestException("Only drafts can change activity submission")

    const roomId = roomEntryRoomId(post)
    if (!roomId || post.source_entry_id == null) throw new ForbiddenException("Room Entry unavailable")
    const normalizedRoundId = Number(activityId ?? 0) || null
    await this.prisma.$transaction(async tx => {
      await this.circleAccess.requireMemberInTransaction(tx, roomId, userId)
      if (normalizedRoundId) {
        await this.activitiesService.validateActivitySubmission(normalizedRoundId, userId, post.creation_origin, tx)
        const activity = await tx.round.findUnique({ where: { id: normalizedRoundId } })
        if (!activity || activity.room_id !== roomId) throw new ForbiddenException("Round belongs to another Room")
      }
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${post.id} FOR UPDATE`
      const current = await tx.entry.findUnique({ where: { id: post.id } })
      if (!current || current.status !== "draft" || current.user_id !== userId
        || current.room_id !== roomId || current.source_entry_id !== post.source_entry_id
        || current.updated_at.getTime() !== post.updated_at.getTime()) {
        throw new ConflictException("This Entry changed. Reload it before changing its Round.")
      }
      await tx.entry.update({
        where: { id: post.id },
        data: { round_id: normalizedRoundId, updated_at: new Date(Math.max(Date.now(), post.updated_at.getTime() + 1)) },
      })
    })
    await this.syncDraftFeedbackRequest(post.id)
    return this.read.draftPayload(post.id, userId)
  }

  async saveContent(
    postId: number,
    userId: number,
    content: unknown,
    subject?: unknown,
    linkPreview?: unknown,
    feedbackRequest?: EntryFeedbackRequestInput | null,
    formatInput?: unknown,
    formatDataInput?: unknown,
    expectedRevision?: unknown,
  ) {
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (isProjectEntry(post)) throw new BadRequestException("Save project material through its project")
    if (!post || !(await canManageEntryDraft(this.prisma, this.circleAccess, post, userId))) {
      throw new ForbiddenException("Forbidden")
    }

    if (expectedRevision !== undefined) {
      if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new BadRequestException("Entry revision must be a nonnegative integer")
      }
      if (post.updated_at.getTime() !== expectedRevision) {
        throw new ConflictException("This Entry changed elsewhere. Your draft has not been saved.")
      }
    }

    const nextFormat = parseEntryFormatUpdate(formatInput, post.format)
    let resolvedContent = content
    let resolvedFormatDataInput = formatDataInput
    let saveRoomId = post.room_id
    if (post.round_id && ["round_activity_cover", "round_activity_response"].includes(post.creation_origin ?? "")) {
      const activity = await this.prisma.round.findUnique({ where: { id: post.round_id } })
      if (!activity) throw new NotFoundException("Activity not found")
      if (activity.room_id) await this.circleAccess.requireMember(activity.room_id, userId)
      await this.validateActivityDraft(post.round_id, userId, post.creation_origin)
      const submitted = await this.prisma.activityArtifact.findUnique({ where: { entry_id: post.id }, select: { status: true } })
      validateRoundEntryContent(activity, post.creation_origin, roomEntryValidationContent(post, resolvedContent), formatInput ?? post.format,
        resolvedFormatDataInput === undefined ? post.format_data : resolvedFormatDataInput, submitted?.status !== "active")
    }
    const preparedLinkPreview = await this.linkPreviews.prepareAttachment(linkPreview, resolvedContent)
    const feedbackData = feedbackRequest ? this.postFeedbackUpdateData(feedbackRequest, true) : {}
    const parsedFormatData = parseEntryFormatData(resolvedFormatDataInput)
    const storedProvenance = recordValue(parseEntryFormatData(post.format_data)?.chat_provenance)
    const formatData: Prisma.EntryUpdateInput =
      formatInput !== undefined || formatDataInput !== undefined
        ? {
            format: nextFormat,
            format_data: (storedProvenance
              ? { ...(parsedFormatData ?? {}), chat_provenance: storedProvenance }
              : parsedFormatData) as Prisma.InputJsonValue,
          }
        : {}
    await this.prisma.$transaction(async tx => {
      if (!saveRoomId) throw new ForbiddenException("Forbidden")
      await lockMentionReferenceAccess(tx, this.circleAccess, [resolvedContent], userId, saveRoomId, [saveRoomId])
      if (post.round_id && ["round_activity_cover", "round_activity_response"].includes(post.creation_origin ?? "")) {
        await this.activitiesService.validateActivitySubmission(post.round_id, userId, post.creation_origin, tx)
      }
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${post.id} FOR UPDATE`
      const current = await tx.entry.findUnique({ where: { id: post.id } })
      if (!current || current.status !== post.status || current.updated_at?.getTime() !== post.updated_at?.getTime()) {
        throw new ConflictException("This Entry changed. Reload it before saving again.")
      }
      if (post.round_id && ["round_activity_cover", "round_activity_response"].includes(post.creation_origin ?? "")) {
        const activity = await tx.round.findUnique({ where: { id: post.round_id } })
        if (!activity) throw new NotFoundException("Activity not found")
        const submitted = await tx.activityArtifact.findUnique({ where: { entry_id: post.id }, select: { status: true } })
        validateRoundEntryContent(activity, post.creation_origin, roomEntryValidationContent(post, resolvedContent), formatInput ?? post.format,
          resolvedFormatDataInput === undefined ? post.format_data : resolvedFormatDataInput, submitted?.status !== "active")
      }
      resolvedContent = await authorizeMentionReferences(tx, this.circleAccess, resolvedContent as Prisma.InputJsonValue, userId, saveRoomId)
      await this.upsertDocument("Post", post.id, resolvedContent, tx)
      await this.upsertPostSubject(post.id, subject, resolvedContent, tx)
      await this.linkPreviews.applyPreparedAttachment("Post", post.id, preparedLinkPreview, tx)
      await tx.entry.update({
        where: { id: post.id },
        data: { ...feedbackData, ...formatData, updated_at: new Date(Math.max(Date.now(), (post.updated_at?.getTime() ?? 0) + 1)) },
      })
    })

    return this.read.draftPayload(post.id, userId)
  }

  async withdrawRoomEntry(postId: number, userId: number) {
    const selected = await this.prisma.entry.findUnique({ where: { id: postId } })
    const roomId = selected ? roomEntryRoomId(selected) : null
    if (!selected || !roomId || isProjectEntry(selected) || selected.creation_origin === "chat_attachment") throw new ForbiddenException("Room Entry unavailable")
    let withdrawn = false
    const result = await this.prisma.$transaction(async tx => {
      const access = await this.circleAccess.requireMemberInTransaction(tx, roomId, userId)
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${postId} FOR UPDATE`
      const post = await tx.entry.findUnique({ where: { id: postId } })
      if (!post || roomEntryRoomId(post) !== roomId || isProjectEntry(post) || post.creation_origin === "chat_attachment"
        || !["published", "deleted"].includes(post.status)) throw new ForbiddenException("Room Entry unavailable")
      if (post.user_id !== userId && !access.canManage) throw new ForbiddenException("Only the sharer or Room owner may withdraw this Entry")
      if (post.status === "published") {
        await tx.entry.update({ where: { id: postId }, data: { status: "deleted", updated_at: new Date(Math.max(Date.now(), post.updated_at.getTime() + 1)) } })
        await notifyRoomChanged(tx, roomId)
        withdrawn = true
      }
      const authorMembership = await tx.roomMembership.findFirst({
        where: { room_id: roomId, user_id: post.user_id, disabled: false }, select: { id: true },
      })
      const current = authorMembership ? await recentRoomMemberEntryIds(tx, [{ roomId, userId: post.user_id }], 1) : []
      return { entry_id: postId, room_id: roomId, current_entry_id: current[0] ?? null }
    })
    if (withdrawn) capturePosthogEvent({ distinctId: userId, event: "entry_withdrawn", properties: {
      entry_id: postId, source_entry_id: selected.source_entry_id, room_id: roomId,
    } })
    return result
  }

  async publish(postId: number, userId: number) {
    let post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (isProjectEntry(post)) throw new BadRequestException("Save project material through its project")
    if (!post || !(await canManageEntryDraft(this.prisma, this.circleAccess, post, userId, true))) {
      throw new ForbiddenException("Forbidden")
    }
    if (post.status === "published") return this.read.draftPayload(post.id, userId)

    await assertRoomEntrySource(this.prisma, post)

    if (post.status === "draft" && !post.feedback_request_customized) {
      await this.syncDraftFeedbackRequest(post.id)
      post = await this.prisma.entry.findUnique({ where: { id: postId } })
      if (!post) throw new NotFoundException("Not Found")
    }

    if (post.round_id) {
      await this.validateActivityDraft(post.round_id, userId, post.creation_origin)
    }

    const feedbackRequest = serializeEntryFeedbackRequest(post)
    validateGuidedFeedbackTypes(feedbackRequest.reply_mode, feedbackRequest.requested_feedback_types)

    const document = await this.prisma.document.findFirst({ where: { docable_type: "Post", docable_id: post.id } })
    let normalizedContent = trimTrailingBlankNodes(
      normalizeUploadUrls(entryBody(document?.content)),
    )
    const validationContent = roomEntryValidationContent(post, normalizedContent)
    validateEntryPublication(validationContent, post.format, post.format_data)
    if (post.round_id) {
      const activity = await this.prisma.round.findUnique({ where: { id: post.round_id } })
      if (!activity) throw new NotFoundException("Activity not found")
      if (activity.template_key === "art_before_chorus") throw new BadRequestException("Submit this entry from its Activity step")
      validateRoundEntryContent(activity, post.creation_origin, validationContent, post.format, post.format_data)
    }
    const publishedAt = post.published_at ?? new Date()
    const publicationRoomId = post.room_id
    if (!publicationRoomId) throw new ForbiddenException("Forbidden")
    const lockPublicationAccess = async (tx: Prisma.TransactionClient) => {
      await lockMentionReferenceAccess(tx, this.circleAccess, [validationContent], userId, publicationRoomId, [publicationRoomId])
      if (post.round_id) {
        await this.activitiesService.validateActivitySubmission(post.round_id, userId, post.creation_origin, tx)
        const activity = await tx.round.findUnique({ where: { id: post.round_id } })
        if (!activity) throw new NotFoundException("Activity not found")
        if (activity.template_key === "art_before_chorus") throw new BadRequestException("Submit this entry from its Activity step")
        validateRoundEntryContent(activity, post.creation_origin, validationContent, post.format, post.format_data)
      }
    }
    const lockPreparedDraft = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${post.id} FOR UPDATE`
      const current = await tx.entry.findUnique({ where: { id: post.id } })
      if (!current || current.status === "deleted") throw new NotFoundException("Entry unavailable")
      if (current.status === "published") return false
      await tx.$queryRaw`SELECT id FROM documents WHERE docable_type = 'Post' AND docable_id = ${post.id} FOR UPDATE`
      const currentDocument = await tx.document.findFirst({ where: { docable_type: "Post", docable_id: post.id } })
      if (current.status !== post.status || current.updated_at.getTime() !== post.updated_at.getTime() || !isDeepStrictEqual(currentDocument, document)) {
        throw new ConflictException("This Entry changed before publication. Review it again.")
      }
      return true
    }
    const publishRecord = async (tx: Prisma.TransactionClient) => {
      normalizedContent = await authorizeMentionReferences(tx, this.circleAccess, normalizedContent as Prisma.InputJsonValue, userId, publicationRoomId)
      const sharedFeedback: Prisma.InputJsonValue[] | undefined = Array.isArray(post.shared_feedback) ? [] : undefined
      for (const feedback of Array.isArray(post.shared_feedback) ? post.shared_feedback : []) {
        const snapshot = recordValue(feedback)
        if (!snapshot) throw new BadRequestException("Shared feedback must contain a document")
        const content = await authorizeMentionReferences(tx, this.circleAccess, snapshot.content as Prisma.InputJsonValue, userId, publicationRoomId)
        sharedFeedback!.push({ ...snapshot, content } as Prisma.InputJsonObject)
      }
      await this.upsertDocument("Post", post.id, normalizedContent, tx)
      await this.ensurePostSubject(post.id, normalizedContent, tx)
      if (post.round_id) await this.activitiesService.markSubmitted(post.round_id, post.id, userId, tx)
      await tx.entry.update({ where: { id: post.id }, data: { status: "published", published_at: publishedAt, updated_at: publishedAt, ...(sharedFeedback ? { shared_feedback: sharedFeedback } : {}) } })
    }
    const published = await this.prisma.$transaction(async tx => {
      await lockPublicationAccess(tx)
      if (!(await lockPreparedDraft(tx))) return false
      await publishRecord(tx)
      const events = [
        await this.notifications.createPostNotification(post, normalizedContent, tx),
        ...(await this.notifications.createMentionNotifications(post, normalizedContent, tx)),
      ]
      await this.notifications.enqueueNotificationEvents(events, tx)
      await notifyRoomChanged(tx, publicationRoomId)
      return true
    })
    if (!published) return this.read.draftPayload(post.id, userId)

    this.realtime.emit("ChatChannel", this.realtime.chatRoom(publicationRoomId), { type: "invalidate", room_id: publicationRoomId })
    capturePostPublished({
      userId,
      entryId: post.id,
      sourceEntryId: post.source_entry_id,
      projectId: post.project_id,
      activityId: post.round_id,
      roomId: publicationRoomId,
      content: normalizedContent as Prisma.InputJsonValue,
    })

    return this.read.draftPayload(post.id, userId)
  }

  private validateActivityDraft(
    activityId: number,
    userId: number,
    creationOrigin?: string | null,
  ) {
    return creationOrigin === undefined
      ? this.activitiesService.validateActivitySubmission(activityId, userId)
      : this.activitiesService.validateActivitySubmission(activityId, userId, creationOrigin)
  }

  async updateFeedbackRequest(postId: number, userId: number, feedbackRequest: EntryFeedbackRequestInput) {
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (
      !post || !(await canManageEntryDraft(this.prisma, this.circleAccess, post, userId, true))
    ) {
      throw new ForbiddenException("Forbidden")
    }

    const preparedEntry = post
    const roomId = post.room_id
    if (!roomId) throw new ForbiddenException("Forbidden")
    const feedbackData = this.postFeedbackUpdateData(feedbackRequest, true)
    const updated = await this.prisma.$transaction(async tx => {
      const access = await this.circleAccess.requireMemberInTransaction(tx, roomId, userId)
      if (!access.canWriteWall) throw new ForbiddenException("Forbidden")
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${post.id} FOR UPDATE`
      const current = await tx.entry.findUnique({ where: { id: post.id } })
      if (!current || current.status === "deleted") throw new NotFoundException("Entry unavailable")
      if (!isDeepStrictEqual(current, preparedEntry)) throw new ConflictException("This Entry changed. Review its feedback settings again.")
      return tx.entry.update({
        where: { id: post.id },
        data: { ...feedbackData, updated_at: new Date(Math.max(Date.now(), post.updated_at.getTime() + 1)) },
      })
    })

    return {
      feedback_request: serializeEntryFeedbackRequest(updated),
      can_edit_feedback_request: Number(updated.user_id ?? 0) === Number(userId ?? 0),
    }
  }

  async roomProjectShares(postId: number, userId: number, cursor?: number) {
    return this.read.roomProjectShares(postId, userId, cursor)
  }

  async fetchEntry(postId: number, userId: number, page?: string, perPage?: string): Promise<EntryShowResponse> {
    return this.read.fetchEntry(postId, userId, page, perPage)
  }

  private async roomFeedbackDefaults(roomId: number | null | undefined) {
    const room = await roomFeedbackSettings(this.prisma, roomId)
    const request = feedbackRequestFromDefaults(room)
    return { replyMode: request.replyMode, feedbackTypes: request.requestedFeedbackTypes, ideaGuidance: request.ideaGuidance }
  }

  private async activityFeedbackDefaults(activityId: number | null | undefined) {
    const activity = activityId
      ? await this.prisma.round.findUnique({
          where: { id: Number(activityId ?? 0) },
          select: {
            reply_mode: true,
            requested_feedback_types: true,
            idea_guidance: true,
          },
        })
      : null

    const replyMode = normalizeReplyMode(activity?.reply_mode)
    const feedbackTypes = replyMode === "guided"
      ? normalizeFeedbackTypes(activity?.requested_feedback_types, DEFAULT_FEEDBACK_TYPES)
      : []
    const ideaGuidance = replyMode === "guided"
      ? normalizeIdeaGuidance(activity?.idea_guidance, DEFAULT_IDEA_GUIDANCE)
      : null
    validateGuidedFeedbackTypes(replyMode, feedbackTypes)

    return { replyMode, feedbackTypes, ideaGuidance }
  }

  private async syncDraftFeedbackRequest(postId: number) {
    const post = await this.prisma.entry.findUnique({
      where: { id: Number(postId ?? 0) },
      select: { id: true, reply_mode: true, requested_feedback_types: true, idea_guidance: true, updated_at: true, status: true, feedback_request_customized: true, round_id: true, room_id: true },
    })
    if (!post || post.status !== "draft" || post.feedback_request_customized) return

    const defaults = post.round_id ? await this.activityFeedbackDefaults(post.round_id) : await this.roomFeedbackDefaults(post.room_id)
    const feedbackTypes = defaults.replyMode === "guided" ? defaults.feedbackTypes : []
    const ideaGuidance = defaults.replyMode === "guided" ? defaults.ideaGuidance : null
    if (post.reply_mode === defaults.replyMode && post.idea_guidance === ideaGuidance && isDeepStrictEqual(post.requested_feedback_types, feedbackTypes)) return
    await this.prisma.entry.updateMany({
      where: {
        id: post.id, status: "draft", feedback_request_customized: false, updated_at: post.updated_at,
        round_id: post.round_id, room_id: post.room_id,
        reply_mode: post.reply_mode, idea_guidance: post.idea_guidance,
        requested_feedback_types: { equals: post.requested_feedback_types ?? Prisma.AnyNull },
      },
      data: {
        reply_mode: defaults.replyMode,
        requested_feedback_types: feedbackTypes,
        idea_guidance: ideaGuidance,
        updated_at: new Date(Math.max(Date.now(), post.updated_at.getTime() + 1)),
      },
    })
  }

  private postFeedbackUpdateData(input: EntryFeedbackRequestInput, customized: boolean) {
    const request = parseEntryFeedbackRequest(input)
    return {
      reply_mode: request.replyMode,
      requested_feedback_types: request.replyMode === "guided" ? request.requestedFeedbackTypes : [],
      idea_guidance: request.ideaGuidance,
      feedback_request_customized: customized,
    }
  }

  private async upsertDocument(type: "Post", id: number, content: unknown, tx: Prisma.TransactionClient = this.prisma) {
    this.assertPersistableContent(content)
    const normalizedContent = normalizeUploadUrls(content ?? DEFAULT_TIPTAP_DOC)
    const existing = await tx.document.findFirst({ where: { docable_type: type, docable_id: id } })
    if (existing) {
      await tx.document.update({
        where: { id: existing.id },
        data: { content: normalizedContent as Prisma.InputJsonValue, version: { increment: 1 }, updated_at: new Date() },
      })
      return
    }

    await tx.document.create({
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

  private async upsertPostSubject(postId: number, subjectInput: unknown, content: unknown, tx: Prisma.TransactionClient = this.prisma) {
    const subject = normalizeEntrySubjectPayload(subjectInput, content)
    const persistence = postSubjectPersistenceData(subject)
    const data = { ...persistence, metadata: persistence.metadata as Prisma.InputJsonValue }
    const existing = await tx.entrySubject.findUnique({ where: { entry_id: postId } })
    if (existing) {
      await tx.entrySubject.update({
        where: { id: existing.id },
        data: { ...data, updated_at: new Date() },
      })
      return subject
    }

    await tx.entrySubject.create({
      data: {
        entry_id: postId,
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      },
    })
    return subject
  }

  private async ensurePostSubject(postId: number, content: unknown, tx: Prisma.TransactionClient = this.prisma) {
    const existing = await tx.entrySubject.findUnique({ where: { entry_id: postId } })
    if (existing) return serializeStoredEntrySubject(existing)
    return this.upsertPostSubject(postId, deriveEntrySubject(content), content, tx)
  }

  private assertPersistableContent(content: unknown) {
    const unsupportedMediaSrcs = findUnsupportedMediaSrcs(content)
    if (unsupportedMediaSrcs.length > 0) {
      throw new BadRequestException("Media must be uploaded before saving content")
    }
  }
}
