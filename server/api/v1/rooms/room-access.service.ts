import { roomEntryRoomId } from "../entries/room-entry-scope"
import { recentRoomMemberEntryIds } from "../entries/room-entry-history"
import type { Prisma } from "@prisma/client"
import { lockActiveRoom } from "./room-membership-transaction"
import { availableChatMessageWhere, findAvailableChatAttachment } from "../../v2/rooms/chat-visibility"
import { hasLimitedRoomHistory, roomDoorEligibility } from "./room-door-policy"
import { activeRoomVisit, grantRoomVisit, renewRoomVisit } from "./room-visit-lease"
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"

// Shared safety bound for ancestry traversal in reads and locked access checks.
const MAX_ROOM_ACCESS_PATH_LENGTH = 128

export type RoomAccessKind = "member" | "visitor"
export type RoomAccessSource = "membership" | "porosity" | "knock"

export type RoomAccessContext = {
  room: {
    id: number
    name: string | null
    owner_id: number | null
    parent_id: number | null
    porosity: "open" | "masked" | "closed"
  }
  kind: RoomAccessKind
  source: RoomAccessSource
  membershipId: number | null
  canManage: boolean
  canCreateSideCircle: boolean
  canViewNotes: boolean
  canWriteWall: boolean
  canParticipateActivities: boolean
}

@Injectable()
export class RoomAccessService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async resolve(circleId: number, userId: number, now = new Date(), database: Prisma.TransactionClient = this.prisma): Promise<RoomAccessContext | null> {
    if (!Number.isInteger(circleId) || circleId <= 0 || !Number.isInteger(userId) || userId <= 0) return null
    return this.resolvePath(circleId, userId, new Set<number>(), now, false, database)
  }

  /** Read-only entry eligibility. Only free admission may exist without a live target lease. */
  async resolveAdmission(circleId: number, userId: number, now = new Date()): Promise<RoomAccessContext | null> {
    if (!Number.isInteger(circleId) || circleId <= 0 || !Number.isInteger(userId) || userId <= 0) return null
    return this.resolvePath(circleId, userId, new Set<number>(), now, true)
  }

  async require(circleId: number, userId: number): Promise<RoomAccessContext> {
    const access = await this.resolve(circleId, userId)
    if (!access) throw new ForbiddenException("Forbidden")
    return access
  }

  /** An explicit arrival/activity mutation; background reads must never call this. */
  async visit(circleId: number, userId: number, now = new Date()) {
    const access = await this.resolveAdmission(circleId, userId, now)
    if (!access) throw new ForbiddenException("Visit unavailable. Knock again if admission is required.")
    if (access.kind === "member") return { kind: "member" as const, expires_at: null }
    const parent = access.room.parent_id ? await this.resolve(access.room.parent_id, userId, now) : null
    const freeEntry = parent && roomDoorEligibility(parent, access.room.porosity) === "visit"
    const lease = freeEntry
      ? await grantRoomVisit(this.prisma, circleId, userId, "porosity", now)
      : await renewRoomVisit(this.prisma, circleId, userId, now)
    if (!lease) throw new ForbiddenException("Visit expired. Knock again to request admission.")
    return { kind: "visitor" as const, expires_at: lease.expires_at.toISOString() }
  }

  async requireMember(circleId: number, userId: number): Promise<RoomAccessContext> {
    const access = await this.require(circleId, userId)
    if (access.kind !== "member") throw new ForbiddenException("Members only")
    return access
  }

  /** Member-only writes hold Room and membership authority until their transaction commits. */
  async requireMemberInTransaction(tx: Prisma.TransactionClient, circleId: number, userId: number) {
    await lockActiveRoom(tx, circleId)
    await tx.$queryRaw`SELECT id FROM room_memberships WHERE room_id = ${circleId} AND user_id = ${userId} FOR SHARE`
    const membership = await tx.roomMembership.findFirst({ where: { room_id: circleId, user_id: userId, disabled: false }, select: { id: true } })
    if (!membership) throw new ForbiddenException("Members only")
    const circle = await tx.room.findUniqueOrThrow({ where: { id: circleId }, select: { id: true, name: true, owner_id: true, parent_id: true, porosity: true } })
    return this.context({ ...circle, porosity: this.porosity(circle.porosity) }, userId, "member", "membership", membership.id)
  }

  /** Acquire before content locks; policy reads and revocations share these rows. */
  async requireAccessInTransaction(tx: Prisma.TransactionClient, circleId: number, userId: number) {
    return (await this.requireAccessesInTransaction(tx, [circleId], userId)).get(circleId)!
  }

  /** Lock the complete access set before resource locks. Destination Rooms that will
   * require member-write authority are exclusive now and must remain members.
   */
  async requireAccessesInTransaction(
    tx: Prisma.TransactionClient, roomIds: readonly number[], userId: number,
    memberRoomIds: readonly number[] = [],
  ): Promise<Map<number, RoomAccessContext>> {
    const requested = [...new Set(roomIds)].sort((a, b) => a - b)
    if (requested.some(id => !Number.isSafeInteger(id) || id <= 0) || memberRoomIds.some(id => !requested.includes(id))) {
      throw new ForbiddenException("Invalid Room access set")
    }
    const exclusive = new Set(memberRoomIds)
    const parents = new Map<number, number | null>()
    const membershipAnchors = new Map<number, number>()
    for (const circleId of requested) {
      const path = new Set<number>()
      let next: number | null = circleId
      while (next !== null) {
        if (path.has(next) || path.size >= MAX_ROOM_ACCESS_PATH_LENGTH) throw new ForbiddenException("Invalid Room access path")
        path.add(next)
        if (parents.has(next)) {
          if (membershipAnchors.has(next)) break
          next = parents.get(next)!; continue
        }
        const room: { parent_id: number | null } | null = await tx.room.findUnique({ where: { id: next }, select: { parent_id: true } })
        if (!room) throw new ForbiddenException("Forbidden")
        parents.set(next, room.parent_id)
        const membership = await tx.roomMembership.findFirst({
          where: { room_id: next, user_id: userId, disabled: false }, select: { id: true },
        })
        if (membership) { membershipAnchors.set(next, membership.id); break }
        next = room.parent_id
      }
    }
    const ids = [...parents.keys()].sort((a, b) => a - b)
    for (const id of ids) {
      const [room] = exclusive.has(id)
        ? await tx.$queryRaw<Array<{ parent_id: number | null }>>`SELECT parent_id FROM rooms WHERE id = ${id} FOR UPDATE`
        : await tx.$queryRaw<Array<{ parent_id: number | null }>>`SELECT parent_id FROM rooms WHERE id = ${id} FOR SHARE`
      if (!room || room.parent_id !== parents.get(id)) throw new ConflictException("Room access changed. Try again.")
    }
    for (const id of ids) {
      await tx.$queryRaw`SELECT id FROM room_memberships WHERE room_id = ${id} AND user_id = ${userId} FOR SHARE`
      await tx.$queryRaw`SELECT id FROM room_knocks WHERE room_id = ${id} AND user_id = ${userId} FOR SHARE`
      await tx.$queryRaw`SELECT room_id FROM room_visits WHERE room_id = ${id} AND user_id = ${userId} FOR SHARE`
    }
    // Discovery may stop at independent membership. If it was revoked while
    // acquiring locks, never fall back to an ancestor path we did not lock.
    for (const [roomId, membershipId] of membershipAnchors) {
      const current = await tx.roomMembership.findFirst({
        where: { id: membershipId, room_id: roomId, user_id: userId, disabled: false }, select: { id: true },
      })
      if (!current) throw new ForbiddenException("Forbidden")
    }
    const contexts = new Map<number, RoomAccessContext>(), now = new Date()
    for (const id of requested) {
      const access = exclusive.has(id)
        ? await this.requireMemberInTransaction(tx, id, userId)
        : await this.resolve(id, userId, now, tx)
      if (!access) throw new ForbiddenException("Forbidden")
      contexts.set(id, access)
    }
    return contexts
  }

  async requireManager(circleId: number, userId: number): Promise<RoomAccessContext> {
    const access = await this.requireMember(circleId, userId)
    if (!access.canManage) throw new ForbiddenException("Circle manager only")
    return access
  }

  async findCircle(circleId: number) {
    const circle = await this.prisma.room.findUnique({
      where: { id: circleId },
      select: { id: true, name: true, owner_id: true, parent_id: true, porosity: true, deleted_at: true },
    })
    if (!circle || circle.deleted_at) throw new NotFoundException("Not Found")
    return { ...circle, porosity: this.porosity(circle.porosity) }
  }

  /** Original Chat content, including its media, shares one lifetime/history boundary. */
  async canReadPublishedChatMessage(messageId: number, userId: number, now = new Date(), database: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const message = await database.chatMessage.findFirst({
      where: { id: messageId, ...availableChatMessageWhere(now) },
      select: { id: true, room_id: true },
    })
    if (!message) return false
    const access = await this.resolve(message.room_id, userId, now, database)
    if (!access) return false
    if (!hasLimitedRoomHistory(access)) return true
    const visible = await database.chatMessage.findMany({
      where: { room_id: message.room_id, ...availableChatMessageWhere(now) },
      orderBy: { id: "desc" }, take: 10, select: { id: true },
    })
    return visible.some(row => row.id === messageId)
  }

  async isCurrentMemberSlot(entry: { user_id: number | null; room_id: number | null }, roomId: number, database: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    if (!entry.user_id || entry.room_id !== roomId) return false
    return Boolean(await database.roomMembership.findFirst({
      where: { room_id: roomId, user_id: entry.user_id, disabled: false, revoked_at: null },
      select: { id: true },
    }))
  }

  async isCurrentPublishedPost(post: { id: number; status: string }, database: Prisma.TransactionClient = this.prisma) {
    if (post.status !== "published") return false
    const entry = await database.entry.findUnique({ where: { id: post.id }, select: { room_id: true, user_id: true } })
    if (!entry?.room_id || !entry.user_id) return false
    const [latestId] = await recentRoomMemberEntryIds(database, [{ roomId: entry.room_id, userId: entry.user_id }], 1)
    return latestId === post.id
  }

  /** Use the resolved Room's history policy; Chat attachment Entries retain Chat lifetime. */
  async canReadPublishedPostWithRoomHistory(
    post: { id: number; status: string; creation_origin?: string | null; room_id?: number | null },
    access: RoomAccessContext,
    database: Prisma.TransactionClient = this.prisma,
  ) {
    const roomId = roomEntryRoomId(post)
    if (post.status !== "published" || !roomId || roomId !== access.room.id) return false
    if (post.creation_origin !== "chat_attachment") {
      if (!hasLimitedRoomHistory(access)) return true
      const entry = await database.entry.findUnique({ where: { id: post.id }, select: { user_id: true, room_id: true } })
      return Boolean(entry && await this.isCurrentMemberSlot(entry, roomId, database) && await this.isCurrentPublishedPost(post, database))
    }
    const now = new Date()
    const message = await findAvailableChatAttachment(database, post.id, roomId, now)
    if (!message) return false
    if (!hasLimitedRoomHistory(access)) return true
    const visible = await database.chatMessage.findMany({ where: { room_id: roomId, ...availableChatMessageWhere(now) }, orderBy: { id: "desc" }, take: 10, select: { id: true } })
    return visible.some(row => row.id === message.id)
  }

  private async resolvePath(circleId: number, userId: number, visited: Set<number>, now: Date, admissionOnly = false, database: Prisma.TransactionClient = this.prisma): Promise<RoomAccessContext | null> {
    if (visited.has(circleId) || visited.size >= MAX_ROOM_ACCESS_PATH_LENGTH) return null
    visited.add(circleId)

    const circle = await database.room.findUnique({
      where: { id: circleId },
      select: { id: true, name: true, owner_id: true, parent_id: true, porosity: true, deleted_at: true },
    })
    if (!circle || circle.deleted_at) return null
    const normalizedRoom = { ...circle, porosity: this.porosity(circle.porosity) }

    const membership = await database.roomMembership.findFirst({
      where: { room_id: circleId, user_id: userId, disabled: false },
      select: { id: true },
    })
    if (membership) return this.context(normalizedRoom, userId, "member", "membership", membership.id)

    const parentAccess = circle.parent_id ? await this.resolvePath(circle.parent_id, userId, visited, now, false, database) : null
    if (circle.parent_id && !parentAccess) return null
    const eligibility = parentAccess ? roomDoorEligibility(parentAccess, normalizedRoom.porosity) : null
    if (eligibility === "hidden") return null

    const knock = await database.roomKnock.findUnique({
      where: { room_id_user_id: { room_id: circleId, user_id: userId } },
      select: { status: true },
    })
    const freeEntry = eligibility === "visit"
    if (!freeEntry && knock?.status !== "admitted") return null
    const lease = await activeRoomVisit(database, circleId, userId, now)
    if (freeEntry && (admissionOnly || lease)) return this.context(normalizedRoom, userId, "visitor", "porosity", null)
    if (knock?.status === "admitted" && lease?.source === "knock") return this.context(normalizedRoom, userId, "visitor", "knock", null)
    return null
  }

  private context(
    circle: RoomAccessContext["room"],
    userId: number,
    kind: RoomAccessKind,
    source: RoomAccessSource,
    membershipId: number | null,
  ): RoomAccessContext {
    const member = kind === "member"
    return {
      room: circle,
      kind,
      source,
      membershipId,
      canManage: member && circle.owner_id === userId,
      canCreateSideCircle: member,
      canViewNotes: member,
      canWriteWall: member,
      canParticipateActivities: member,
    }
  }

  private porosity(value: string): "open" | "masked" | "closed" {
    if (value === "masked" || value === "closed") return value
    return "open"
  }
}
