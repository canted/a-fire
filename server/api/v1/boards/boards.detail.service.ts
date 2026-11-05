import { roomSavedResponses } from "./room-saved-responses"
import { entryBody } from "../entries/post-content"
import { reflectionSummaryScope } from "../reflections/reflection-summary-scope"
import { identityImageUrls } from "../uploads/identity-images"
import { roomReplySummaries } from "../entries/room-reply-summary"
import { recentRoomMemberEntryIds } from "../entries/room-entry-history"
import { hasLimitedRoomHistory } from "../rooms/room-door-policy"
import { sharedEntryPresentation } from "../entries/shared-entry-presentation"
import { Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { postFormatDataVariantUrls, tiptapImageVariantUrls } from "../uploads/upload-urls"
import { serializeStoredEntrySubject, type EntrySubjectPayload } from "../entries/entry-subjects"
import { parseEntryFormat, parseEntryFormatData, type EntryFormat, type EntryFormatData } from "../entries/entry-formats"
import { RoomAccessService, type RoomAccessContext } from "../rooms/room-access.service"
import { RoundLifecycleService } from "../rounds/round-lifecycle.service"

type ReflectionPayload = { pageId: number; pageTitle: string | null; pageIcon: string | null }

export type RoomMemberPreview = {
  membershipId: string
  userId: string
  username: string
  avatarUrl?: string | null
  recentEntries?: NonNullable<RoomMemberPreview["latestEntry"]>[]
  latestEntry?: {
    id: string
    createdAt?: string
    savedResponses?: Array<{ id: string; entryId: string; author: string; text: string; savedAt: string; sourceTitle: string }>
    replyParticipants?: Array<{ id: number; username: string; avatar_url?: string | null }>
    content: unknown
    format: EntryFormat
    formatData?: EntryFormatData
    subject?: EntrySubjectPayload | null
    reflections?: ReflectionPayload[]
    replyCount: number
    locked: boolean
    provenance: {
      source_message_id: number | null
      saved_by: { id: number; display_username: string } | null
      label: string
    } | null
  } | null
}

@Injectable()
export class BoardsDetailService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  @Inject(RoundLifecycleService)
  private readonly activityLifecycle!: RoundLifecycleService

  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? value : Number(value)
  }

  async fetchRoomHome(roomId: number, userId: number) {
    const access = await this.circleAccess.require(roomId, userId)
    await this.activityLifecycle.reconcileCircle(roomId)
    const { members } = await this.memberPreviews(roomId, userId, access)
    return {
      roomId: String(roomId), members,
      viewer_access: {
        kind: access.kind, can_write: access.canWriteWall, can_reply: true,
        entry_history: hasLimitedRoomHistory(access) ? "current_only" as const : "all" as const,
      },
    }
  }

  private async memberPreviews(communityIdNumber: number, userId: number, circleAccess: RoomAccessContext) {
    const visitor = circleAccess?.kind === "visitor"
    const limitedHistory = circleAccess ? hasLimitedRoomHistory(circleAccess) : false
    const membershipMap = await this.membershipMap(communityIdNumber)
    const recentIds = await recentRoomMemberEntryIds(this.prisma, [...membershipMap.values()].map(member => ({ roomId: communityIdNumber, userId: member.userId })), 1)
    const recentEntries = recentIds.length
      ? await this.prisma.entry.findMany({
          where: { id: { in: recentIds }, status: "published" },
          orderBy: [{ published_at: "desc" }, { created_at: "desc" }, { id: "desc" }],
          include: { subject: true },
        })
      : []
    const recentByMember = new Map<number, typeof recentEntries>()
    for (const post of recentEntries) {
      const key = post.user_id
      if (!key) continue
      const entries = recentByMember.get(key) ?? []
      if (entries.length < (1)) entries.push(post)
      recentByMember.set(key, entries)
    }
    const representedEntries = recentEntries
    const postIds = representedEntries.map((post) => post.id)

    const documents = postIds.length
      ? await this.prisma.document.findMany({
          where: { docable_type: "Post", docable_id: { in: postIds } },
        })
      : []
    const documentMap = new Map(documents.map((doc) => [doc.docable_id, doc.content] as const))
    const summaries = await roomReplySummaries(this.prisma, postIds)
    const replyCountMap = new Map(summaries.map(summary => [summary.entry_id, Number(summary.reply_count)]))
    const replyParticipants = new Map(summaries.map(summary => [summary.entry_id, summary.participants.map(person => ({
      ...person, username: membershipMap.get(`${person.id}:${communityIdNumber}`)?.displayUsername ?? person.username,
    }))]))

    const savedResponses = await roomSavedResponses(this.prisma, representedEntries)

    const reflections = !visitor && postIds.length
      ? await this.prisma.reflection.findMany({
          where: { reflectable_type: "Post", reflectable_id: { in: postIds }, ...reflectionSummaryScope(communityIdNumber) },
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

    const serializeEntry = (selectedPost: (typeof representedEntries)[number]) => {
      const formatData = postFormatDataVariantUrls(
        parseEntryFormatData(selectedPost.format_data),
        "w600",
      )
      const storedProvenance = this.recordValue(formatData?.chat_provenance)
      const savedBy = this.recordValue(storedProvenance?.saved_by)
      return {
        ...sharedEntryPresentation(selectedPost),
        id: String(selectedPost.id),
        createdAt: (selectedPost.published_at ?? selectedPost.created_at).toISOString(),
        replyParticipants: (replyParticipants.get(selectedPost.id) ?? []).slice(0, 3),
        savedResponses: savedResponses.get(selectedPost.id) ?? [],
        content: tiptapImageVariantUrls(
          entryBody(documentMap.get(selectedPost.id)),
          "w600",
        ),
        format: parseEntryFormat(selectedPost.format),
        formatData,
        subject: serializeStoredEntrySubject(selectedPost.subject),
        reflections: reflectionMap.get(this.toNumber(selectedPost.id)) ?? [],
        replyCount: replyCountMap.get(this.toNumber(selectedPost.id)) ?? 0,
        locked: Boolean(selectedPost.locked),
        provenance: selectedPost.locked && storedProvenance
          ? {
              source_message_id: this.toNumber(storedProvenance.source_message_id) || null,
              saved_by: savedBy
                ? {
                    id: this.toNumber(savedBy.id),
                    display_username:
                      typeof savedBy.display_username === "string" ? savedBy.display_username : "member",
                  }
                : null,
              label:
                typeof storedProvenance.label === "string"
                  ? storedProvenance.label
                  : "Saved from Chat by a member",
            }
          : null,
      }
    }

    const members: RoomMemberPreview[] = [...membershipMap.values()].map(member => {
      const entries = recentByMember.get(member.userId) ?? []
      return {
        membershipId: String(member.membershipId), userId: String(member.userId),
        username: member.displayUsername, avatarUrl: member.displayAvatarUrl,
        latestEntry: entries[0] ? serializeEntry(entries[0]) : null, recentEntries: entries.map(serializeEntry),
      }
    }).filter(member => !limitedHistory || member.latestEntry !== null)
      .sort((a, b) => Date.parse(b.latestEntry?.createdAt ?? "1970-01-01") - Date.parse(a.latestEntry?.createdAt ?? "1970-01-01") || Number(a.membershipId) - Number(b.membershipId))

    return { members }
  }

  private recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
  }

  private async membershipMap(communityId: number | null) {
    if (!communityId) return new Map<string, { membershipId: number; userId: number; displayUsername: string; displayAvatarUrl: string | null }>()

    const memberships = await this.prisma.roomMembership.findMany({
      where: { room_id: communityId, disabled: false },
      include: { user: true },
    })

    const avatarMap = await identityImageUrls(this.prisma, "User", memberships.map(membership => membership.user_id))

    const map = new Map<string, { membershipId: number; userId: number; displayUsername: string; displayAvatarUrl: string | null }>()
    memberships.forEach((membership) => {
      const avatarUrl = avatarMap.get(membership.user_id) ?? null
      map.set(`${membership.user_id}:${communityId}`, {
        membershipId: membership.id, userId: membership.user_id,
        displayUsername: membership.username_override || membership.user.username,
        displayAvatarUrl: avatarUrl,
      })
    })

    return map
  }


}
