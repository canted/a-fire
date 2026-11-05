import { roomResultPage, roomResultNeighbors } from "./room-result-page"
import { roomEntryRoomId } from "../entries/room-entry-scope"
import { hasLimitedRoomHistory } from "../rooms/room-door-policy"
import { sharedEntryPresentation } from "../entries/shared-entry-presentation"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { RoomsService } from "../rooms/rooms.service"
import { RoomAccessService } from "../rooms/room-access.service"
import { presentImageDocuments } from "../uploads/image-presentation"
import { parseEntryFormat, parseEntryFormatData } from "../entries/entry-formats"
import { postFormatDataVariantUrls } from "../uploads/upload-urls"
import { RoundLifecycleService } from "./round-lifecycle.service"
import { activityScope, roundRoomId } from "./round-scope"

@Injectable()
export class WallsService {
  @Inject(PrismaService) private readonly prisma!: PrismaService
  @Inject(RoomAccessService) private readonly access!: RoomAccessService
  @Inject(RoundLifecycleService) private readonly lifecycle!: RoundLifecycleService

  @Inject(RoomsService) private readonly rooms!: RoomsService

  async list(circleId: number, userId: number, cursor?: string) {
    await this.requireResultsAccess(circleId, userId)
    await this.lifecycle.reconcileCircle(circleId)
    const selection = await roomResultPage(this.prisma, circleId, userId, cursor || undefined)
    const walls = await this.prisma.roundResult.findMany({ where: { room_id: circleId, round: activityScope({ id: 0, room_id: circleId }), id: { in: selection.ids } }, orderBy: [{ published_at: "desc" }, { id: "desc" }], include: { presentations: { where: { user_id: userId } }, _count: { select: { entries: true } } } })
    return { nextCursor: selection.nextCursor, walls: walls.map(wall => ({ id: String(wall.id), roundId: String(wall.round_id), roomId: String(circleId), title: wall.title, description: wall.description, publishedAt: wall.published_at.toISOString(), presented: wall.presentations.length > 0, entryCount: wall._count.entries })) }
  }

  async show(wallId: number, userId: number) {
    const wall = await this.requireWall(wallId, userId)
    const entries = await this.prisma.roundResultEntry.findMany({ where: { round_result_id: wall.id }, orderBy: { position: "asc" }, include: { entry: true } })
    const available = entries.filter(entry => entry.entry?.status === "published" && !entry.entry.project_id && roomEntryRoomId(entry.entry) === wall.room_id)
    const documents = await this.prisma.document.findMany({ where: { docable_type: "Post", docable_id: { in: available.map(entry => entry.entry_id!) } } })
    const presented = await presentImageDocuments(this.prisma, documents.map(doc => doc.content))
    const byEntry = new Map(documents.map((doc, index) => [doc.docable_id, presented[index]]))
    const allowed = new Set(available.map(entry => entry.id))
    const [{ members }, responses] = await Promise.all([
      this.rooms.listMembers(wall.room_id, userId),
      this.prisma.reply.groupBy({ by: ["entry_id", "user_id"], where: { entry_id: { in: available.map(entry => entry.entry_id!) }, status: "published" }, _count: { _all: true } }),
    ])
    const identities = new Map(members.map(member => [member.user_id, { id: member.user_id, username: member.display_username, avatar_url: member.display_avatar_url }]))
    const neighbors = await roomResultNeighbors(this.prisma, wall.room_id, wall.id)
    return { ...neighbors, templateKey: wall.round.template_key, id: String(wall.id), roundId: String(wall.round_id), roomId: String(wall.room_id), title: wall.title, description: wall.description, publishedAt: wall.published_at.toISOString(), entries: entries.map(entry => {
      const post = allowed.has(entry.id) ? entry.entry : null
      const replies = post ? responses.filter(response => response.entry_id === post.id) : []
      const responseParticipants = replies.sort((a, b) => (a.user_id ?? 0) - (b.user_id ?? 0)).flatMap(response => { const identity = identities.get(response.user_id ?? 0); return identity ? [identity] : [] })
      return { ...(post ? sharedEntryPresentation(post) : {}), authorAvatarUrl: post ? identities.get(post.user_id)?.avatar_url ?? null : null, responseCount: replies.reduce((count, reply) => count + reply._count._all, 0), responseParticipants, id: String(entry.id), authorName: entry.author_name, available: Boolean(post), entryId: post ? String(post.id) : null, content: post ? byEntry.get(post.id) ?? null : null, format: post ? parseEntryFormat(post.format) : "mixed_media", formatData: post ? postFormatDataVariantUrls(parseEntryFormatData(post.format_data), "w1200") : null }
    }) }
  }

  async present(wallId: number, userId: number) {
    const wall = await this.requireWall(wallId, userId)
    await this.access.requireMember(wall.room_id, userId)
    await this.prisma.roundResultPresentation.upsert({ where: { round_result_id_user_id: { round_result_id: wallId, user_id: userId } }, create: { round_result_id: wallId, user_id: userId }, update: {} })
    return { wallId: String(wallId), presented: true }
  }

  private async requireResultsAccess(roomId: number, userId: number) {
    const access = await this.access.require(roomId, userId)
    if (hasLimitedRoomHistory(access)) throw new ForbiddenException("Forbidden")
  }

  private async requireWall(wallId: number, userId: number) {
    const wall = await this.prisma.roundResult.findUnique({ where: { id: wallId }, include: { round: { select: { template_key: true, room_id: true } } } })
    if (!wall) throw new NotFoundException("Wall not found")
    if (roundRoomId(wall.round) !== wall.room_id) throw new ForbiddenException("Wall Room scope conflicts with its Round")
    await this.requireResultsAccess(wall.room_id, userId)
    return wall
  }
}
