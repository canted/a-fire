import { reflectionSummaryScope } from "../reflections/reflection-summary-scope"
import { projectNavigationCandidate } from "./project-navigation-candidate"
import { entryReplyRoundSummaries } from "./room-reply-summary"
import { entryMembershipMap, serializeEntryUser } from "./entry-user-presentation"
import { availableChatAttachmentEntryIds } from "../../v2/rooms/chat-visibility"
import { roomEntryRoomId } from "./room-entry-scope"
import { entryContentPresentation, sharedEntryPresentation } from "./shared-entry-presentation"
import { canManageEntryDraft, canReadRoundDraft } from "./entry-draft-access"
import { canEditProjectEntry, canViewProject, isProjectEntry } from "../projects/project-access"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import { extractPlainText } from "../../../realtime/document-content"
import { RoomAccessService, type RoomAccessKind, type RoomAccessContext } from "../rooms/room-access.service"
import { normalizeReplyFeedbackType, serializeEntryFeedbackRequest } from "../feedback-settings"
import { LinkPreviewsService } from "../link-previews/link-previews.service"
import { identityImageUrl } from "../uploads/identity-images"
import { presentImageDocuments } from "../uploads/image-presentation"
import { uploadVariantUrl } from "../uploads/upload-urls"
import {
  DEFAULT_TIPTAP_DOC,
  normalizeUploadUrls,
  entryBody,
  recordValue,
  truncateText,
} from "./post-content"
import { parseEntryFormat, parseEntryFormatData } from "./entry-formats"
import { deriveEntrySubject, serializeStoredEntrySubject, type EntrySubjectPayload } from "./entry-subjects"
import type { MembershipMap, EntryListItem, EntryShow, EntryShowResponse, ReplyPayload } from "./entries.types"

const DEFAULT_PAGE_SIZE = 200

const MAX_PAGE_SIZE = 500

type ReflectionRow = {
  page_id: number
  user_id?: number | null
  page?: { title?: string | null; icon?: string | null; deleted_at?: Date | string | null } | null
}

function summarizeReflections(reflections: ReflectionRow[], viewerUserId: number) {
  const grouped = new Map<number, { page_title: string | null; page_icon: string | null; count: number; mine: boolean }>()
  reflections.forEach((reflection) => {
    if (!reflection.page || reflection.page.deleted_at) return
    const current = grouped.get(reflection.page_id) ?? {
      page_title: reflection.page?.title ?? null,
      page_icon: reflection.page?.icon ?? null,
      count: 0,
      mine: false,
    }
    grouped.set(reflection.page_id, {
      page_title: current.page_title,
      page_icon: current.page_icon,
      count: current.count + 1,
      mine: current.mine || reflection.user_id === viewerUserId,
    })
  })

  return Array.from(grouped.entries()).map(([page_id, data]) => ({
    page_id,
    page_title: data.page_title,
    page_icon: data.page_icon,
    count: data.count,
    mine: data.mine,
  }))
}

function pageFrom(value?: string): number {
  const parsed = Number(value ?? 1)
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed
}

function perPageFrom(value?: string): number {
  const parsed = Number(value ?? DEFAULT_PAGE_SIZE)
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE
  return Math.min(parsed, MAX_PAGE_SIZE)
}

/** Reads and presents post lists, details, and drafts with caller-specific access. */
@Injectable()
export class EntriesReadService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(LinkPreviewsService)
  private readonly linkPreviews!: LinkPreviewsService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  async listPosts(roomId: number | null, userId: number): Promise<EntryListItem[]> {
    if (roomId) await this.circleAccess.requireMember(roomId, userId)

    const memberships = await this.prisma.roomMembership.findMany({
      where: { user_id: userId, disabled: false, revoked_at: null, room: { deleted_at: null } },
      select: { room_id: true },
    })
    const communityIds = roomId ? [roomId] : memberships.map((membership) => membership.room_id)
    if (!roomId && communityIds.length === 0) return []

    const candidates = await this.prisma.entry.findMany({
      where: {
        status: "published",
        room_id: { in: communityIds },
      },
      include: { user: true },
      orderBy: [{ published_at: "desc" }, { created_at: "desc" }, { id: "desc" }],
      take: 200,
    })
    const scoped = candidates.filter(post => {
      if (isProjectEntry(post)) return false
      const hasRoomScope = post.room_id != null
      return hasRoomScope ? roomEntryRoomId(post) !== null : post.user_id === userId
    })
    const availableAttachments = await availableChatAttachmentEntryIds(this.prisma, scoped.flatMap(post => {
      const roomId = roomEntryRoomId(post)
      return post.creation_origin === "chat_attachment" && roomId ? [{ entryId: post.id, roomId }] : []
    }))
    const posts = scoped.filter(post => post.creation_origin !== "chat_attachment" || availableAttachments.has(post.id))
    const membershipMap = await this.membershipMapForPostList(posts)

    const postIds = posts.map((post) => Number(post.id ?? 0)).filter(Boolean)
    const [documents, replies] = await Promise.all([
      postIds.length
        ? this.prisma.document.findMany({
            where: { docable_type: "Post", docable_id: { in: postIds } },
          })
        : [],
      entryReplyRoundSummaries(this.prisma, postIds),
    ])
    const documentMap = new Map(documents.map((doc) => [Number(doc.docable_id ?? 0), doc.content] as const))
    const contentSummaryMap = new Map<
      number,
      { entryId: number; excerpt: string; subject: EntrySubjectPayload; mediaType: EntryListItem["mediaType"] | null }
    >()
    posts.forEach((post) => {
      const postId = Number(post.id ?? 0)
      const content = entryBody(documentMap.get(postId))
      const excerpt = extractPlainText(content)
      const subject = deriveEntrySubject(content)
      contentSummaryMap.set(postId, {
        entryId: postId,
        excerpt,
        subject,
        mediaType: this.mediaTypeForSubject(subject),
      })
    })
    const mediaFilenameMap = await this.mediaFilenameMapForPostList(
      Array.from(contentSummaryMap.values()).map((summary) => ({ entryId: summary.entryId, subject: summary.subject })),
    )
    const replySummaryMap = new Map<number, { count: number; latestAt: Date | null }>()
    replies.forEach((reply) => {
      replySummaryMap.set(reply.entry_id, { count: Number(reply.reply_count), latestAt: reply.latest_at })
    })

    return posts
      .map((post) => {
        const postId = Number(post.id ?? 0)
        const postAt = post.published_at ?? post.created_at
        const replySummary = replySummaryMap.get(postId) ?? { count: 0, latestAt: null }
        const activeAt = replySummary.latestAt && replySummary.latestAt > postAt ? replySummary.latestAt : postAt
        const contentSummary =
          contentSummaryMap.get(postId) ?? {
            entryId: postId,
            excerpt: "",
            subject: deriveEntrySubject(DEFAULT_TIPTAP_DOC),
            mediaType: null,
          }
        const { excerpt, mediaType, subject } = contentSummary
        const mediaFilenameKey = this.mediaFilenameKeyForSubject(subject, postId)
        const mediaFilename = mediaFilenameKey ? mediaFilenameMap.get(mediaFilenameKey) : undefined
        const fallbackTitle = mediaType ? this.mediaTitle(mediaType, mediaFilename) : "Untitled post"
        const title = excerpt ? truncateText(excerpt, 96) : fallbackTitle
        const communityId = this.communityIdForPost(post)
        const membership = membershipMap.get(`${Number(post.user_id ?? 0)}:${communityId ?? ""}`)
        const displayUsername = membership?.displayUsername ?? post.user?.username ?? undefined

        return {
          id: String(post.id),
          title,
          body: excerpt ? truncateText(excerpt, 180) : undefined,
          createdAt: post.created_at.toISOString(),
          publishedAt: post.published_at?.toISOString() ?? null,
          activeAt: activeAt.toISOString(),
          replyCount: replySummary.count,
          displayUsername,
          displayAvatarUrl: membership?.displayAvatarUrl ?? null,
          ...(excerpt ? {} : mediaType ? { mediaType } : {}),
        }
      })
      .sort((left, right) => Date.parse(right.activeAt ?? "") - Date.parse(left.activeAt ?? ""))
  }

  private async membershipMapForPostList(
    posts: Array<{
      user_id?: number | string | null
      room_id?: number | string | null
    }>,
  ): Promise<MembershipMap> {
    const userIdsByRoom = new Map<number, Set<number>>()
    posts.forEach((post) => {
      const communityId = this.communityIdForPost(post)
      const userId = Number(post.user_id ?? 0)
      if (!communityId || !userId) return
      const userIds = userIdsByRoom.get(communityId) ?? new Set<number>()
      userIds.add(userId)
      userIdsByRoom.set(communityId, userIds)
    })

    const maps = await Promise.all(
      Array.from(userIdsByRoom.entries()).map(([communityId, userIds]) =>
        entryMembershipMap(this.prisma, communityId, Array.from(userIds)),
      ),
    )
    const combined: MembershipMap = new Map()
    maps.forEach((map) => {
      map.forEach((value, key) => combined.set(key, value))
    })
    return combined
  }

  private communityIdForPost(post: {
    room_id?: number | string | null
  }) {
    const communityId = Number(post.room_id ?? 0)
    return communityId || null
  }

  private mediaTypeForSubject(subject: EntrySubjectPayload): EntryListItem["mediaType"] | null {
    if (subject.type === "audio_asset") return "audio"
    if (subject.type === "video_asset") return "video"
    if (subject.type === "image") return "image"
    return null
  }

  private mediaLabel(mediaType: NonNullable<EntryListItem["mediaType"]>) {
    if (mediaType === "audio") return "Audio"
    if (mediaType === "video") return "Video"
    return "Image"
  }

  private mediaTitle(mediaType: NonNullable<EntryListItem["mediaType"]>, filename?: string | null) {
    const label = this.mediaLabel(mediaType)
    const cleanFilename = filename?.trim()
    return cleanFilename ? truncateText(`${label} - ${cleanFilename}`, 96) : label
  }

  private async mediaFilenameMapForPostList(
    subjects: Array<{ entryId: number; subject: EntrySubjectPayload }>,
  ): Promise<Map<string, string>> {
    const postIds = new Set<number>()
    const audioIds = new Set<number>()
    const videoIds = new Set<number>()
    const imageBlobIds = new Set<number>()

    subjects.forEach(({ entryId: postId, subject }) => {
      if (!postId) return
      postIds.add(postId)
      if (subject.type === "audio_asset") {
        const id = Number(subject.id ?? 0)
        if (id) audioIds.add(id)
        return
      }
      if (subject.type === "video_asset") {
        const id = Number(subject.id ?? 0)
        if (id) videoIds.add(id)
        return
      }
      if (subject.type === "image") {
        const blobId = this.uploadBlobIdFromSubject(subject)
        if (blobId) imageBlobIds.add(blobId)
      }
    })

    const postIdList = Array.from(postIds)
    if (postIdList.length === 0) return new Map()

    const [audioAssets, videoAssets, imageBlobs] = await Promise.all([
      audioIds.size
        ? this.prisma.audioAsset.findMany({
            where: { id: { in: Array.from(audioIds) }, source_type: "Post", source_id: { in: postIdList } },
            select: { id: true, source_id: true, original_filename: true },
          })
        : [],
      videoIds.size
        ? this.prisma.videoAsset.findMany({
            where: { id: { in: Array.from(videoIds) }, source_type: "Post", source_id: { in: postIdList } },
            select: { id: true, source_id: true, original_filename: true },
          })
        : [],
      imageBlobIds.size
        ? this.prisma.activeStorageAttachment.findMany({
            where: {
              record_type: "Post",
              record_id: { in: postIdList },
              blob_id: { in: Array.from(imageBlobIds) },
              name: "image",
            },
            select: {
              record_id: true,
              blob_id: true,
              active_storage_blobs: { select: { filename: true } },
            },
          })
        : [],
    ])

    const filenames = new Map<string, string>()
    audioAssets.forEach((asset) => {
      const filename = asset.original_filename?.trim()
      if (filename) filenames.set(`audio_asset:${Number(asset.source_id ?? 0)}:${Number(asset.id ?? 0)}`, filename)
    })
    videoAssets.forEach((asset) => {
      const filename = asset.original_filename?.trim()
      if (filename) filenames.set(`video_asset:${Number(asset.source_id ?? 0)}:${Number(asset.id ?? 0)}`, filename)
    })
    imageBlobs.forEach((attachment) => {
      const filename = attachment.active_storage_blobs?.filename?.trim()
      if (filename) {
        filenames.set(`image:${Number(attachment.record_id ?? 0)}:${Number(attachment.blob_id ?? 0)}`, filename)
      }
    })
    return filenames
  }

  private mediaFilenameKeyForSubject(subject: EntrySubjectPayload, postId: number) {
    if (subject.type === "audio_asset") {
      const id = Number(subject.id ?? 0)
      return id ? `audio_asset:${postId}:${id}` : null
    }
    if (subject.type === "video_asset") {
      const id = Number(subject.id ?? 0)
      return id ? `video_asset:${postId}:${id}` : null
    }
    if (subject.type === "image") {
      const blobId = this.uploadBlobIdFromSubject(subject)
      return blobId ? `image:${postId}:${blobId}` : null
    }
    return null
  }

  private uploadBlobIdFromSubject(subject: EntrySubjectPayload) {
    const preview = subject.preview
    const previewSrc =
      preview && typeof preview === "object" && !Array.isArray(preview) && typeof preview.src === "string"
        ? preview.src
        : null
    const source = typeof subject.key === "string" ? subject.key : previewSrc
    if (typeof source !== "string") return null
    const match = source.match(/\/api\/v1\/uploads\/(\d+)(?:\/|$)/)
    if (!match) return null
    return Number(match[1] ?? 0) || null
  }

  async fetchEntry(postId: number, userId: number, page?: string, perPage?: string): Promise<EntryShowResponse> {
    const post = await this.prisma.entry.findUnique({
      where: { id: postId },
      include: { user: true, subject: true, project: true, round: true },
    })
    if (!post || post.status === "deleted") throw new NotFoundException("Not Found")
    if (isProjectEntry(post)) throw new ForbiddenException("Project material is available through its project")

    const communityId = roomEntryRoomId(post)
    if (!communityId && post.user_id !== userId) throw new ForbiddenException("Unscoped legacy Entries are private to their author")
    let canWithdraw = false
    let accessKind: RoomAccessKind = "member"
    if (communityId) {
      const access = await this.circleAccess.require(communityId, userId)
      accessKind = access.kind
      canWithdraw = access.kind === "member" && post.status === "published"
        && post.creation_origin !== "chat_attachment" && (post.user_id === userId || access.canManage)
      if (access.kind === "visitor" || post.creation_origin === "chat_attachment") await this.assertReadableRoomPost(post, access)
    }
    if (post.status !== "published"
      && !(await canManageEntryDraft(this.prisma, this.circleAccess, post, userId))
      && !(await canReadRoundDraft(this.prisma, this.circleAccess, post, userId))) {
      throw new ForbiddenException("Draft Entry is not available to this viewer")
    }
    const visitor = accessKind === "visitor"
    const sourceEntry = post.source_entry_id
      ? await this.prisma.entry.findUnique({ where: { id: post.source_entry_id }, include: { project: true } })
      : null
    const associatedProjectId = post.project_id ?? (isProjectEntry(sourceEntry) ? sourceEntry!.project_id : null)
    const visibleProjectId = associatedProjectId && await canViewProject(this.prisma, associatedProjectId, userId)
      ? associatedProjectId
      : null
    const visibleProject = visibleProjectId ? post.project ?? sourceEntry?.project : null
    const keepProjectId = !visitor && post.user_id === userId && isProjectEntry(sourceEntry) && sourceEntry!.status === "published"
      ? visibleProjectId
      : null

    const contentDoc = await this.prisma.document.findFirst({
      where: { docable_type: "Post", docable_id: post.id },
    })

    const [fallbackCommunity, adjacentPosts, projectIcon, chatSource] = await Promise.all([
      communityId
        ? this.prisma.room.findUnique({
            where: { id: communityId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      this.findAdjacentPosts({ ...post, room_id: communityId, project_id: visibleProjectId }, userId),
      visibleProjectId
        ? this.prisma.activeStorageAttachment.findFirst({
            where: { record_type: "Project", record_id: visibleProjectId, name: "icon" },
            select: { blob_id: true },
          })
        : Promise.resolve(null),
      this.prisma.chatMessage.findUnique({
        where: { entry_id: post.id },
        include: { saved_by: { select: { id: true, username: true } } },
      }),
    ])
    const community = fallbackCommunity

    const reflections = visitor
      ? []
      : await this.prisma.reflection.findMany({
          where: { reflectable_type: "Post", reflectable_id: post.id, ...reflectionSummaryScope(communityId) },
          include: { page: true },
        })

    const pageNumber = pageFrom(page)
    const perPageValue = perPageFrom(perPage)
    const replyRows = await this.prisma.reply.findMany({
      where: { entry_id: post.id, status: "published" },
      include: { user: true },
      orderBy: [{ published_at: "asc" }, { id: "asc" }],
      skip: (pageNumber - 1) * perPageValue,
      take: perPageValue + 1,
    })
    const replies = replyRows.slice(0, perPageValue)

    const replyIds = replies.map((reply) => reply.id)
    const postPreview = await this.linkPreviews.serializeAttachment("Post", post.id)
    const replyPreviewMap = await this.linkPreviews.attachmentsForOwners(
      "Reply",
      replyIds.map((id) => Number(id ?? 0)),
    )
    const replyDocuments = replyIds.length
      ? await this.prisma.document.findMany({
          where: { docable_type: "Reply", docable_id: { in: replyIds } },
        })
      : []
    const replyDocMap = new Map(replyDocuments.map((doc) => [doc.docable_id, doc] as const))

    const replyReflections = !visitor && replyIds.length
      ? await this.prisma.reflection.findMany({
          where: { reflectable_type: "Reply", reflectable_id: { in: replyIds }, ...reflectionSummaryScope(communityId) },
          include: { page: true },
        })
      : []
    const replyReflectionMap = new Map<number, typeof replyReflections>(
      replyIds.map((id) => {
        const replyId = Number(id ?? 0)
        return [replyId, replyReflections.filter((reflection) => Number(reflection.reflectable_id ?? 0) === replyId)]
      }),
    )

    const membershipMap = await entryMembershipMap(this.prisma, communityId, [
      Number(post.user_id ?? 0),
      ...replies.map((reply) => Number(reply.user_id ?? 0)).filter(Boolean),
    ])

    const [presentedPostContent, ...presentedReplyContents] = await presentImageDocuments(this.prisma, [
      normalizeUploadUrls(entryBody(contentDoc?.content)),
      ...replies.map(reply => normalizeUploadUrls(replyDocMap.get(reply.id)?.content ?? DEFAULT_TIPTAP_DOC)),
    ])
    const postUser = serializeEntryUser(post.user, membershipMap.get(`${Number(post.user_id ?? 0)}:${communityId ?? ""}`))
    const communityAvatarUrl = communityId ? await identityImageUrl(this.prisma, "Circle", communityId) : null
    const storedProvenance = recordValue(parseEntryFormatData(post.format_data)?.chat_provenance)
    const storedRound = recordValue(parseEntryFormatData(post.format_data)?.round_attribution ?? parseEntryFormatData(post.format_data)?.round_activity)
    const storedSaver = recordValue(storedProvenance?.saved_by)
    const provenance = post.locked
      ? {
          source_message_id: Number(storedProvenance?.source_message_id ?? chatSource?.id ?? 0) || null,
          saved_by: storedSaver
            ? {
                id: Number(storedSaver.id ?? 0),
                display_username: typeof storedSaver.display_username === "string" ? storedSaver.display_username : "member",
              }
            : chatSource?.saved_by
              ? { id: chatSource.saved_by.id, display_username: chatSource.saved_by.username }
              : null,
          label:
            typeof storedProvenance?.label === "string"
              ? storedProvenance.label
              : `Saved from Chat by ${chatSource?.saved_by?.username ?? "a member"}`,
        }
      : null
    const postPayload: EntryShow = {
      id: Number(post.id ?? 0),
      status: post.status,
      revision: post.updated_at?.getTime(),
      room_id: communityId || null,
      room: community
        ? { id: Number(community.id ?? 0), name: community.name, avatar_url: communityAvatarUrl }
        : null,
      room_project: associatedProjectId && (post.project ?? sourceEntry?.project) ? { name: (post.project ?? sourceEntry?.project)!.name } : null,
      project_id: visibleProjectId,
      project: visibleProject
        ? {
            id: Number(visibleProject.id ?? 0),
            name: visibleProject.name,
            icon_url: projectIcon ? uploadVariantUrl(`/api/v1/uploads/${projectIcon.blob_id}`, "icon160") : null,
          }
        : null,
      can_keep_replies: !visitor && Boolean(communityId) && post.status === "published",
      ...(keepProjectId ? { keep_project_id: keepProjectId, source_entry_id: post.source_entry_id! } : {}),
      round_id: post.round_id ? Number(post.round_id ?? 0) : null,
      round: post.round
        ? { id: Number(post.round.id ?? 0), name: post.round.name }
        : null,
      created_at: post.created_at.toISOString(),
      published_at: post.published_at?.toISOString() ?? null,
      display_username: postUser.display_username,
      display_avatar_url: postUser.display_avatar_url,
      user: postUser,
      ...entryContentPresentation(post, presentedPostContent),
      subject: serializeStoredEntrySubject(post.subject),
      feedback_request: serializeEntryFeedbackRequest(post.round_id ? { reply_mode: "simple" } : post),
      can_edit_feedback_request: !visitor && Number(post.user_id ?? 0) === Number(userId ?? 0),
      can_edit: false,
      can_delete: false,
      link_preview: postPreview,
      reflections: summarizeReflections(reflections, userId),
      previous_entry: adjacentPosts.previous_entry,
      next_entry: adjacentPosts.next_entry,
      previous_author_entry: adjacentPosts.previous_author_entry,
      next_author_entry: adjacentPosts.next_author_entry,
      previous_project_entry: adjacentPosts.previous_project_entry,
      next_project_entry: adjacentPosts.next_project_entry,
      previous_round_entry: adjacentPosts.previous_round_entry,
      next_round_entry: adjacentPosts.next_round_entry,
      locked: Boolean(post.locked),
      provenance,
      round_attribution:
        typeof storedRound?.cover_label === "string"
          ? {
              label: storedRound.cover_label,
              cover_contributor_id: Number(storedRound.cover_contributor_id ?? 0) || null,
            }
          : null,
      viewer_access: { kind: accessKind, can_write: !visitor, can_reply: post.status === "published", can_withdraw: canWithdraw },
    }

    const payloadReplies: ReplyPayload[] = replies.map((reply, replyIndex) => {
      const replyId = Number(reply.id ?? 0)
      const membership = membershipMap.get(`${Number(reply.user_id ?? 0)}:${communityId ?? ""}`)
      const user = reply.user ? serializeEntryUser(reply.user, membership) : null
      const replyReflectionsForId = replyReflectionMap.get(replyId) ?? []
      return {
        id: replyId,
        status: reply.status,
        revision: reply.updated_at?.getTime(),
        created_at: reply.created_at.toISOString(),
        published_at: reply.published_at?.toISOString() ?? null,
        user,
        display_username: user?.display_username,
        display_avatar_url: user?.display_avatar_url,
        feedback_type: normalizeReplyFeedbackType(reply.feedback_type),
        content: presentedReplyContents[replyIndex],
        link_preview: replyPreviewMap.get(replyId) ?? null,
        reflections: summarizeReflections(replyReflectionsForId, userId),
      }
    })

    const hasNext = replyRows.length > perPageValue

    return {
      entry: postPayload,
      replies: {
        data: payloadReplies,
        pagination: {
          page: pageNumber,
          per_page: perPageValue,
          next_page: hasNext ? pageNumber + 1 : null,
        },
      },
    }
  }

  async roomProjectShares(postId: number, userId: number, cursor?: number) {
    const { entry: anchor } = await this.fetchEntry(postId, userId)
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    const source = post?.source_entry_id
      ? await this.prisma.entry.findUnique({ where: { id: post.source_entry_id } }) : null
    const projectId = post?.project_id ?? (isProjectEntry(source) ? source?.project_id : null)
    if (!anchor.room_id || !projectId || !anchor.room_project) throw new NotFoundException("Project not found")
    const sources = await this.prisma.entry.findMany({
      where: { project_id: projectId, room_id: null, creation_origin: "project_material" },
      select: { id: true },
    })
    const candidates = await this.prisma.entry.findMany({
      where: { room_id: anchor.room_id, status: "published", source_entry_id: { in: sources.map(item => item.id) },
        ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: "desc" }, take: 21, select: { id: true },
    })
    const items: EntryShow[] = []
    for (const candidate of candidates.slice(0, 20)) {
      try { items.push((await this.fetchEntry(candidate.id, userId)).entry) }
      catch (error) {
        if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error
      }
    }
    return { project: anchor.room_project, room: anchor.room, items,
      nextCursor: candidates.length > 20 ? candidates[19].id : null }
  }

  private async assertReadableRoomPost(post: {
    room_id?: number | null
    id: number
    status: string
  }, access: RoomAccessContext) {
    if (!(await this.circleAccess.canReadPublishedPostWithRoomHistory(post, access))) throw new ForbiddenException("Forbidden")
  }

  private async findAdjacentPosts(post: {
    id: number
    user_id?: number | null
    room_id?: number | null
    project_id?: number | null
    round_id?: number | null
    published_at?: Date | null
    created_at?: Date | null
  }, viewerId: number) {
    const communityId = Number(post.room_id ?? 0)
    const userId = Number(post.user_id ?? 0)
    const projectId = Number(post.project_id ?? 0)
    const activityId = Number(post.round_id ?? 0)
    const timestamp = post.published_at ?? post.created_at
    if (!communityId || !userId || !timestamp) {
      return {
        previous_entry: null,
        next_entry: null,
        previous_author_entry: null,
        next_author_entry: null,
        previous_project_entry: null,
        next_project_entry: null,
        previous_round_entry: null,
        next_round_entry: null,
      }
    }

    const currentEntryId = Number(post.id ?? 0)
    // Shared copies retain their own circle audience. Project membership never grants access to a circle.
    const adjacentPair = (scope: Prisma.EntryWhereInput, navigationProjectId?: number) => Promise.all([
      this.findReadableAdjacentShare(scope, currentEntryId, timestamp, "previous", viewerId, navigationProjectId),
      this.findReadableAdjacentShare(scope, currentEntryId, timestamp, "next", viewerId, navigationProjectId),
    ])
    const [[previousAuthorPost, nextAuthorPost], projectPosts, activityPosts] = await Promise.all([
      adjacentPair({ room_id: communityId, user_id: userId }),
      projectId ? adjacentPair({ room_id: communityId }, projectId) : Promise.resolve([null, null] as const),
      activityId ? adjacentPair({ room_id: communityId, user_id: userId, round_id: { not: activityId } }) : Promise.resolve([null, null] as const),
    ])
    const [previousProjectPost, nextProjectPost] = projectPosts
    const [previousActivityPost, nextActivityPost] = activityPosts

    return {
      previous_entry: this.serializePostNavigationLink(previousAuthorPost),
      next_entry: this.serializePostNavigationLink(nextAuthorPost),
      previous_author_entry: this.serializePostNavigationLink(previousAuthorPost),
      next_author_entry: this.serializePostNavigationLink(nextAuthorPost),
      previous_project_entry: this.serializePostNavigationLink(previousProjectPost),
      next_project_entry: this.serializePostNavigationLink(nextProjectPost),
      previous_round_entry: this.serializePostNavigationLink(previousActivityPost),
      next_round_entry: this.serializePostNavigationLink(nextActivityPost),
    }
  }

  private async findReadableAdjacentShare(
    scope: Prisma.EntryWhereInput,
    currentEntryId: number,
    timestamp: Date,
    direction: "previous" | "next",
    viewerId: number,
    projectId?: number,
  ) {
    // Let PostgreSQL seek with the stored timestamp precision; keep request
    // memory constant even across a long run of inaccessible shares.
    let cursorId: number | undefined
    const previous = direction === "previous"
    for (;;) {
      const candidate = projectId
        ? await projectNavigationCandidate(this.prisma, projectId, currentEntryId, timestamp, previous, cursorId, typeof scope.room_id === "number" ? scope.room_id : undefined)
        : await this.prisma.entry.findFirst({
        ...(cursorId === undefined ? {} : { cursor: { id: cursorId }, skip: 1 }),
        where: {
          id: { not: currentEntryId },
          status: "published",
          AND: [
            scope,
            { room_id: { not: null } },
            { OR: previous
              ? [{ published_at: { lt: timestamp } }, { published_at: timestamp, id: { lt: currentEntryId } }]
              : [{ published_at: { gt: timestamp } }, { published_at: timestamp, id: { gt: currentEntryId } }],
            },
          ],
        },
        orderBy: [{ published_at: previous ? "desc" : "asc" }, { id: previous ? "desc" : "asc" }],
        select: {
          id: true, status: true, created_at: true, published_at: true, room_id: true,
          project_id: true, creation_origin: true,
        },
      })
      if (!candidate || candidate.id === cursorId || candidate.id === currentEntryId) return null
      const candidateRoomId = roomEntryRoomId(candidate)
      if (candidate.status === "published" && !isProjectEntry(candidate) && candidateRoomId && (typeof scope.room_id !== "number" || candidateRoomId === scope.room_id)) {
        const access = await this.circleAccess.resolve(candidateRoomId, viewerId)
        if ((access?.kind === "member" && candidate.creation_origin !== "chat_attachment") || (access && await this.circleAccess.canReadPublishedPostWithRoomHistory(candidate, access))) {
          return candidate
        }
      }
      cursorId = candidate.id
    }
  }

  private serializePostNavigationLink(post: { id: number; created_at?: Date | null; published_at?: Date | null } | null | undefined) {
    if (!post) return null

    return {
      id: Number(post.id ?? 0),
      created_at: post.created_at?.toISOString(),
      published_at: post.published_at?.toISOString() ?? null,
    }
  }

  async draftPayload(postId: number, userId: number) {
    const post = await this.prisma.entry.findUnique({
      where: { id: postId },
      include: { user: true, subject: true, round: true, project: true },
    })
    if (!post) throw new NotFoundException("Not Found")
    const projectEntry = isProjectEntry(post)
    if (projectEntry && !(await canEditProjectEntry(this.prisma, post, userId))) throw new ForbiddenException("Forbidden")
    const visibleProjectId = post.project_id && await canViewProject(this.prisma, post.project_id, userId)
      ? post.project_id
      : null

    const document = await this.prisma.document.findFirst({ where: { docable_type: "Post", docable_id: post.id } })
    const user = post.user
    const avatarUrl = user ? await identityImageUrl(this.prisma, "User", user.id) : null

    return {
      id: post.id,
      status: post.status,
      revision: post.updated_at?.getTime(),
      room_id: post.room_id ?? undefined,
      round_id: post.round_id ?? undefined,
      source_entry_id: post.source_entry_id ?? undefined,
      project_id: visibleProjectId ?? undefined,
      project: visibleProjectId && post.project ? { id: post.project.id, name: post.project.name } : null,
      ...(projectEntry ? {
        project_intent: post.project_intent,
        project_question: post.project_question,
        project_lyrics: post.project_lyrics,
      } : {}),
      round: post.round
        ? {
            id: post.round.id,
            name: post.round.name,
            submit_by: post.round.submit_by?.toISOString() ?? null,
            feedback_due_at: post.round.feedback_due_at?.toISOString() ?? null,
          }
        : null,
      ...sharedEntryPresentation(post),
      content: normalizeUploadUrls(entryBody(document?.content)),
      format: parseEntryFormat(post.format),
      format_data: parseEntryFormatData(post.format_data),
      subject: serializeStoredEntrySubject(post.subject),
      feedback_request: serializeEntryFeedbackRequest(post),
      feedback_request_customized: Boolean(post.feedback_request_customized),
      creation_origin: ["chat", "round_activity_cover", "round_activity_response", "project_material"].includes(
        post.creation_origin ?? "",
      )
        ? post.creation_origin
        : null,
      link_preview: await this.linkPreviews.serializeAttachment("Post", post.id, { includeHidden: true }),
      user: user
        ? {
            id: Number(user.id ?? 0),
            username: user.username,
            avatar_url: avatarUrl,
          }
        : undefined,
    }
  }
}
