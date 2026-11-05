import { projectListPage } from "./project-list-page"
import { privateProjectWhere } from "./project-access"
import { homeRoundPage } from "./home-activity-page"
import { RoomAccessService } from "../rooms/room-access.service"
import { roomEntryRoomId } from "../entries/room-entry-scope"
import { homeRoomCounts } from "./home-room-counts"
import { homeEntrySummary } from "./home-entry-summary"
import { BadRequestException, ForbiddenException, NotFoundException, Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { ProjectsService } from "./projects.service"
import { ProjectEntriesService } from "./project-entries.service"
import { RoundsService } from "../rounds/rounds.service"
import { UnseenContentService } from "../unseen/unseen-content.service"
import { extractPlainText } from "../../../realtime/document-content"
import { identityImageUrl } from "../uploads/identity-images"

@Injectable()
export class HomeService {
  @Inject(PrismaService) private readonly prisma!: PrismaService
  @Inject(ProjectsService) private readonly projects!: ProjectsService
  @Inject(ProjectEntriesService) private readonly entries!: ProjectEntriesService
  @Inject(RoundsService) private readonly rounds!: RoundsService
  @Inject(UnseenContentService) private readonly unseen!: UnseenContentService
  @Inject(RoomAccessService) private readonly circleAccess!: RoomAccessService

  async snapshot(userId: number, timeZone = "UTC", includeActivity = false, activityCursor?: string) {
    let dates: Intl.DateTimeFormat
    try { dates = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }) }
    catch { throw new BadRequestException("Invalid timezone") }
    const day = (date: Date) => { const parts = dates.formatToParts(date); return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-") }
    const [memberships, entrySummary, fallback, activityPage] = await Promise.all([
      this.prisma.roomMembership.findMany({ where: { user_id: userId, disabled: false, revoked_at: null, room: { deleted_at: null } }, include: { room: true } }),
      homeEntrySummary(this.prisma, userId, timeZone),
      projectListPage(this.prisma, userId, undefined, "", { size: 3, invitations: false }),
      includeActivity ? homeRoundPage(this.prisma, userId, activityCursor) : null,
    ])
    const circles = memberships.map(m => m.room)
    const roomIds = circles.map(c => c.id)
    const [circlePosts, circleMessages, roomVisits, activeActivities] = await Promise.all([
      this.prisma.entry.groupBy({ by: ["room_id"], where: { user_id: userId, room_id: { in: roomIds }, status: "published" }, _max: { published_at: true } }),
      this.prisma.chatMessage.groupBy({ by: ["room_id"], where: { author_id: userId, room_id: { in: roomIds }, status: "published" }, _max: { created_at: true } }),
      this.prisma.chatPresenceSession.groupBy({ by: ["room_id"], where: { user_id: userId, room_id: { in: roomIds } }, _max: { last_seen_at: true } }),
      this.prisma.round.findMany({ where: { room_id: { in: roomIds }, status: "active" }, select: { id: true, room_id: true }, orderBy: { created_at: "desc" } }),
    ])
    const currentYear = day(new Date()).slice(0, 4)
    const [roomCounts, newResponses] = await Promise.all([
      homeRoomCounts(this.prisma, userId, roomIds, Number(currentYear), timeZone),
      this.unseen.countResponsesToOwnPosts(userId, roomIds),
    ])
    // Only published responses by peers to the viewer's own work in accessible circles.
    let latestResponse = roomIds.length ? await this.prisma.reply.findFirst({
      where: { user_id: { not: userId }, status: "published", published_at: { gte: new Date(Date.now() - 30 * 86400000) }, entry: { user_id: userId, status: "published", room_id: { in: roomIds } } },
      include: { entry: true },
      orderBy: [{ published_at: "desc" }, { id: "desc" }],
    }) : null
    if (latestResponse?.entry) {
      const roomId = roomEntryRoomId(latestResponse.entry)
      const access = roomId && roomIds.includes(roomId) ? await this.circleAccess.resolve(roomId, userId) : null
      if (!access || access.kind !== "member" || !await this.circleAccess.canReadPublishedPostWithRoomHistory(latestResponse.entry, access)) latestResponse = null
    }
    const responseDocument = latestResponse ? await this.prisma.document.findFirst({ where: { docable_type: "Reply", docable_id: latestResponse.id }, select: { content: true } }) : null
    const recentFeedback = latestResponse?.entry ? {
      replyId: latestResponse.id, entryId: latestResponse.entry.id,
      roomName: circles.find(c => c.id === latestResponse.entry!.room_id)?.name ?? "Circle",
      preview: extractPlainText(responseDocument?.content).slice(0, 240) || "Someone responded to your entry.",
    } : null
    const roomDashboard = { newResponses, ...roomCounts }
    // Joining/creating and visiting count even when the viewer has not posted.
    // Presence is persisted by the shared Room subscription, including quiet visits.
    const activity = new Map(memberships.map(m => [m.room.id, m.created_at?.getTime() ?? 0]))
    for (const visit of roomVisits) activity.set(visit.room_id, Math.max(activity.get(visit.room_id) ?? 0, visit._max.last_seen_at?.getTime() ?? 0))
    for (const p of circlePosts) if (p.room_id) activity.set(p.room_id, Math.max(activity.get(p.room_id) ?? 0, p._max.published_at?.getTime() ?? 0))
    for (const m of circleMessages) activity.set(m.room_id, Math.max(activity.get(m.room_id) ?? 0, m._max.created_at?.getTime() ?? 0))
    circles.sort((a, b) => (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0) || a.id - b.id)
    const noticeCounts = await this.unseen.countForUserWithRooms(userId, circles.slice(0, 5).map(circle => circle.id))
    const recentIds = entrySummary.projects.map(p => p.project_id)
    // New projects still have a home before their first entry.
    for (const id of fallback.ids) if (recentIds.length < 3 && !recentIds.includes(id)) recentIds.push(id)
    const projects = await this.projects.homeSummaries(userId, [...new Set([...recentIds, ...entrySummary.recent.map(post => post.project_id!)])])
    const projectById = new Map(projects.map(p => [p.id, p]))
    const recentEntries = await Promise.all(entrySummary.recent.filter(post => projectById.has(post.project_id!)).map(async post => ({ project: projectById.get(post.project_id!)!, entry: await this.entries.show(post.project_id!, post.id, userId) })))
    const recentProjects = await Promise.all(recentIds.filter(id => projectById.has(id)).map(async id => {
      const ownEntry = entrySummary.projects.find(post => post.project_id === id)
      return { project: projectById.get(id)!, entry: recentEntries.find(e => e.project.id === id)?.entry ?? (ownEntry ? await this.entries.show(id, ownEntry.id, userId) : null) }
    }))
    const activityProjects = activityPage?.items.length ? await this.prisma.project.findMany({ where: { id: { in: [...new Set(activityPage.items.map(post => post.project_id))] }, ...privateProjectWhere(userId) }, select: { id: true, name: true } }) : []
    const activityNames = new Map(activityProjects.map(project => [project.id, project.name]))
    const visibleRounds = await Promise.all(activeActivities.map(async r => {
      try { return { roomName: circles.find(c => c.id === r.room_id)?.name ?? "Circle", detail: await this.rounds.show(r.id, userId) } }
      catch (error) {
        if (error instanceof ForbiddenException || error instanceof NotFoundException) return null
        throw error
      }
    }))
    return {
      today: day(new Date()),
      roomDashboard, recentFeedback,
      rounds: visibleRounds.filter((activity): activity is NonNullable<typeof activity> => activity !== null),
      recentRooms: await Promise.all(circles.slice(0, 5).map(async c => ({ id: String(c.id), name: c.name ?? "Circle", avatarUrl: await identityImageUrl(this.prisma, "Circle", c.id), unseenCount: noticeCounts.byRoom.get(c.id)?.total ?? 0 }))),
      totalRoomUnseenCount: noticeCounts.overall.total,
      recentProjects, recentEntries,
      ...(activityPage ? { activityNextCursor: activityPage.nextCursor, activityEntries: activityPage.items.filter(post => activityNames.has(post.project_id)).map(post => ({
        id: post.id, projectId: post.project_id!, projectName: activityNames.get(post.project_id)!,
        date: day(post.published_at ?? post.created_at), kind: post.creation_origin === "project_feedback" ? "feedback" as const : "material" as const,
        label: post.project_question || post.project_intent || (post.creation_origin === "project_feedback" ? (post.source_chat_message_id ? "Saved message" : "Kept feedback") : "New entry"),
      })) } : {}),
      contributions: entrySummary.contributions,
    }
  }
}
