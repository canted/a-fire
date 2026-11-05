import { capturePosthogEvent, summarizeContentForAnalytics } from "../../../runtime/posthog"
import { authorizeMentionReferences, lockMentionReferenceAccess } from "../mentions/mention-reference-access"
import { projectEntryPage } from "./project-entry-page"
import { projectCopyPage } from "./project-copy-page"
import { roomFeedbackSettings } from "../rooms/room-feedback-settings"
import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { availableChatMessageWhere } from "../../v2/rooms/chat-visibility"
import { buildEntryShareManifest, selectEntryShare, EntryShareSelectionError, type EntryShareSource, type EntryShareFeedback } from "../../../../frontend/src/lib/entryShareSelection"
import type { TiptapDoc } from "../../../../frontend/src/lib/tiptap"
import { feedbackSourceAvailable, assertEntryFeedbackRoom, entryFeedbackOrigins, referencedFeedbackOrigins, sharingRevision, shareRequestKey, type SharedFeedbackSnapshot } from "./entry-sharing"
import { validateRoundEntryContent, validateEntryPublication } from "../entries/entry-content"
import { chatMessageDocument } from "../../v2/rooms/chat-content"
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, type Entry, type Round as Activity } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import { RoomAccessService } from "../rooms/room-access.service"
import { feedbackRequestFromDefaults, parseEntryFeedbackRequest } from "../feedback-settings"
import { DEFAULT_TIPTAP_DOC, normalizeUploadUrls, entryBody } from "../entries/post-content"
import { parseEntryFormatUpdate, parseEntryFormat, parseEntryFormatData } from "../entries/entry-formats"
import { RoundsService } from "../rounds/rounds.service"
import { presentImageDocuments } from "../uploads/image-presentation"
import { findUnsupportedMediaSrcs } from "../uploads/upload-urls"
import { UploadsService } from "../uploads/uploads.service"
import { lockProjectAccess, lockProjectEntryEditAccess, canEditProjectEntry, canReadProjectEntry, canViewProject, isProjectEntry } from "./project-access"

export type ProjectEntryInput = {
  expected_revision?: unknown
  content?: unknown
  format?: unknown
  format_data?: unknown
  intent?: unknown
  question?: unknown
  lyrics?: unknown
  save?: boolean
}

export type ProjectShareInput = {
  source_revision?: string
  selected_unit_ids?: string[]
  room_statement?: unknown
  request_key?: string
  room_id?: number
  round_id?: number | null
  creation_origin?: "round_activity_cover" | "round_activity_response"
  intent?: unknown
  question?: unknown
  include_lyrics?: boolean
  include_image?: boolean
  selected_node_indices?: number[]
}

@Injectable()
export class ProjectEntriesService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(UploadsService)
  private readonly uploads!: UploadsService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  @Inject(RoundsService)
  private readonly rounds!: RoundsService

  async page(projectId: number, userId: number, cursor?: string, entryId?: number) {
    await this.assertMember(projectId, userId)
    const page = await projectEntryPage(this.prisma, projectId, userId, cursor, entryId)
    const posts = page.ids.length ? await this.prisma.entry.findMany({
      where: { id: { in: page.ids }, project_id: projectId, status: "published", room_id: null,
        creation_origin: { in: ["project_material", "project_feedback"] } }, include: { user: true },
    }) : []
    const byId = new Map(posts.map(post => [post.id, post]))
    const ordered = page.ids.flatMap(id => { const post = byId.get(id); return post ? [post] : [] })
    return { entries: await Promise.all(ordered.map(post => this.representation(post, userId))), nextCursor: page.nextCursor }
  }

  async create(projectId: number, userId: number, input: { fresh?: unknown; request_key?: unknown } = {}) {
    await this.assertMember(projectId, userId)
    if (input.fresh !== undefined && typeof input.fresh !== "boolean") throw new BadRequestException("Fresh must be a boolean")
    const post = await this.prisma.$transaction(async tx => {
      await lockProjectAccess(tx, projectId, userId)
      if (input.request_key !== undefined) {
        if (typeof input.request_key !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.request_key)) throw new BadRequestException("Invalid entry creation request key")
        const now = new Date()
        const post = await tx.entry.upsert({
          where: { user_id_creation_request_key: { user_id: userId, creation_request_key: input.request_key } },
          create: { project_id: projectId, user_id: userId, creation_request_key: input.request_key, status: "draft", format: "mixed_media", creation_origin: "project_material", created_at: now, updated_at: now },
          update: { creation_request_key: input.request_key },
        })
        if (post.project_id !== projectId || post.status === "deleted") throw new ConflictException("This entry request is no longer available. Start a new entry.")
        return tx.entry.findUniqueOrThrow({ where: { id: post.id }, include: { user: true } })
      }
      const existing = input.fresh ? null : await tx.entry.findFirst({
        where: { project_id: projectId, user_id: userId, status: "draft", creation_origin: "project_material", room_id: null },
        include: { user: true },
        orderBy: { updated_at: "desc" },
      })
      if (existing) return existing
      const previous = input.fresh ? null : await tx.entry.findFirst({
        where: { project_id: projectId, user_id: userId, status: "published", creation_origin: "project_material", room_id: null },
        orderBy: [{ published_at: "desc" }, { id: "desc" }],
        select: { project_intent: true, project_question: true, project_lyrics: true },
      })
      const now = new Date()
      const post = await tx.entry.create({
        data: {
          project_id: projectId, user_id: userId, status: "draft", format: "mixed_media", creation_origin: "project_material",
          project_intent: previous?.project_intent ?? null, project_question: previous?.project_question ?? null,
          project_lyrics: previous?.project_lyrics ?? null, created_at: now, updated_at: now,
        },
        include: { user: true },
      })
      return post
    })
    return this.representation(post, userId)
  }

  async show(projectId: number, entryId: number, userId: number) {
    const post = await this.entry(projectId, entryId)
    if (!(await canReadProjectEntry(this.prisma, post, userId))) throw new NotFoundException("Material not found")
    return this.representation(post, userId)
  }

  async copies(projectId: number, entryId: number, userId: number, cursor?: string) {
    const post = await this.entry(projectId, entryId)
    if (!(await canReadProjectEntry(this.prisma, post, userId))) throw new NotFoundException("Material not found")
    if (post.creation_origin !== "project_material") return { submissions: [], nextCursor: null }
    return projectCopyPage(this.prisma, projectId, entryId, userId, cursor)
  }

  /** Moving and deleting keep the document identity and independent Room copies intact. */
  async changeLocation(projectId: number, entryId: number, userId: number, expectedRevision: unknown, destination: number | null) {
    if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new BadRequestException("Entry revision is required")
    if (destination !== null && (!Number.isSafeInteger(destination) || destination <= 0))
      throw new BadRequestException("Choose a project")
    const result = await this.prisma.$transaction(async tx => {
      // Consistent ordering prevents opposite-direction moves from deadlocking.
      for (const id of [...new Set([projectId, ...(destination === null ? [] : [destination])])].sort((a, b) => a - b))
        await lockProjectAccess(tx, id, userId)
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${entryId} FOR UPDATE`
      const post = await tx.entry.findUnique({ where: { id: entryId } })
      if (!post || post.project_id !== projectId || !(await canEditProjectEntry(tx, post, userId)))
        throw new ForbiddenException("Only the author can change this project entry")
      if (post.updated_at.getTime() !== expectedRevision)
        throw new ConflictException("This Entry changed elsewhere. Reload before moving or deleting it.")
      const now = new Date(Math.max(Date.now(), post.updated_at.getTime() + 1))
      await tx.entry.update({ where: { id: entryId }, data: {
        ...(destination === null ? { status: "deleted" } : { project_id: destination }), updated_at: now,
      } })
      await tx.project.updateMany({ where: { id: { in: [...new Set([projectId, ...(destination === null ? [] : [destination])])] } }, data: { updated_at: now } })
      return { id: entryId, project_id: destination }
    })
    if (destination !== projectId) capturePosthogEvent({ distinctId: userId, event: destination === null ? "project_entry_deleted" : "project_entry_moved", properties: {
      entry_id: entryId, project_id: projectId, destination_project_id: destination,
    } })
    return result
  }

  async update(projectId: number, entryId: number, userId: number, input: ProjectEntryInput) {
    const post = await this.entry(projectId, entryId)
    if (!(await canEditProjectEntry(this.prisma, post, userId))) throw new ForbiddenException("Only the author can edit project material")
    if (typeof input.expected_revision !== "number" || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) {
      throw new BadRequestException("expected_revision must be a nonnegative integer")
    }
    if (input.expected_revision !== post.updated_at.getTime()) throw new ConflictException("This Entry changed elsewhere. Your draft has not been saved.")
    if (input.save !== undefined && typeof input.save !== "boolean") throw new BadRequestException("Save must be a boolean")
    const format = parseEntryFormatUpdate(input.format, post.format)
    const formatData = input.format_data === undefined ? parseEntryFormatData(post.format_data) : parseEntryFormatData(input.format_data)
    let content = input.content === undefined ? undefined : this.content(input.content)
    const currentDocument = await this.prisma.document.findFirst({ where: { docable_type: "Post", docable_id: post.id } })
    await this.uploads.assertContentMediaAccess(userId, content ?? entryBody(currentDocument?.content), formatData)
    const sourceRoomIds = [...new Set([...entryFeedbackOrigins(post), ...await referencedFeedbackOrigins(this.prisma, post.id, userId, [content ?? currentDocument?.content, formatData])])]
    if (input.save) validateEntryPublication(content ?? entryBody(currentDocument?.content), format, formatData,
      [input.intent === undefined ? post.project_intent : this.framing(input.intent, "Title"), input.question === undefined ? post.project_question : this.framing(input.question, "Text"), input.lyrics === undefined ? post.project_lyrics : this.framing(input.lyrics, "Lyrics")].filter(Boolean).join("\n"))
    // Ensure two accepted edits cannot reuse the same millisecond revision.
    const now = new Date(Math.max(Date.now(), post.updated_at.getTime() + 1))
    const updated = await this.prisma.$transaction(async (tx) => {
      if (content !== undefined) await lockMentionReferenceAccess(tx, this.circleAccess, [content], userId, null, [], currentDocument?.content)
      await lockProjectEntryEditAccess(tx, post, userId)
      // Stored timestamps can have microseconds that JavaScript Date cannot retain.
      const claimed = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM entries WHERE id = ${post.id} AND project_id = ${projectId} AND status != 'deleted'
        AND date_trunc('milliseconds', updated_at) = ${post.updated_at.toISOString()}::timestamp
        FOR UPDATE`
      if (!claimed.length) throw new ConflictException("This Entry changed while saving. Your draft has not been saved.")
      if (content !== undefined) {
        await tx.$queryRaw`SELECT id FROM documents WHERE docable_type = 'Post' AND docable_id = ${post.id} FOR UPDATE`
        const retained = await tx.document.findFirst({ where: { docable_type: "Post", docable_id: post.id } })
        if (!isDeepStrictEqual(retained, currentDocument)) throw new ConflictException("This Entry document changed while saving. Your draft has not been saved.")
        content = await authorizeMentionReferences(tx, this.circleAccess, content as Prisma.InputJsonValue, userId, null, retained?.content) as typeof content
      }
      const result = await tx.entry.update({
        where: { id: post.id },
        data: {
          source_room_ids: sourceRoomIds, format, format_data: formatData ? formatData as Prisma.InputJsonValue : Prisma.DbNull,
          // Document owns edits. Retain any historical body untouched until offline archival.
          ...(input.intent !== undefined ? { project_intent: this.framing(input.intent, "Intent") } : {}),
          ...(input.question !== undefined ? { project_question: this.framing(input.question, "Question") } : {}),
          ...(input.lyrics !== undefined ? { project_lyrics: this.framing(input.lyrics, "Lyrics") } : {}),
          ...(input.save ? { status: "published", published_at: post.published_at ?? now } : {}), updated_at: now,
        },
        include: { user: true },
      })
      if (content !== undefined) {
        await tx.document.upsert({
          where: { docable_type_docable_id: { docable_type: "Post", docable_id: post.id } },
          create: { docable_type: "Post", docable_id: post.id, content: content as Prisma.InputJsonValue, version: 1, created_at: now, updated_at: now },
          update: { content: content as Prisma.InputJsonValue, version: { increment: 1 }, ydoc_state: null, updated_at: now },
        })
      }
      await tx.project.update({ where: { id: projectId }, data: { updated_at: now } })
      return result
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new ConflictException("This Entry changed while saving. Your draft has not been saved.")
      }
      throw error
    })
    capturePosthogEvent({ distinctId: userId, event: input.save && post.status !== "published" ? "project_entry_saved" : "project_entry_updated", properties: {
      project_id: projectId, entry_id: entryId, revision: updated.updated_at.getTime(), creation_origin: post.creation_origin,
      ...summarizeContentForAnalytics(content ?? currentDocument?.content),
    } })
    return this.representation(updated, userId)
  }

  async shareSelection(projectId: number, entryId: number, userId: number, circleId: number) {
    const entry = await this.entry(projectId, entryId)
    await this.assertShareAuthor(entry, userId)
    await this.circleAccess.requireMember(circleId, userId)
    const { source } = await this.selectionSource(entry, userId)
    return buildEntryShareManifest(source, circleId)
  }

  private async assertShareAuthor(entry: Entry, userId: number) {
    if (entry.status !== "published" || !(await canEditProjectEntry(this.prisma, entry, userId))) throw new ForbiddenException("Save your own project entry before sharing")
  }

  private async selectionSource(entry: Entry, userId: number) {
    const document = await this.prisma.document.findFirst({ where: { docable_type: "Post", docable_id: entry.id } })
    const saved = await this.prisma.entry.findMany({ where: { project_id: entry.project_id, user_id: userId, source_entry_id: entry.id, status: "published", creation_origin: "project_feedback", source_reply_id: { not: null }, room_id: null }, orderBy: { id: "asc" } })
    const feedback: EntryShareFeedback[] = []
    const snapshots = new Map<number, Entry>()
    for (const item of saved) {
      const reply = item.source_reply_id ? await this.prisma.reply.findUnique({ where: { id: item.source_reply_id }, include: { entry: true } }) : null
      const originalRoomId = item.source_room_id ?? reply?.entry?.room_id ?? null
      const access = originalRoomId ? await this.circleAccess.resolve(originalRoomId, userId) : null
      const originalAvailable = await feedbackSourceAvailable(this.prisma, item, reply, originalRoomId)
      const savedDocument = await this.prisma.document.findFirst({ where: { docable_type: "Post", docable_id: item.id } })
      snapshots.set(item.id, item)
      feedback.push({ id: item.id, originalRoomId, originalRoomIds: entryFeedbackOrigins(item), sourceSharedEntryId: item.source_shared_entry_id, sourceReplyId: item.source_reply_id, sourceAuthorId: item.source_author_id ?? reply?.user_id,
        authorized: Boolean(originalAvailable && access?.kind === "member"), authorName: item.source_author_name || "Former member",
        content: (entryBody(savedDocument?.content)) as TiptapDoc, format: parseEntryFormat(item.format), format_data: parseEntryFormatData(item.format_data),
      })
    }
    const source: EntryShareSource = {
      revision: "pending", content: (entryBody(document?.content)) as TiptapDoc,
      format: parseEntryFormat(entry.format), format_data: parseEntryFormatData(entry.format_data), intent: entry.project_intent, question: entry.project_question, lyrics: entry.project_lyrics, feedback,
    }
    source.revision = sharingRevision({ entryId: entry.id, updatedAt: entry.updated_at, documentVersion: document?.version, source, provenance: entryFeedbackOrigins(entry) })
    return { source, snapshots }
  }

  async findShare(projectId: number, entryId: number, userId: number, key: string) {
    const entry = await this.entry(projectId, entryId)
    await this.assertShareAuthor(entry, userId)
    const requestKey = shareRequestKey(key)
    if (!requestKey) throw new BadRequestException("Choose a sharing request")
    const post = await this.prisma.entry.findUnique({ where: { user_id_share_request_key: { user_id: userId, share_request_key: requestKey } } })
    if (!post) return null
    if (post.source_entry_id !== entryId || post.status === "deleted" || !post.room_id) throw new NotFoundException("This shared copy is unavailable")
    await this.circleAccess.requireMember(post.room_id, userId)
    return { entry_id: post.id, room_id: post.room_id, round_id: post.round_id ?? undefined,
      creation_origin: ["round_activity_cover", "round_activity_response"].includes(post.creation_origin ?? "") ? post.creation_origin : undefined }
  }

  async shareDraft(projectId: number, entryId: number, userId: number, input: ProjectShareInput) {
    const entry = await this.entry(projectId, entryId)
    if (entry.status !== "published" || !(await canEditProjectEntry(this.prisma, entry, userId))) throw new ForbiddenException("Save your own material before sharing")
    const requestKey = shareRequestKey(input.request_key)
    if (input.selected_unit_ids !== undefined && (!requestKey || typeof input.source_revision !== "string")) throw new BadRequestException("Review this entry before choosing what to share")
    const fingerprint = sharingRevision({ projectId, entryId, input })
    const circleId = this.id(input.room_id, "Circle")
    const access = await this.circleAccess.requireMember(circleId, userId)
    if (!access.canWriteWall) throw new ForbiddenException("This circle is not accepting posts")
    if (requestKey) {
      await this.assertShareAuthor(entry, userId)
      const existing = await this.prisma.entry.findUnique({ where: { user_id_share_request_key: { user_id: userId, share_request_key: requestKey } } })
      if (existing) return this.existingShare(existing, fingerprint)
    }
    assertEntryFeedbackRoom(entry, circleId)
    const activityId = input.round_id == null ? null : this.id(input.round_id, "Activity")
    const activity = activityId ? await this.prisma.round.findUnique({ where: { id: activityId } }) : null
    if (activityId && (!activity || activity.room_id !== circleId)) throw new BadRequestException("Choose a activity from this circle")
    if (input.creation_origin !== undefined && !["round_activity_cover", "round_activity_response"].includes(input.creation_origin)) throw new BadRequestException("Unknown contribution step")
    if (input.creation_origin && !activityId) throw new BadRequestException("Choose an Activity for this contribution")
    if (activityId) {
      if (input.creation_origin) await this.rounds.validateActivitySubmission(activityId, userId, input.creation_origin)
      else await this.rounds.validateActivitySubmission(activityId, userId)
    }
    await this.assertShareAuthor(entry, userId)
    return this.createSelectedShare(entry, userId, circleId, activity, input, requestKey ?? randomUUID(), fingerprint)
  }

  private existingShare(post: Entry, fingerprint: string) {
    if (post.share_request_fingerprint !== fingerprint) throw new ConflictException("This share request was already used for a different selection")
    if (post.status === "deleted") throw new ConflictException("This shared draft was removed. Start a new share")
    return { entry_id: post.id, path: post.status === "published" ? `/app/entries/${post.id}` : `/app/new-entry?draftId=${post.id}` }
  }

  private async createSelectedShare(entry: Entry, userId: number, circleId: number, activity: Activity | null, input: ProjectShareInput, requestKey: string, fingerprint: string) {
    if (input.selected_node_indices !== undefined || input.intent !== undefined || input.question !== undefined || input.include_image !== undefined || input.include_lyrics !== undefined) throw new BadRequestException("Choose source units from the current entry preview")
    const { source, snapshots } = await this.selectionSource(entry, userId)
    let selected
    try {
      const units = input.selected_unit_ids ?? buildEntryShareManifest(source, circleId).units.filter(unit => unit.kind !== "feedback" && unit.eligible).map(unit => unit.id)
      selected = selectEntryShare(source, circleId, { revision: input.source_revision ?? source.revision, unitIds: units })
    } catch (error) {
      if (error instanceof EntryShareSelectionError) {
        if (error.code === "stale") throw new ConflictException(error.message)
        throw new BadRequestException(error.message)
      }
      throw error
    }
    const roomStatement = this.framing(input.room_statement, "Room statement")
    // Statement does not contribute to the nonempty source requirement. Feedback is a whole source unit.
    const validationContent = { type: "doc", content: [...(selected.content.content || []), ...selected.feedback.flatMap(item => item.content.content || [])] }
    if (activity) validateRoundEntryContent(activity, input.creation_origin, validationContent, selected.format, selected.format_data)
    else validateEntryPublication(validationContent, selected.format, selected.format_data)
    const request = activity
      ? parseEntryFeedbackRequest(activity)
      : feedbackRequestFromDefaults(await roomFeedbackSettings(this.prisma, circleId))
    const { replyMode, requestedFeedbackTypes: feedbackTypes, ideaGuidance } = request
    let created = false
    const result = await this.prisma.$transaction(async tx => {
      await lockMentionReferenceAccess(tx, this.circleAccess, [validationContent], userId, circleId, [circleId])
      if (activity) {
        await this.rounds.validateActivitySubmission(activity.id, userId, input.creation_origin, tx)
        const currentRound = await tx.round.findUnique({ where: { id: activity.id } })
        if (!currentRound || currentRound.updated_at.getTime() !== activity.updated_at.getTime()) throw new ConflictException("This Round changed. Review your contribution again.")
      }
      await lockProjectEntryEditAccess(tx, entry, userId)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`entry-share:${userId}:${requestKey}`}))`
      const existing = await tx.entry.findUnique({ where: { user_id_share_request_key: { user_id: userId, share_request_key: requestKey } } })
      if (existing) return this.existingShare(existing, fingerprint)
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${entry.id} FOR SHARE`
      const current = await tx.entry.findUnique({ where: { id: entry.id } })
      if (!current || current.status !== "published" || current.updated_at.getTime() !== entry.updated_at.getTime()) {
        throw new ConflictException("This Entry changed before sharing. Review it again.")
      }
      for (const feedback of [...selected.feedback].sort((a, b) => a.id - b.id)) {
        const prepared = snapshots.get(feedback.id)!
        await tx.$queryRaw`SELECT id FROM entries WHERE id = ${prepared.id} FOR SHARE`
        const saved = await tx.entry.findUnique({ where: { id: prepared.id } })
        if (!saved || saved.status !== "published" || saved.updated_at.getTime() !== prepared.updated_at.getTime() || saved.source_reply_id !== prepared.source_reply_id || saved.source_shared_entry_id !== prepared.source_shared_entry_id) {
          throw new ConflictException("Saved feedback changed before sharing. Review it again.")
        }
        assertEntryFeedbackRoom(saved, circleId)
        // Chat conversions lock the message before its attachment Entry. Keep that order.
        if (saved.source_shared_entry_id) await tx.$queryRaw`SELECT id FROM chat_messages WHERE entry_id = ${saved.source_shared_entry_id} FOR SHARE`
        if (saved.source_shared_entry_id) await tx.$queryRaw`SELECT id FROM entries WHERE id = ${saved.source_shared_entry_id} FOR SHARE`
        if (saved.source_reply_id) await tx.$queryRaw`SELECT id FROM replies WHERE id = ${saved.source_reply_id} FOR SHARE`
        const reply = saved.source_reply_id ? await tx.reply.findUnique({ where: { id: saved.source_reply_id }, include: { entry: true } }) : null
        if (!(await feedbackSourceAvailable(tx, saved, reply, circleId))) throw new ForbiddenException("Feedback is no longer available for sharing")
      }
      const authorizedContent = await authorizeMentionReferences(tx, this.circleAccess, selected.content as Prisma.InputJsonValue, userId, circleId)
      const authorizedFeedback = new Map<number, Prisma.InputJsonValue>()
      for (const feedback of selected.feedback) authorizedFeedback.set(feedback.id,
        await authorizeMentionReferences(tx, this.circleAccess, feedback.content as Prisma.InputJsonValue, userId, circleId))
      const now = new Date()
      const post = await tx.entry.create({ data: {
        user_id: userId, room_id: circleId, round_id: activity?.id ?? null, project_id: null,
        source_entry_id: entry.id, status: "draft", format: "mixed_media", creation_origin: input.creation_origin ?? null,
        source_room_ids: entryFeedbackOrigins(entry), room_statement: roomStatement, share_request_key: requestKey, share_request_fingerprint: fingerprint,
        reply_mode: replyMode, requested_feedback_types: replyMode === "guided" ? feedbackTypes : [], idea_guidance: replyMode === "guided" ? ideaGuidance : null,
        created_at: now, updated_at: now,
      } })
      const snapshot = await this.uploads.copyContentSnapshot(userId, { sourceType: "Post", sourceId: entry.id }, post.id, authorizedContent, selected.format_data, tx)
      const sharedFeedback: SharedFeedbackSnapshot[] = []
      for (const feedback of selected.feedback) {
        const saved = snapshots.get(feedback.id)!
        assertEntryFeedbackRoom(saved, circleId)
        const copied = await this.uploads.copyContentSnapshot(userId, { sourceType: "Post", sourceId: saved.id }, post.id, authorizedFeedback.get(feedback.id)!, feedback.format_data ?? null, tx)
        sharedFeedback.push({ source_reply_id: saved.source_reply_id, source_shared_entry_id: saved.source_shared_entry_id, source_room_id: circleId, source_author_id: feedback.sourceAuthorId ?? null,
          author_name: feedback.authorName, original_room_ids: [...new Set([circleId, ...(feedback.originalRoomIds || [])])],
          content: copied.content as TiptapDoc, format: "mixed_media", format_data: parseEntryFormatData(copied.formatData),
        })
      }
      const content = this.content(snapshot.content)
      await tx.document.create({ data: { docable_type: "Post", docable_id: post.id, content: content as Prisma.InputJsonValue, version: 1, created_at: now, updated_at: now } })
      await tx.entry.update({ where: { id: post.id }, data: { format_data: snapshot.formatData as Prisma.InputJsonValue,
        shared_feedback: sharedFeedback as unknown as Prisma.InputJsonValue, source_room_ids: [...new Set([...entryFeedbackOrigins(entry), ...sharedFeedback.flatMap(item => item.original_room_ids)])], updated_at: now } })
      created = true
      return { entry_id: post.id, path: `/app/new-entry?draftId=${post.id}` }
    }, { timeout: 30_000 })
    if (created) capturePosthogEvent({ distinctId: userId, event: "entry_share_prepared", properties: {
      project_id: entry.project_id, source_entry_id: entry.id, entry_id: result.entry_id, room_id: circleId,
      activity_id: activity?.id ?? null, selected_unit_count: selected.content.content?.length ?? 0,
      feedback_count: selected.feedback.length,
    } })
    return result
  }

  async replyKeeps(projectId: number, userId: number, sharedId: number) {
    await this.assertMember(projectId, userId)
    const shared = await this.prisma.entry.findUnique({ where: { id: sharedId } })
    if (!shared || shared.user_id !== userId || !shared.room_id || shared.status !== "published") throw new NotFoundException("Discussion not found")
    await this.circleAccess.requireMember(shared.room_id, userId)
    if (!await this.sourceEntryInProject(projectId, shared.source_entry_id)) throw new NotFoundException("Private source unavailable")
    const saved = await this.prisma.entry.findMany({ where: { project_id: projectId, user_id: userId, source_shared_entry_id: sharedId, creation_origin: "project_feedback", status: "published" }, select: { source_reply_id: true, format_data: true } })
    return { groups: saved.filter(item => item.source_reply_id).map(item => ({ reply_ids: this.savedReplyIds(item) })) }
  }

  private savedReplyIds(item: { source_reply_id: number | null; format_data: unknown }): number[] {
    const data = parseEntryFormatData(item.format_data)
    return Array.isArray(data?.saved_reply_ids) ? data.saved_reply_ids.filter((id): id is number => Number.isSafeInteger(id)) : item.source_reply_id ? [item.source_reply_id] : []
  }

  async toggleReplyKeep(projectId: number, userId: number, sharedId: number, ids: number[], saved: boolean) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || typeof saved !== "boolean") throw new BadRequestException("Choose valid replies")
    await this.replyKeeps(projectId, userId, sharedId)
    let keptEntryId: number | undefined
    let removedCount = 0
    await this.prisma.$transaction(async tx => {
      await lockProjectAccess(tx, projectId, userId)
      const shared = await tx.entry.findUnique({ where: { id: sharedId } })
      if (!shared?.source_entry_id || shared.user_id !== userId || !shared.room_id) throw new NotFoundException("Discussion not found")
      await this.circleAccess.requireMemberInTransaction(tx, shared.room_id, userId)
      for (const id of [sharedId, shared.source_entry_id].sort((a, b) => a - b)) await tx.$queryRaw`SELECT id FROM entries WHERE id = ${id} FOR UPDATE`
      const current = await tx.entry.findUnique({ where: { id: sharedId } })
      const sourceId = await this.sourceEntryInProject(projectId, shared.source_entry_id, tx)
      if (!sourceId || current?.status !== "published" || current.user_id !== userId || current.source_entry_id !== shared.source_entry_id || current.room_id !== shared.room_id) throw new NotFoundException("Private source unavailable")
      const existing = await tx.entry.findMany({ where: { project_id: projectId, user_id: userId, source_shared_entry_id: sharedId, creation_origin: "project_feedback", status: "published" } })
      const overlapping = existing.filter(item => this.savedReplyIds(item).some(id => ids.includes(id)))
      if (saved && overlapping.length === 1) {
        const retained = this.savedReplyIds(overlapping[0])
        if (retained.length === ids.length && ids.every(id => retained.includes(id))) return
      }
      removedCount = overlapping.length
      // Toggle-off removes only retained feedback, never the original replies.
      for (const item of overlapping) await tx.entry.update({ where: { id: item.id }, data: { status: "deleted", source_reply_id: null, updated_at: new Date() } })
      if (!saved) { await tx.project.update({ where: { id: projectId }, data: { updated_at: new Date() } }); return }
      const replies: Prisma.ReplyGetPayload<{ include: { user: true } }>[] = []
      for (const id of [...ids].sort((a, b) => a - b)) {
        await tx.$queryRaw`SELECT id FROM replies WHERE id = ${id} FOR SHARE`
        await tx.$queryRaw`SELECT id FROM documents WHERE docable_type = 'Reply' AND docable_id = ${id} FOR SHARE`
        const reply = await tx.reply.findUnique({ where: { id }, include: { user: true } })
        if (!reply || reply.entry_id !== sharedId || reply.status !== "published") throw new NotFoundException("Reply unavailable")
        replies.push(reply)
      }
      if (replies.some(reply => reply.user_id !== replies[0].user_id)) throw new BadRequestException("Choose one author's message card")
      replies.sort((a, b) => (a.published_at?.getTime() ?? a.created_at.getTime()) - (b.published_at?.getTime() ?? b.created_at.getTime()) || a.id - b.id)
      const author = replies[0]
      const membership = author.user_id ? await tx.roomMembership.findFirst({ where: { room_id: shared.room_id, user_id: author.user_id, disabled: false }, select: { username_override: true } }) : null
      const now = new Date()
      const kept = await tx.entry.create({ data: { project_id: projectId, user_id: userId, status: "draft", format: "mixed_media", creation_origin: "project_feedback", locked: true,
        source_entry_id: sourceId, source_shared_entry_id: sharedId, source_room_id: shared.room_id, source_room_ids: [...new Set([shared.room_id, ...entryFeedbackOrigins(shared)])], source_author_id: author.user_id,
        source_author_name: membership?.username_override || author.user?.username || "Former member", created_at: now, updated_at: now } })
      const content: TiptapDoc = { type: "doc", content: [] }
      for (const reply of replies) {
        const document = await tx.document.findFirst({ where: { docable_type: "Reply", docable_id: reply.id } })
        const snapshot = await this.uploads.copyContentSnapshot(userId, { sourceType: "Reply", sourceId: reply.id }, kept.id, document?.content ?? DEFAULT_TIPTAP_DOC, null, tx)
        content.content!.push(...((snapshot.content as TiptapDoc).content ?? []))
      }
      await this.storeSnapshot(kept.id, content, { saved_reply_ids: replies.map(reply => reply.id) }, tx)
      await tx.entry.update({ where: { id: kept.id }, data: { source_reply_id: replies[0].id, status: "published", published_at: now } })
      keptEntryId = kept.id
      await tx.project.update({ where: { id: projectId }, data: { updated_at: now } })
    })
    if (keptEntryId || removedCount) capturePosthogEvent({ distinctId: userId, event: keptEntryId ? "project_feedback_kept" : "project_feedback_removed", properties: {
      project_id: projectId, entry_id: keptEntryId, source_shared_entry_id: sharedId,
      reply_count: ids.length, replaced_snapshot_count: keptEntryId ? removedCount : 0,
      removed_snapshot_count: keptEntryId ? 0 : removedCount,
    } })
    return this.replyKeeps(projectId, userId, sharedId)
  }

  async keep(projectId: number, userId: number, replyId: number) {
    await this.assertMember(projectId, userId)
    this.id(replyId, "Reply")
    const existing = await this.prisma.entry.findFirst({
      where: { project_id: projectId, user_id: userId, source_reply_id: replyId, creation_origin: "project_feedback", status: "published" }, include: { user: true },
    })
    if (existing) return { ...await this.representation(existing, userId), already_saved: true }
    const reply = await this.prisma.reply.findUnique({ where: { id: replyId }, include: { entry: true, user: true } })
    if (!reply || reply.status !== "published" || reply.entry?.status !== "published" || !reply.entry.room_id) throw new NotFoundException("Feedback not found")
    // Sharing a unit does not grant its project members access to the circle discussion.
    await this.circleAccess.requireMember(reply.entry.room_id, userId)
    const sourceEntryId = await this.sourceEntryInProject(projectId, reply.entry.source_entry_id)
    if (reply.entry.user_id === userId && !sourceEntryId) {
      throw new BadRequestException("This entry has no available source in this project. Feedback cannot be assigned to a different entry.")
    }
    const membership = reply.user_id ? await this.prisma.roomMembership.findFirst({
      where: { room_id: reply.entry.room_id, user_id: reply.user_id, disabled: false }, select: { username_override: true },
    }) : null
    const document = await this.prisma.document.findFirst({ where: { docable_type: "Reply", docable_id: reply.id } })
    return this.keepSnapshot(projectId, userId, {
      source: { sourceType: "Reply", sourceId: reply.id }, content: document?.content ?? DEFAULT_TIPTAP_DOC,
      identity: { source_reply_id: reply.id }, sourceEntryId, sourceSharedEntryId: reply.entry.id,
      sourceRoomId: reply.entry.room_id, sourceAuthorId: reply.user_id, sourceRoomIds: entryFeedbackOrigins(reply.entry),
      authorName: membership?.username_override || reply.user?.username || "Former member",
      validateSource: async tx => {
        const parent = reply.entry!
        // Preserve Chat conversion's message-before-Post order for historical attachments.
        if (parent.creation_origin === "chat_attachment") await tx.$queryRaw`SELECT id FROM chat_messages WHERE entry_id = ${parent.id} FOR SHARE`
        for (const id of [...new Set([parent.id, ...(sourceEntryId ? [sourceEntryId] : [])])].sort((a, b) => a - b)) {
          await tx.$queryRaw`SELECT id FROM entries WHERE id = ${id} FOR SHARE`
        }
        await tx.$queryRaw`SELECT id FROM replies WHERE id = ${reply.id} FOR SHARE`
        await tx.$queryRaw`SELECT id FROM documents WHERE docable_type = 'Reply' AND docable_id = ${reply.id} FOR SHARE`
        const current = await tx.reply.findUnique({ where: { id: reply.id }, include: { entry: true, user: true } })
        if (!(await feedbackSourceAvailable(tx, { source_shared_entry_id: parent.id }, current, parent.room_id))) throw new NotFoundException("Feedback not found")
        const currentDocument = await tx.document.findFirst({ where: { docable_type: "Reply", docable_id: reply.id } })
        if (!isDeepStrictEqual({ ...current, user: null }, { ...reply, user: null }) || !isDeepStrictEqual(currentDocument, document)) {
          throw new ConflictException("This feedback changed before saving. Review it again.")
        }
        if (sourceEntryId && !(await this.sourceEntryInProject(projectId, sourceEntryId, tx))) {
          throw new ConflictException("The source Entry is no longer available in this Project.")
        }
      },
    })
  }

  async keepChatMessage(projectId: number, userId: number, messageId: number) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { owner_id: true } })
    if (project?.owner_id !== userId) throw new NotFoundException("Owned project not found")
    this.id(messageId, "Message")
    const existing = await this.prisma.entry.findFirst({
      where: { project_id: projectId, user_id: userId, source_chat_message_id: messageId, creation_origin: "project_feedback", status: "published" }, include: { user: true },
    })
    if (existing) return { ...await this.representation(existing, userId), already_saved: true }
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId, AND: availableChatMessageWhere(new Date()) }, include: { author: true, entry: true } })
    if (!message || message.status !== "published" || message.timeline_kind !== "message") throw new NotFoundException("Message not found")
    await this.circleAccess.requireMember(message.room_id, userId)
    const membership = await this.prisma.roomMembership.findFirst({
      where: { room_id: message.room_id, user_id: message.author_id, disabled: false }, select: { username_override: true },
    })
    // Older converted messages can own their media through the linked published post.
    // Never follow a private Project, cross-circle or unpublished reference into a snapshot.
    const linkedEntry = message.entry?.status === "published" && message.entry.project_id == null && message.entry.room_id === message.room_id ? message.entry : null
    const document = linkedEntry ? await this.prisma.document.findFirst({ where: { docable_type: "Post", docable_id: linkedEntry.id } }) : null
    return this.keepSnapshot(projectId, userId, {
      source: linkedEntry ? { sourceType: "Post", sourceId: linkedEntry.id } : { sourceType: "ChatMessage", sourceId: message.id },
      content: linkedEntry ? document?.content ?? chatMessageDocument(message.body, message.content) : chatMessageDocument(message.body, message.content),
      format: linkedEntry?.format, formatData: linkedEntry?.format_data,
      sourceSharedEntryId: linkedEntry?.id,
      sourceRoomId: message.room_id, sourceAuthorId: message.author_id, sourceRoomIds: linkedEntry ? entryFeedbackOrigins(linkedEntry) : [],
      identity: { source_chat_message_id: message.id }, authorName: membership?.username_override ?? message.author.username,
      validateSource: async tx => {
        // Match Chat conversion's message-before-attachment lock order.
        await tx.$queryRaw`SELECT id FROM chat_messages WHERE id = ${message.id} FOR SHARE`
        if (linkedEntry) {
          await tx.$queryRaw`SELECT id FROM entries WHERE id = ${linkedEntry.id} FOR SHARE`
          await tx.$queryRaw`SELECT id FROM documents WHERE docable_type = 'Post' AND docable_id = ${linkedEntry.id} FOR SHARE`
        }
        const current = await tx.chatMessage.findUnique({ where: { id: message.id, AND: availableChatMessageWhere(new Date()) }, include: { author: true, entry: true } })
        if (!current || current.timeline_kind !== "message") throw new NotFoundException("Message not found")
        if (!isDeepStrictEqual({ ...current, author: null }, { ...message, author: null })) {
          throw new ConflictException("This message changed before saving. Review it again.")
        }
        if (linkedEntry) {
          const currentDocument = await tx.document.findFirst({ where: { docable_type: "Post", docable_id: linkedEntry.id } })
          if (!isDeepStrictEqual(currentDocument, document)) throw new ConflictException("This message changed before saving. Review it again.")
        }
      },
    })
  }

  private async sourceEntryInProject(projectId: number, entryId?: number | null, database: Prisma.TransactionClient = this.prisma) {
    if (!entryId) return undefined
    const candidate = await database.entry.findUnique({ where: { id: entryId }, select: { id: true, project_id: true, status: true, creation_origin: true, room_id: true } })
    return candidate && candidate.project_id === projectId && candidate.status === "published" && candidate.creation_origin === "project_material" && isProjectEntry(candidate) ? candidate.id : undefined
  }

  /** Feedback and chat use the same immutable, independently authorized project snapshot. */
  private async keepSnapshot(projectId: number, userId: number, input: {
    source: { sourceType: "Post" | "Reply" | "ChatMessage"; sourceId: number }
    content: unknown
    format?: string
    formatData?: unknown
    identity: { source_reply_id: number; source_chat_message_id?: never } | { source_chat_message_id: number; source_reply_id?: never }
    sourceEntryId?: number
    sourceSharedEntryId?: number
    authorName: string
    sourceRoomId: number
    sourceAuthorId?: number | null
    sourceRoomIds?: number[]
    validateSource?: (tx: Prisma.TransactionClient) => Promise<void>
  }) {
    const now = new Date()
    try {
      const saved = await this.prisma.$transaction(async tx => {
        await this.circleAccess.requireMemberInTransaction(tx, input.sourceRoomId, userId)
        await lockProjectAccess(tx, projectId, userId)
        if (input.identity.source_chat_message_id !== undefined) {
          const project = await tx.project.findUnique({ where: { id: projectId }, select: { owner_id: true } })
          if (project?.owner_id !== userId) throw new NotFoundException("Owned project not found")
        }
        await input.validateSource?.(tx)
        const post = await tx.entry.create({
          data: {
            project_id: projectId, user_id: userId, status: "draft", format: input.format ?? "mixed_media", creation_origin: "project_feedback", locked: true,
            source_entry_id: input.sourceEntryId, source_shared_entry_id: input.sourceSharedEntryId, source_author_name: input.authorName,
            source_room_id: input.sourceRoomId, source_room_ids: [...new Set([input.sourceRoomId, ...(input.sourceRoomIds || [])])], source_author_id: input.sourceAuthorId,
            created_at: now, updated_at: now,
          },
          include: { user: true },
        })
        const snapshot = await this.uploads.copyContentSnapshot(userId, input.source, post.id, input.content, input.formatData ?? null, tx)
        await this.storeSnapshot(post.id, snapshot.content, snapshot.formatData, tx)
        const saved = await tx.entry.update({
          where: { id: post.id }, data: { ...input.identity, status: "published", published_at: now, updated_at: now }, include: { user: true },
        })
        await tx.project.update({ where: { id: projectId }, data: { updated_at: now } })
        return saved
      })
      capturePosthogEvent({ distinctId: userId, event: "project_feedback_kept", properties: {
        project_id: projectId, entry_id: saved.id, source_entry_id: input.sourceEntryId,
        source_shared_entry_id: input.sourceSharedEntryId, room_id: input.sourceRoomId,
        source_type: input.source.sourceType, ...summarizeContentForAnalytics(input.content),
      } })
      return { ...await this.representation(saved, userId), already_saved: false }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.prisma.entry.findFirst({ where: { project_id: projectId, user_id: userId, ...input.identity, creation_origin: "project_feedback", status: "published" }, include: { user: true } })
        if (winner) return { ...await this.representation(winner, userId), already_saved: true }
      }
      throw error
    }
  }

  private async entry(projectId: number, entryId: number) {
    this.id(projectId, "Project")
    this.id(entryId, "Material")
    const post = await this.prisma.entry.findUnique({ where: { id: entryId }, include: { user: true } })
    if (!post || post.project_id !== projectId || post.status === "deleted" || !isProjectEntry(post)) throw new NotFoundException("Material not found")
    return post
  }

  private async representation(post: Entry & { user: { id: number; username: string } }, userId: number) {
    const document = await this.prisma.document.findFirst({ where: { docable_type: "Post", docable_id: post.id } })
    const [content] = await presentImageDocuments(this.prisma, [normalizeUploadUrls(entryBody(document?.content))])
    const copies = post.creation_origin === "project_material"
      ? await projectCopyPage(this.prisma, post.project_id!, post.id, userId)
      : { submissions: [], nextCursor: null }
    const sourceReply = post.source_reply_id ? await this.prisma.reply.findUnique({ where: { id: post.source_reply_id }, select: { status: true, entry: { select: { status: true, room_id: true } } } }) : null
    const sourceMessage = post.source_chat_message_id ? await this.prisma.chatMessage.findUnique({ where: { id: post.source_chat_message_id }, select: { status: true, room_id: true } }) : null
    const sourceRoomId = sourceMessage?.room_id ?? sourceReply?.entry?.room_id
    const sourceAccess = sourceRoomId ? await this.circleAccess.resolve(sourceRoomId, userId) : null
    const sourceAvailable = sourceAccess?.kind === "member" && (sourceMessage?.status === "published" || (sourceReply?.status === "published" && sourceReply.entry?.status === "published"))
    const canEdit = post.creation_origin === "project_material" && post.user_id === userId
    return {
      id: post.id, automated_creation: post.automated_creation, kind: post.creation_origin === "project_feedback" ? "feedback" as const : "material" as const,
      author: { id: post.user.id, username: post.user.username }, created_at: post.created_at.toISOString(), updated_at: post.updated_at.toISOString(),
      status: post.status, draft: post.status === "draft", content, format: post.format, format_data: normalizeUploadUrls(post.format_data),
      intent: post.project_intent, question: post.project_question, lyrics: post.project_lyrics,
      source_entry_id: post.source_entry_id, source_shared_entry_id: post.source_shared_entry_id, source_reply_id: post.source_reply_id,
      source_chat_message_id: post.source_chat_message_id, source_room_id: sourceAvailable ? sourceRoomId : null,
      source_author_name: post.source_author_name, source_author_id: post.source_author_id, source_available: post.creation_origin !== "project_feedback" || Boolean(sourceAvailable),
      can_edit: canEdit, can_share: canEdit && post.status === "published",
      submissions: copies.submissions,
      submissions_next_cursor: copies.nextCursor,
    }
  }

  private async storeSnapshot(postId: number, contentInput: unknown, formatDataInput: unknown, tx: Prisma.TransactionClient) {
    const content = this.content(contentInput)
    const formatData = parseEntryFormatData(formatDataInput)
    const now = new Date()
    await tx.document.upsert({
      where: { docable_type_docable_id: { docable_type: "Post", docable_id: postId } },
      create: { docable_type: "Post", docable_id: postId, content: content as Prisma.InputJsonValue, version: 1, created_at: now, updated_at: now },
      update: { content: content as Prisma.InputJsonValue, ydoc_state: null, version: { increment: 1 }, updated_at: now },
    })
    await tx.entry.update({ where: { id: postId }, data: { format_data: formatData ? formatData as Prisma.InputJsonValue : Prisma.DbNull, updated_at: now } })
  }

  private async assertMember(projectId: number, userId: number) {
    if (!(await canViewProject(this.prisma, projectId, userId))) throw new NotFoundException("Project not found")
  }

  private content(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as { type?: unknown }).type !== "doc" || !Array.isArray((value as { content?: unknown }).content)) throw new BadRequestException("Material must be a document")
    if (findUnsupportedMediaSrcs(value).length) throw new BadRequestException("Media must be uploaded before saving material")
    return normalizeUploadUrls(value)
  }

  private framing(value: unknown, label: string): string | null {
    if (value == null || value === "") return null
    if (typeof value !== "string") throw new BadRequestException(`${label} must be text`)
    if (value.length > 50000) throw new BadRequestException(`${label} is too long`)
    return value.trim() || null
  }

  private id(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new BadRequestException(`${label} is required`)
    return value
  }
}
