import type { Prisma } from "@prisma/client"
import { roomMemberEntryPage } from "../entries/room-member-entry-page"
import { entryBody } from "../entries/post-content"
import { reflectionSummaryScope } from "../reflections/reflection-summary-scope"
import { recentRoomMemberEntryIds, roomMemberEntryHistoryWhere } from "../entries/room-entry-history"
import { hasLimitedRoomHistory } from "./room-door-policy"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { RoomAccessService, type RoomAccessKind, type RoomAccessContext } from "./room-access.service"
import {
  IntroductionsService,
  type IntroductionOverviewPayload,
  type IntroductionSummaryPayload,
} from "../introductions/introductions.service"
import { parseEntryFormat, parseEntryFormatData, type EntryFormat, type EntryFormatData } from "../entries/entry-formats"
import { serializeStoredEntrySubject, type EntrySubjectPayload } from "../entries/entry-subjects"
import { ProjectsService } from "../projects/projects.service"
import { identityImageUrl } from "../uploads/identity-images"
import { postFormatDataVariantUrls, tiptapImageVariantUrls } from "../uploads/upload-urls"

type MemberProfileContext = {
  id: string
  user_id: number
  room_id: number
  user: { username: string | null; profile_line: string | null } | null
  room: { name: string | null } | null
}

type ReflectionPayload = { pageId: number; pageTitle: string | null; pageIcon: string | null }

export type RoomMemberEntriesPayload = {
  id: string
  userId?: string | null
  viewerUserId: string
  username: string
  displayUsername: string
  profileLine?: string | null
  avatarUrl?: string | null
  displayAvatarUrl?: string | null
  isCurrentUser: boolean
  roomId?: string | null
  roomName?: string | null
  introductionOverview: IntroductionOverviewPayload | null
  projects: Awaited<ReturnType<ProjectsService["listForUser"]>>
  entries: {
    id: string
    createdAt?: string | null
    content: unknown
    format: EntryFormat
    formatData?: EntryFormatData
    subject?: EntrySubjectPayload | null
    reflections?: ReflectionPayload[]
    replyCount: number
  }[]
  pagination: {
    page: number
    perPage: number
    nextPage: number | null
    nextCursor?: string | null
  }
  viewer_access: { kind: RoomAccessKind; entry_history: "all" | "current_only" }
}

export type RoomMemberIntroductionsPayload = {
  id: string
  userId?: string | null
  viewerUserId: string
  username: string
  displayUsername: string
  profileLine?: string | null
  avatarUrl?: string | null
  displayAvatarUrl?: string | null
  isCurrentUser: boolean
  roomId?: string | null
  roomName?: string | null
  introductions: IntroductionSummaryPayload[]
  nextCursor: string | null
}

@Injectable()
export class RoomMemberProfilesService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(IntroductionsService)
  private readonly introductions!: IntroductionsService

  @Inject(ProjectsService)
  private readonly projects!: ProjectsService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  async fetchRoomMemberPosts(roomId: number, memberUserId: number, viewerUserId: number, page: number, cursor?: string) {
    const access = await this.circleAccess.require(roomId, viewerUserId)
    return this.fetchProfilePosts(await this.memberProfile(roomId, memberUserId), viewerUserId, page, access, cursor)
  }

  private async memberProfile(roomId: number, memberUserId: number): Promise<MemberProfileContext> {
    const membership = await this.prisma.roomMembership.findUnique({
      where: { room_id_user_id: { room_id: roomId, user_id: memberUserId } },
      include: { user: true, room: true },
    })
    if (!membership) throw new NotFoundException("Not Found")
    return { id: `${roomId}:${memberUserId}`, user_id: memberUserId, room_id: roomId,
      user: membership.user, room: membership.room }
  }

  private async fetchProfilePosts(member: MemberProfileContext, userId: number, page: number, resolvedAccess?: RoomAccessContext, cursor?: string): Promise<RoomMemberEntriesPayload> {

    const access = resolvedAccess ?? (member.room_id ? await this.circleAccess.require(member.room_id, userId) : null)
    const visitor = access?.kind === "visitor"
    const limitedHistory = access ? hasLimitedRoomHistory(access) : false
    if (limitedHistory && !(await this.circleAccess.isCurrentMemberSlot({ user_id: member.user_id, room_id: member.room_id }, access!.room.id))) throw new NotFoundException("Not Found")

    const historyWhere = roomMemberEntryHistoryWhere(member.room_id, member.user_id)
    const perPage = 20
    const currentPage = Number.isSafeInteger(page) ? Math.max(page, 1) : 1
    let posts: Prisma.EntryGetPayload<{ include: { subject: true } }>[]
    let hasNext = false
    let nextCursor: string | null = null
    if (cursor !== undefined && !limitedHistory) {
      const selected = await roomMemberEntryPage(this.prisma, member.room_id, member.user_id, userId, cursor || undefined)
      nextCursor = selected.nextCursor
      const rows = selected.ids.length ? await this.prisma.entry.findMany({
        where: { AND: [historyWhere, { id: { in: selected.ids } }] }, include: { subject: true },
      }) : []
      const byId = new Map(rows.map(row => [row.id, row]))
      posts = selected.ids.flatMap(id => { const row = byId.get(id); return row ? [row] : [] })
    } else {
      const [currentId] = await recentRoomMemberEntryIds(this.prisma, [{ roomId: member.room_id, userId: member.user_id }], 1)
      // Recheck publication and scope when hydrating the selected identity.
      const currentEntry = currentId ? await this.prisma.entry.findFirst({
        where: { AND: [historyWhere, { id: currentId }] },
        include: { subject: true },
      }) : null
      if (limitedHistory && !currentEntry) throw new NotFoundException("Not Found")
      const historicalTake = currentPage === 1 && currentEntry ? perPage - 1 : perPage
      const historicalSkip =
        currentPage === 1
          ? 0
          : currentEntry
            ? perPage - 1 + (currentPage - 2) * perPage
            : (currentPage - 1) * perPage
      const historicalWhere = {
        ...historyWhere,
        ...(currentEntry ? { id: { not: currentEntry.id } } : {}),
      }

      const historicalRows = limitedHistory ? [] : await this.prisma.entry.findMany({
        where: historicalWhere,
        orderBy: [{ published_at: "desc" }, { created_at: "desc" }, { id: "desc" }],
        include: { subject: true },
        skip: historicalSkip,
        take: historicalTake + 1,
      })
      hasNext = historicalRows.length > historicalTake
      const historicalEntries = historicalRows.slice(0, historicalTake)
      posts = limitedHistory
        ? currentEntry
          ? [currentEntry]
          : historicalEntries
        : currentPage === 1 && currentEntry
          ? [currentEntry, ...historicalEntries]
          : historicalEntries

    }

    const postIds = posts.map((post) => post.id)
    const documents = postIds.length
      ? await this.prisma.document.findMany({
          where: { docable_type: "Post", docable_id: { in: postIds } },
        })
      : []
    const documentMap = new Map(documents.map((doc) => [doc.docable_id, doc.content]))
    const replyCounts = postIds.length
      ? await this.prisma.reply.groupBy({
          by: ["entry_id"],
          where: { entry_id: { in: postIds }, status: "published" },
          _count: { _all: true },
        })
      : []
    const replyCountMap = new Map(replyCounts.map(reply => [this.toNumber(reply.entry_id), reply._count._all]))

    const reflections = !visitor && postIds.length
      ? await this.prisma.reflection.findMany({
          where: { reflectable_type: "Post", reflectable_id: { in: postIds }, ...reflectionSummaryScope(member.room_id) },
          include: { page: true },
        })
      : []

    const reflectionMap = new Map<number, ReflectionPayload[]>()
    reflections.forEach((reflection) => {
      if (!reflection.page || reflection.page.deleted_at) return
      const reflectableId = this.toNumber(reflection.reflectable_id)
      const list = reflectionMap.get(reflectableId) ?? []
      list.push({
        pageId: this.toNumber(reflection.page_id),
        pageTitle: reflection.page?.title ?? null,
        pageIcon: reflection.page?.icon ?? null,
      })
      reflectionMap.set(reflectableId, list)
    })

    const postsPayload = posts.map((post) => ({
      id: String(post.id),
      createdAt: post.created_at.toISOString(),
      content: tiptapImageVariantUrls(entryBody(documentMap.get(post.id)), "w600"),
      format: parseEntryFormat(post.format),
      formatData: postFormatDataVariantUrls(parseEntryFormatData(post.format_data), "w600"),
      subject: serializeStoredEntrySubject(post.subject),
      reflections: reflectionMap.get(this.toNumber(post.id)) ?? [],
      replyCount: replyCountMap.get(this.toNumber(post.id)) ?? 0,
    }))

    const membership = member.room_id
      ? await this.prisma.roomMembership.findFirst({
          where: { room_id: member.room_id, user_id: member.user_id ?? 0, disabled: false },
          include: { user: true },
        })
      : null

    const username = membership?.username_override || member.user?.username || "Member"
    const profileLine = membership?.profile_line_override ?? member.user?.profile_line ?? null
    const avatarUrl = member.user_id ? await identityImageUrl(this.prisma, "User", this.toNumber(member.user_id)) : null
    const membershipAvatarUrl = membership
      ? await identityImageUrl(this.prisma, "CircleMembership", this.toNumber(membership.id))
      : null
    const isCurrentUser = member.user_id ? this.toNumber(member.user_id) === userId : false
    const introductionOverview =
      !visitor && currentPage === 1 && member.room_id && member.user_id
        ? await this.introductions.overviewForMember({
            roomId: this.toNumber(member.room_id),
            viewedUserId: this.toNumber(member.user_id),
            viewerUserId: userId,
          })
        : null
    const projects = !visitor && member.user_id && member.room_id
      ? await this.projects.listForUser(this.toNumber(member.user_id), this.toNumber(member.room_id), userId)
      : []

    return {
      id: String(member.id),
      userId: member.user_id ? String(member.user_id) : null,
      viewerUserId: String(userId),
      username,
      displayUsername: username,
      profileLine,
      avatarUrl,
      displayAvatarUrl: membershipAvatarUrl ?? avatarUrl,
      isCurrentUser,
      roomId: member.room_id ? String(member.room_id) : null,
      roomName: member.room?.name ?? null,
      introductionOverview,
      projects,
      entries: postsPayload,
      pagination: {
        page: currentPage,
        perPage,
        nextPage: cursor === undefined && hasNext ? currentPage + 1 : null,
        ...(cursor !== undefined ? { nextCursor } : {}),
      },
      viewer_access: { kind: access?.kind ?? "member", entry_history: limitedHistory ? "current_only" : "all" },
    }
  }

  async fetchRoomMemberIntroductions(roomId: number, memberUserId: number, viewerUserId: number, page: { cursor?: string; target?: string } = {}) {
    const access = await this.circleAccess.requireMember(roomId, viewerUserId)
    return this.fetchProfileIntroductions(await this.memberProfile(roomId, memberUserId), viewerUserId, access, page)
  }

  private async fetchProfileIntroductions(member: MemberProfileContext, userId: number, resolvedAccess?: RoomAccessContext, page: { cursor?: string; target?: string } = {}): Promise<RoomMemberIntroductionsPayload> {

    if (member.room_id) {
      const viewerAccess = resolvedAccess ?? await this.circleAccess.require(member.room_id, userId)
      if (viewerAccess.kind !== "member") throw new ForbiddenException("Members only")
    }

    const membership = member.room_id
      ? await this.prisma.roomMembership.findFirst({
          where: { room_id: member.room_id, user_id: member.user_id ?? 0, disabled: false },
          include: { user: true },
        })
      : null
    const username = membership?.username_override || member.user?.username || "Member"
    const profileLine = membership?.profile_line_override ?? member.user?.profile_line ?? null
    const avatarUrl = member.user_id ? await identityImageUrl(this.prisma, "User", this.toNumber(member.user_id)) : null
    const membershipAvatarUrl = membership
      ? await identityImageUrl(this.prisma, "CircleMembership", this.toNumber(membership.id))
      : null
    const isCurrentUser = member.user_id ? this.toNumber(member.user_id) === userId : false
    const result = member.room_id && member.user_id
      ? await this.introductions.pageForMember({
          ...page,
          roomId: this.toNumber(member.room_id),
          viewedUserId: this.toNumber(member.user_id),
          viewerUserId: userId,
        })
      : { introductions: [], nextCursor: null }

    return {
      id: String(member.id),
      userId: member.user_id ? String(member.user_id) : null,
      viewerUserId: String(userId),
      username,
      displayUsername: username,
      profileLine,
      avatarUrl,
      displayAvatarUrl: membershipAvatarUrl ?? avatarUrl,
      isCurrentUser,
      roomId: member.room_id ? String(member.room_id) : null,
      roomName: member.room?.name ?? null,
      ...result,
    }
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? Number(value) : Number(value)
  }

}
