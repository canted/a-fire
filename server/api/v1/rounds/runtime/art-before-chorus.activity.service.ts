import { selectCoverPair } from "../cover-assignment"
import { roomEntryRoomId } from "../../entries/room-entry-scope"
import { serializeRoundCover } from "./round-cover-presentation"
import { roundRoomId } from "../round-scope"
import { notifyRoomChanged } from "../../../../realtime/room-change"
import { roundPath } from "../../../../../types/round-links"
import { RoomAccessService } from "../../rooms/room-access.service"
import { isDeepStrictEqual } from "node:util"
import { sharedEntryPresentation } from "../../entries/shared-entry-presentation"
import { assertRoomEntrySource, roomEntryValidationContent } from "../../entries/room-entry-policy"
import { lockRound, publishRoundWall } from "../publish-round-wall"
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { Prisma, type Round as Activity } from "@prisma/client"
import { PrismaService } from "../../../../prisma/prisma.service"
import { BossService } from "../../../../queue/boss.service"
import { syncRoundChat } from "../round-chat"
import type { RoomAccessKind } from "../../rooms/room-access.service"
import { parseEntryFormat, parseEntryFormatData } from "../../entries/entry-formats"
import { validateRoundEntryContent } from "../../entries/entry-content"
import { entryBody } from "../../entries/post-content"
import { postFormatDataVariantUrls } from "../../uploads/upload-urls"
import {
  ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS,
  parseArtBeforeChorusConfig,
} from "./round-template.definition"
import type {
  ArtBeforeChorusRoundState,
  RoundArtifactInput,
  RoundChoiceInput,
  RoundCoverPayload,
  RoundPhase,
  RoundRemovalInput,
  RoundResponsePayload,
} from "./round-runtime.types"

const ART_BEFORE_CHORUS = "art_before_chorus"
const COVER_ORIGIN = "round_activity_cover"
const RESPONSE_ORIGIN = "round_activity_response"

type RoundRecord = Pick<
  Activity,
  | "id"
  | "name"
  | "room_id"
  | "host_id"
  | "status"
  | "template_key"
  | "template_config"
  | "updated_at"
  | "submit_by"
  | "feedback_due_at"
  | "closed_at"
>

@Injectable()
export class ArtBeforeChorusRoundService {
  async syncChat(activityId: number, db: Prisma.TransactionClient = this.prisma, now = new Date()) {
    const activity = await db.round.findUnique({ where: { id: activityId } })
    if (!activity) return
    const covers = await db.activityArtifact.findMany({
      where: { round_id: activityId, kind: "cover", status: "active" },
      orderBy: [{ submitted_at: "asc" }, { id: "asc" }], select: { submitted_at: true },
    })
    const minimumCover = covers[ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS - 1]
    return syncRoundChat(db, activityId, now, {
      label: "Audio responses started",
      at: minimumCover && activity.submit_by ? new Date(Math.max(activity.submit_by.getTime(), minimumCover.submitted_at.getTime())) : null,
    })
  }
  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(BossService)
  private readonly boss!: BossService

  phase(activity: RoundRecord, now = new Date()): RoundPhase {
    if (activity.status === "draft") return "upcoming"
    if (activity.status === "archived" || activity.status === "cancelled" || activity.closed_at) return "complete"
    if (activity.feedback_due_at && activity.feedback_due_at.getTime() <= now.getTime()) return "complete"
    if (activity.submit_by && activity.submit_by.getTime() <= now.getTime()) return "collecting_responses"
    return "collecting_covers"
  }

  async prepareForDetail(activity: RoundRecord, userId: number, accessKind: RoomAccessKind) {
    const phase = this.phase(activity)
    if (phase === "complete") {
      await this.finalize(activity.id)
      return
    }
    if (phase !== "collecting_responses" || accessKind !== "member") return

    const participation = await this.activeParticipation(activity.id, userId)
    if (!participation) return
    const cover = await this.prisma.activityArtifact.findUnique({
      where: { round_id_user_id_kind: { round_id: activity.id, user_id: userId, kind: "cover" } },
      select: { id: true, status: true },
    })
    if (cover?.status === "active") await this.ensureOffer(activity.id, userId)
  }

  async detail(activity: RoundRecord, userId: number, accessKind: RoomAccessKind): Promise<ArtBeforeChorusRoundState> {
    const scheduledPhase = this.phase(activity)
    const revealComplete = scheduledPhase === "complete" && activity.status !== "cancelled"
    const isHost = Number(activity.host_id) === Number(userId) && accessKind === "member"
    const participations = await this.prisma.activityParticipation.findMany({
      where: { round_id: activity.id, status: "active", role: "participant" },
      include: { user: true },
      orderBy: [{ joined_at: "asc" }, { id: "asc" }],
    })
    const storedArtifacts = await this.prisma.activityArtifact.findMany({
      where: { round_id: activity.id, status: "active" },
      include: { entry: true, user: true },
      orderBy: [{ submitted_at: "asc" }, { id: "asc" }],
    })
    const retainedArtifacts = storedArtifacts.filter(artifact =>
      artifact.entry.status !== "deleted" && !artifact.entry.project_id && Boolean(activity.room_id) &&
      roomEntryRoomId(artifact.entry) === activity.room_id,
    )
    const artifacts = accessKind === "member" ? retainedArtifacts : retainedArtifacts.filter(artifact =>
      artifact.entry.status === "published",
    )
    const postIds = artifacts.map((artifact) => Number(artifact.entry_id))
    const documents = postIds.length
      ? await this.prisma.document.findMany({
          where: { docable_type: "Post", docable_id: { in: postIds } },
          select: { docable_id: true, content: true },
        })
      : []
    const documentMap = new Map(documents.map((document) => [Number(document.docable_id), document.content] as const))
    const covers = artifacts.filter((artifact) => artifact.kind === "cover")
    const responses = artifacts.filter((artifact) => artifact.kind === "response")
    const remainingCovers = Math.max(0, ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS - covers.length)
    const waitingPastSchedule = scheduledPhase === "collecting_responses" && remainingCovers > 0
    const phase = waitingPastSchedule ? "collecting_covers" : scheduledPhase
    const coverById = new Map(covers.map((cover) => [Number(cover.id), cover] as const))
    const coverByUserId = new Map(covers.map((cover) => [Number(cover.user_id), cover] as const))
    const responseByUserId = new Map(responses.map((response) => [Number(response.user_id), response] as const))
    const viewerCover = coverByUserId.get(userId)
    const viewerResponse = responseByUserId.get(userId)
    const offer = accessKind === "member" ? await this.prisma.activityOffer.findUnique({
      where: { round_id_user_id: { round_id: activity.id, user_id: userId } },
    }) : null
    const participantOffers = isHost
      ? ((await this.prisma.activityOffer.findMany({ where: { round_id: activity.id } })) ?? [])
      : offer
        ? [offer]
        : []
    const offerByUserId = new Map(
      participantOffers.map((participantOffer) => [Number(participantOffer.user_id), participantOffer] as const),
    )
    const chosenCover = offer?.chosen_artifact_id ? coverById.get(Number(offer.chosen_artifact_id)) : undefined
    const offered = offer
      ? [coverById.get(Number(offer.first_artifact_id)), coverById.get(Number(offer.second_artifact_id))]
      : []
    const offeredCovers = offered.length === 2 && offered.every(Boolean)
      ? (offered.map((cover) => serializeRoundCover(cover!, false, documentMap.get(Number(cover!.entry_id)))) as [RoundCoverPayload, RoundCoverPayload])
      : undefined

    const participants = participations.map((participation) => {
      const cover = coverByUserId.get(Number(participation.user_id))
      const response = responseByUserId.get(Number(participation.user_id))
      const participantOffer = offerByUserId.get(Number(participation.user_id))
      return {
        id: String(participation.id),
        userId: String(participation.user_id),
        name: participation.user.username,
        avatarUrl: null,
        hasCover: Boolean(cover),
        ...(cover && (isHost || revealComplete || Number(participation.user_id) === userId)
          ? { cover: serializeRoundCover(cover, isHost || revealComplete, documentMap.get(Number(cover.entry_id))) }
          : {}),
        responseStatus: response
          ? ("submitted" as const)
          : participantOffer?.chosen_artifact_id
            ? ("making" as const)
            : ("choosing" as const),
      }
    })

    const results = revealComplete
      ? responses.flatMap((response) => {
          const cover = response.source_artifact_id ? coverById.get(Number(response.source_artifact_id)) : undefined
          if (!cover) return []
          return [{
            cover: serializeRoundCover(cover, true, documentMap.get(Number(cover.entry_id))),
            response: this.serializeResponse(response, documentMap.get(Number(response.entry_id))),
          }]
        })
      : []

    return {
      key: ART_BEFORE_CHORUS,
      phase,
      isHost,
      config: parseArtBeforeChorusConfig(activity.template_config),
      coverProgress: {
        submitted: covers.length,
        minimum: ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS,
        remaining: remainingCovers,
        waitingPastSchedule,
      },
      participants,
      viewer: accessKind === "visitor" ? {} : {
        ...(viewerCover ? { cover: serializeRoundCover(viewerCover, revealComplete, documentMap.get(Number(viewerCover.entry_id))) } : {}),
        ...(offeredCovers ? { offeredCovers } : {}),
        ...(chosenCover ? { chosenCover: serializeRoundCover(chosenCover, revealComplete, documentMap.get(Number(chosenCover.entry_id))) } : {}),
        ...(viewerResponse
          ? { response: this.serializeResponse(viewerResponse, documentMap.get(Number(viewerResponse.entry_id))) }
          : {}),
      },
      results,
    }
  }

  async validateDraft(activity: RoundRecord, userId: number, creationOrigin: string | null | undefined, transaction?: Prisma.TransactionClient) {
    const database = transaction ?? this.prisma
    if (activity.status !== "active") throw new BadRequestException("Activity is not accepting contributions")
    const phase = this.phase(activity)
    const coverCount =
      phase === "collecting_responses"
        ? await database.activityArtifact.count({
            where: { round_id: activity.id, kind: "cover", status: "active" },
          })
        : ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS
    const waitingForMinimumCovers =
      phase === "collecting_responses" && coverCount < ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS
    if (creationOrigin === COVER_ORIGIN && phase !== "collecting_covers" && !waitingForMinimumCovers) {
      throw new BadRequestException("This Activity is no longer collecting cover art")
    }
    if (creationOrigin === RESPONSE_ORIGIN && (phase !== "collecting_responses" || waitingForMinimumCovers)) {
      throw new BadRequestException("This Activity is not collecting responses")
    }
    if (creationOrigin !== COVER_ORIGIN && creationOrigin !== RESPONSE_ORIGIN) {
      throw new BadRequestException("Choose a contribution from the Activity page")
    }

    const participation = await this.requireContributionParticipation(activity, userId, database)
    if (creationOrigin === RESPONSE_ORIGIN) {
      const offer = await database.activityOffer.findUnique({
        where: { round_id_user_id: { round_id: activity.id, user_id: userId } },
      })
      if (!offer?.chosen_artifact_id) throw new BadRequestException("Choose a cover before making a response")
    }
    return { round: activity, participation }
  }

  async submitArtifact(activity: RoundRecord, userId: number, input: RoundArtifactInput) {
    const kind = input.kind === "cover" || input.kind === "response" ? input.kind : null
    if (!kind) throw new BadRequestException("Unknown Activity contribution")
    const postId = this.positiveInteger(input.entryId ?? input.entry_id, "postId")
    const expectedOrigin = kind === "cover" ? COVER_ORIGIN : RESPONSE_ORIGIN
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    if (!post || post.status !== "draft" || Number(post.user_id) !== userId || Number(post.round_id) !== activity.id) {
      throw new ForbiddenException("Forbidden")
    }
    if (post.room_id !== activity.room_id) throw new ForbiddenException("This work belongs to another Room")
    await this.validateDraft(activity, userId, expectedOrigin)
    if (post.creation_origin !== expectedOrigin) throw new BadRequestException("This draft belongs to another Activity step")

    await assertRoomEntrySource(this.prisma, post)
    const document = await this.prisma.document.findUnique({
      where: { docable_type_docable_id: { docable_type: "Post", docable_id: post.id } }, select: { content: true, version: true },
    })
    const content = entryBody(document?.content)
    const parts = validateRoundEntryContent(activity, expectedOrigin, roomEntryValidationContent(post, content, activity.room_id ?? undefined), post.format, post.format_data)
    let sourceArtifactId: number | null = null
    let preparedCover: Prisma.ActivityArtifactGetPayload<{ include: { entry: true } }> | null = null
    const nextFormat = parseEntryFormat(post.format)
    let nextFormatData = parseEntryFormatData(post.format_data)
    if (kind === "cover") {
      // The Activity thumbnail is derived from the same entry, without rewriting its body.
      nextFormatData = { ...(nextFormatData ?? {}), image_url: parts.images[0] }
    } else {
      const offer = await this.prisma.activityOffer.findUnique({
        where: { round_id_user_id: { round_id: activity.id, user_id: userId } },
      })
      if (!offer?.chosen_artifact_id) throw new BadRequestException("Choose a cover before submitting")
      sourceArtifactId = Number(offer.chosen_artifact_id)
      const cover = await this.prisma.activityArtifact.findUnique({
        where: { id: sourceArtifactId },
        include: { entry: true },
      })
      if (!cover || cover.status !== "active" || cover.round_id !== activity.id || cover.kind !== "cover") {
        throw new BadRequestException("The chosen cover is no longer available")
      }
      preparedCover = cover

    }

    const now = new Date()
    const artifact = await this.prisma.$transaction(async (tx) => {
      if (!activity.room_id) throw new ForbiddenException("Room access is required")
      await this.circleAccess.requireMemberInTransaction(tx, activity.room_id, userId)
      await lockRound(tx, activity.id)
      const current = await tx.round.findUniqueOrThrow({ where: { id: activity.id } })
      if (current.status !== "active" || this.phase(current) === "complete") throw new BadRequestException("This round has completed")
      if (current.updated_at?.getTime() !== activity.updated_at?.getTime()) {
        throw new ConflictException("This Round changed. Review your contribution again.")
      }
      await tx.$queryRaw`SELECT id FROM round_participations WHERE round_id = ${activity.id} AND user_id = ${userId} FOR SHARE`
      await this.requireContributionParticipation(current, userId, tx)
      await tx.$queryRaw`SELECT id FROM entries WHERE id = ${post.id} FOR UPDATE`
      const currentEntry = await tx.entry.findUnique({ where: { id: post.id } })
      if (!currentEntry || currentEntry.status !== "draft" || currentEntry.user_id !== post.user_id || currentEntry.round_id !== post.round_id || currentEntry.room_id !== post.room_id || currentEntry.creation_origin !== post.creation_origin || currentEntry.updated_at?.getTime() !== post.updated_at?.getTime()) {
        throw new ConflictException("Your work changed. Review your contribution again.")
      }
      await tx.$queryRaw`SELECT id FROM documents WHERE docable_type = 'Post' AND docable_id = ${post.id} FOR UPDATE`
      const currentDocument = await tx.document.findUnique({
        where: { docable_type_docable_id: { docable_type: "Post", docable_id: post.id } }, select: { content: true, version: true },
      })
      if (Boolean(currentDocument) !== Boolean(document) || currentDocument?.version !== document?.version || !isDeepStrictEqual(currentDocument?.content, document?.content)) {
        throw new ConflictException("Your work changed. Review your contribution again.")
      }
      if (preparedCover) {
        // Choice mutations share the Round lock; retain the artwork until commit too.
        await tx.$queryRaw`SELECT id FROM round_activity_offers WHERE round_id = ${activity.id} AND user_id = ${userId} FOR SHARE`
        const currentOffer = await tx.activityOffer.findUnique({ where: { round_id_user_id: { round_id: activity.id, user_id: userId } } })
        await tx.$queryRaw`SELECT id FROM round_activity_artifacts WHERE id = ${preparedCover.id} FOR SHARE`
        await tx.$queryRaw`SELECT id FROM entries WHERE id = ${preparedCover.entry_id} FOR SHARE`
        const currentCover = await tx.activityArtifact.findUnique({ where: { id: preparedCover.id }, include: { entry: true } })
        if (currentOffer?.chosen_artifact_id !== sourceArtifactId || !currentCover || currentCover.status !== "active" || currentCover.kind !== "cover" || currentCover.round_id !== activity.id || currentCover.entry_id !== preparedCover.entry_id || currentCover.entry.status === "deleted" || currentCover.entry.status !== preparedCover.entry.status || currentCover.entry.updated_at?.getTime() !== preparedCover.entry.updated_at?.getTime() || !isDeepStrictEqual(currentCover.entry.format_data, preparedCover.entry.format_data)) {
          throw new ConflictException("The chosen cover changed. Review your contribution again.")
        }
      }
      if (kind === "cover" && this.phase(current) === "collecting_responses" && await tx.activityArtifact.count({ where: { round_id: activity.id, kind: "cover", status: "active" } }) >= ART_BEFORE_CHORUS_MINIMUM_PARTICIPANTS) throw new BadRequestException("This round is no longer collecting cover art")
      const existing = await tx.activityArtifact.findUnique({
        where: { round_id_user_id_kind: { round_id: activity.id, user_id: userId, kind } },
      })
      if (existing && existing.entry_id !== post.id) {
        await tx.entry.updateMany({ where: { id: existing.entry_id, status: "draft" }, data: { status: "deleted", updated_at: now } })
      }
      if (nextFormat !== post.format || nextFormatData !== post.format_data) {
        await tx.entry.update({
          where: { id: post.id },
          data: { format: nextFormat, format_data: nextFormatData as Prisma.InputJsonValue, updated_at: now },
        })
      }
      const submitted = await tx.activityArtifact.upsert({
        where: { round_id_user_id_kind: { round_id: activity.id, user_id: userId, kind } },
        create: {
          round_id: activity.id,
          user_id: userId,
          entry_id: post.id,
          kind,
          status: "active",
          source_artifact_id: sourceArtifactId,
          submitted_at: now,
          removed_at: null,
          created_at: now,
          updated_at: now,
        },
        update: {
          entry_id: post.id,
          status: "active",
          source_artifact_id: sourceArtifactId,
          submitted_at: now,
          removed_at: null,
          updated_at: now,
        },
      })
      await this.syncChat(activity.id, tx, now)
      await notifyRoomChanged(tx, activity.room_id)
      return submitted
    })
    return { id: String(artifact.id), kind: artifact.kind, submittedAt: artifact.submitted_at.toISOString() }
  }

  async chooseCover(activity: RoundRecord, userId: number, input: RoundChoiceInput) {
    const coverId = this.positiveInteger(input.coverId ?? input.cover_id, "coverId")
    const updated = await this.prisma.$transaction(async tx => {
      if (!activity.room_id) throw new ForbiddenException("Room access is required")
      await this.circleAccess.requireMemberInTransaction(tx, activity.room_id, userId)
      await lockRound(tx, activity.id)
      const current = await tx.round.findUniqueOrThrow({ where: { id: activity.id } })
      if (current.status !== "active" || this.phase(current) !== "collecting_responses") throw new BadRequestException("Cover choices are closed")
      await tx.$queryRaw`SELECT id FROM round_participations WHERE round_id = ${activity.id} AND user_id = ${userId} FOR SHARE`
      if (!(await this.activeParticipation(activity.id, userId, tx))) throw new ForbiddenException("Join this Activity before choosing")
      const offer = await this.ensureOffer(activity.id, userId, tx)
      if (!offer || ![offer.first_artifact_id, offer.second_artifact_id].map(Number).includes(coverId)) throw new BadRequestException("Choose one of the two covers offered to you")
      await tx.$queryRaw`SELECT id FROM round_activity_artifacts WHERE id = ${coverId} FOR SHARE`
      const cover = await tx.activityArtifact.findUnique({ where: { id: coverId } })
      if (!cover || cover.status !== "active" || cover.kind !== "cover" || cover.round_id !== current.id || cover.user_id === userId) throw new BadRequestException("The chosen cover is no longer available")
      if (offer.chosen_artifact_id === coverId) return offer
      const chosen = await tx.activityOffer.update({ where: { id: offer.id }, data: { chosen_artifact_id: coverId, updated_at: new Date() } })
      await notifyRoomChanged(tx, activity.room_id)
      return chosen
    })
    return { chosenCoverId: String(updated.chosen_artifact_id) }
  }

  async removeCover(activity: RoundRecord, userId: number, input: RoundRemovalInput) {
    if (Number(activity.host_id) !== userId) throw new ForbiddenException("Forbidden")
    if (this.phase(activity) !== "collecting_covers") throw new BadRequestException("Covers can only be removed while they are being collected")
    const artifactId = this.positiveInteger(input.artifactId ?? input.artifact_id, "artifactId")
    const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 2_000) : null
    const notify = input.sendPushNotification === true || input.send_push_notification === true
    const now = new Date()
    let notificationStatus = notify ? "unavailable" : "not_requested"
    await this.prisma.$transaction(async (tx) => {
      if (!activity.room_id) throw new ForbiddenException("Room access is required")
      const access = await this.circleAccess.requireMemberInTransaction(tx, activity.room_id, userId)
      if (!access.canManage) throw new ForbiddenException("Circle manager only")
      await lockRound(tx, activity.id)
      const current = await tx.round.findUniqueOrThrow({ where: { id: activity.id } })
      if (Number(current.host_id) !== userId) throw new ForbiddenException("Forbidden")
      if (current.status !== "active" || this.phase(current) !== "collecting_covers") throw new BadRequestException("Covers can only be removed while they are being collected")
      const artifact = await tx.activityArtifact.findFirst({ where: { id: artifactId, round_id: current.id, kind: "cover", status: "active" } })
      if (!artifact) throw new NotFoundException("Cover not found")
      await tx.activityArtifact.update({
        where: { id: artifact.id },
        data: { status: "removed", removed_at: now, updated_at: now },
      })
      await tx.entry.updateMany({ where: { id: artifact.entry_id, status: "draft" }, data: { status: "deleted", updated_at: now } })
      if (notify && current.room_id) {
        const event = await tx.notificationEvent.create({
          data: {
            event_type: "round_contribution_removed",
            actor_id: userId,
            room_id: current.room_id,
            target_user_id: artifact.user_id,
            payload: { round_id: activity.id, activity_name: current.name, note },
            target_path: roundPath(activity.id),
            created_at: now,
            updated_at: now,
          },
        })
        await this.boss.enqueueInTransaction(tx, "notifications.fanout", { eventId: Number(event.id) })
        notificationStatus = "queued"
      }
      await tx.activityModerationEvent.create({
        data: {
          round_id: activity.id,
          artifact_id: artifact.id,
          actor_id: userId,
          action: "removed",
          note,
          notification_requested: notify,
          notification_status: notificationStatus,
          created_at: now,
        },
      })
      await notifyRoomChanged(tx, activity.room_id)
    })
    return { removed: true, notificationStatus }
  }

  async finalize(activityId: number, force = false, authorize?: (tx: Prisma.TransactionClient) => Promise<void>) {
    const activity = await this.prisma.round.findUnique({ where: { id: activityId } })
    if (
      !activity ||
      activity.template_key !== ART_BEFORE_CHORUS ||
      activity.status !== "active" ||
      (!force && this.phase(activity) !== "complete")
    ) return
    const observed = activity
    await this.prisma.$transaction(async (tx) => {
      await authorize?.(tx)
      await lockRound(tx, activityId)
      const activity = await tx.round.findUnique({ where: { id: activityId } })
      if (!activity || activity.status !== "active" || activity.template_key !== ART_BEFORE_CHORUS) return
      if (activity.room_id !== observed.room_id) throw new ConflictException("This Round changed. Review it before ending.")
      if (!force && this.phase(activity) !== "complete") return
      const now = activity.feedback_due_at && activity.feedback_due_at.getTime() <= Date.now() ? activity.feedback_due_at : new Date()
      const claimed = await tx.round.updateMany({
        where: { id: activity.id, status: "active" },
        data: { status: "archived", closed_at: activity.closed_at ?? now, updated_at: now },
      })
      if (claimed.count === 0) return
      const responses = await tx.activityArtifact.findMany({
        where: { round_id: activity.id, kind: "response", status: "active", entry: { status: { in: ["draft", "published"] } } },
        include: { entry: true, source_artifact: { include: { entry: true, user: true } } },
      })

      // Acquire Entry rows in a stable order independently of legacy positions.
      responses.sort((left, right) => left.entry_id - right.entry_id)
      for (const response of responses) {
        const attribution = response.source_artifact
          ? {
              template_key: ART_BEFORE_CHORUS,
              cover_artifact_id: response.source_artifact.id,
              cover_contributor_id: response.source_artifact.user_id,
              cover_contributor_name: response.source_artifact.user.username,
              cover_label: `Cover art from ${response.source_artifact.user.username}`,
            }
          : null
        const formatData = {
          ...(parseEntryFormatData(response.entry.format_data) ?? {}),
          ...(attribution ? { round_attribution: attribution } : {}),
        }
        const publication = await tx.entry.updateMany({
          where: { id: response.entry_id, status: { in: ["draft", "published"] } },
          data: { status: "published", published_at: response.entry.published_at ?? now, format_data: formatData, updated_at: now },
        })
        if (publication.count === 0) continue
        const document = await tx.document.findUnique({ where: { docable_type_docable_id: { docable_type: "Post", docable_id: response.entry_id } } })
        if (!document) throw new Error(`Missing document for activity contribution ${response.entry_id}`)
        const participation = await tx.activityParticipation.findUnique({
          where: { round_id_user_id: { round_id: activity.id, user_id: response.user_id } },
        })
        if (participation) {
          if (participation.submitted_entry_id && participation.submitted_entry_id !== response.entry_id) {
            await tx.activitySubmission.updateMany({
              where: { round_id: activity.id, user_id: response.user_id, entry_id: participation.submitted_entry_id, superseded_at: null },
              data: { superseded_at: now, updated_at: now },
            })
          }
          const existingRecord = await tx.activitySubmission.findFirst({
            where: { round_id: activity.id, entry_id: response.entry_id, superseded_at: null },
          })
          if (!existingRecord) {
            await tx.activitySubmission.create({
              data: {
                round_id: activity.id,
                activity_participation_id: participation.id,
                entry_id: response.entry_id,
                user_id: response.user_id,
                submitted_at: response.submitted_at,
                created_at: now,
                updated_at: now,
              },
            })
          }
          await tx.activityParticipation.update({
            where: { id: participation.id },
            data: { submitted_entry_id: response.entry_id, updated_at: now },
          })
        }
      }
      // Final responses and their single Wall announcement commit together.
      await this.syncChat(activityId, tx, new Date())
      await publishRoundWall(tx, activityId)
    })
  }

  private async requireContributionParticipation(activity: RoundRecord, userId: number, database: Prisma.TransactionClient) {
    const participation = await this.activeParticipation(activity.id, userId, database)
    if (!participation) throw new ForbiddenException("Join this Activity before contributing")
    // Historical participation identity never substitutes for current Room access.
    const roomId = roundRoomId(activity)
    if (roomId) {
      const access = await this.circleAccess.resolve(roomId, userId, new Date(), database)
      if (access?.kind !== "member") throw new ForbiddenException("Members only")
    } else {
      throw new ForbiddenException("Room access is required")
    }
    return participation
  }

  private async activeParticipation(activityId: number, userId: number, database: Prisma.TransactionClient = this.prisma) {
    return database.activityParticipation.findFirst({
      where: { round_id: activityId, user_id: userId, role: "participant", status: "active" },
    })
  }

  private async ensureOffer(activityId: number, userId: number, database: Prisma.TransactionClient = this.prisma) {
    const existing = await database.activityOffer.findUnique({
      where: { round_id_user_id: { round_id: activityId, user_id: userId } },
    })
    if (existing) return existing
    const covers = await selectCoverPair(database, activityId, userId)
    if (covers.length < 2) return null
    const now = new Date()
    return database.activityOffer.upsert({
      where: { round_id_user_id: { round_id: activityId, user_id: userId } },
      create: {
        round_id: activityId, user_id: userId,
        first_artifact_id: Number(covers[0].id), second_artifact_id: Number(covers[1].id),
        created_at: now, updated_at: now,
      },
      // A retry retains the first committed offer and any existing choice.
      update: { round_id: activityId },
    })
  }

  private serializeResponse(
    artifact: { id: number; entry_id: number; source_artifact_id: number | null; entry: { format: string; format_data: unknown; room_statement?: string | null; shared_feedback?: unknown }; user: { username: string } },
    content: unknown,
  ): RoundResponsePayload {
    return {
      id: String(artifact.id),
      entryId: String(artifact.entry_id),
      ...sharedEntryPresentation(artifact.entry),
      creatorName: artifact.user.username,
      avatarUrl: null,
      format: parseEntryFormat(artifact.entry.format),
      formatData: postFormatDataVariantUrls(parseEntryFormatData(artifact.entry.format_data), "w1200"),
      content: content ?? { type: "doc", content: [{ type: "paragraph", content: [] }] },
      coverId: String(artifact.source_artifact_id ?? ""),
    }
  }

  private positiveInteger(value: unknown, name: string) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException(`${name} is required`)
    return parsed
  }
}
