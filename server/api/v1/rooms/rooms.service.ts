import { roomFeedbackSettings, updateRoomFeedbackSettings, type UpdateRoomFeedbackSettingsInput } from "./room-feedback-settings"
import { withActiveRoomTransaction } from "./room-membership-transaction"
import { hasLimitedRoomHistory } from "./room-door-policy"
import { limitedChatAuthorIds } from "../../v2/rooms/chat-visibility"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import { captureCommunityCreated } from "../../../runtime/posthog"
import { serializeRoomFeedbackSettings } from "../feedback-settings"
import { identityImageUrl } from "../uploads/identity-images"
import { identityImageUrls } from "../uploads/identity-images"
import { UploadsService } from "../uploads/uploads.service"
import { RoomAccessService, type RoomAccessContext } from "./room-access.service"
import { RoomRelationshipsService } from "./room-relationships.service"
import type {
  RoomPorosity,
  RoomInput,
  RoomMemberPayload,
  RoomNotificationDeliveriesPayload,
  RoomPayload,
  DeleteRoomMemberPayload,
  DeleteRoomPayload,
  InvitationStatus,
  KnockStatus,
  RelationshipStatus,
  SideRoomInput,
} from "./rooms.types"
import { RoomNotificationDeliveriesService } from "./room-notification-deliveries.service"
import { cleanName, porosityLabel, serializePorosity } from "./room-presentation"

export type {
  RoomInvitationPayload,
  RoomPorosity,
  RoomMemberPayload,
  RoomNotificationDeliveriesPayload,
  RoomNotificationDeliveryPayload,
  RoomPayload,
  DeleteRoomMemberPayload,
  DeleteRoomPayload,
} from "./rooms.types"

@Injectable()
export class RoomsService {
  @Inject(RoomNotificationDeliveriesService)
  private readonly deliveries!: RoomNotificationDeliveriesService

  @Inject(RoomRelationshipsService)
  private readonly relationships!: RoomRelationshipsService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(UploadsService)
  private readonly uploadsService!: UploadsService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  updateFeedbackSettings(roomId: number, userId: number, input: UpdateRoomFeedbackSettingsInput) {
    return updateRoomFeedbackSettings(this.prisma, roomId, userId, input)
  }

  async createRoom(userId: number, input: RoomInput): Promise<RoomPayload> {
    if (!userId) throw new NotFoundException("Not Found")

    const user = await this.prisma.user.findUnique({ where: { id: Number(userId ?? 0) } })
    if (!user) throw new NotFoundException("Not Found")

    const name = cleanName(input.name)
    const now = new Date()
    const room = await this.prisma.$transaction(async transaction => {
      const room = await transaction.room.create({
        data: {
          name,
          porosity: this.cleanPorosity(input.porosity) ?? "open",
          owner_id: user.id,
          created_at: now,
          updated_at: now,
        },
      })

      await transaction.roomMembership.create({
        data: {
          room_id: room.id,
          user_id: user.id,
          disabled: false,
          notify: true,
          created_at: now,
          updated_at: now,
        },
      })

      return room
    })

    if (input.avatarFile) {
      await this.uploadsService.createAttachmentUpload(userId, input.avatarFile, {
        record_type: "Circle",
        record_id: room.id,
        name: "avatar",
      })
    }

    captureCommunityCreated({ userId, roomId: room.id })

    return this.serializeCommunity(room, {
      canEditReplyMode: true,
      access: this.memberAccess(room, user.id),
      viewerUserId: user.id,
    })
  }

  async fetchRoom(id: number, userId: number): Promise<RoomPayload> {
    const access = await this.circleAccess.require(id, userId)
    const room = access.room

    return this.serializeCommunity(room, {
      canEditReplyMode: access.canManage,
      access,
      viewerUserId: userId,
    })
  }

  async listMembers(id: number, userId: number): Promise<{ members: RoomMemberPayload[] }> {
    const access = await this.circleAccess.require(id, userId)
    if (hasLimitedRoomHistory(access)) throw new ForbiddenException("Forbidden")
    return this.serializeMembers(id, userId)
  }

  /** Chat identity hydration is limited to authors of messages the visitor can read. */
  async listMembersForChat(id: number, userId: number): Promise<{ members: RoomMemberPayload[] }> {
    const access = await this.circleAccess.require(id, userId)
    if (!hasLimitedRoomHistory(access)) return this.serializeMembers(id, userId)
    return this.serializeMembers(id, userId, await limitedChatAuthorIds(this.prisma, id))
  }

  private async serializeMembers(id: number, userId: number, authorIds?: number[]): Promise<{ members: RoomMemberPayload[] }> {
    const members = await this.prisma.roomMembership.findMany({
      where: { room_id: id, disabled: false, ...(authorIds ? { user_id: { in: authorIds } } : {}) },
      include: { user: true },
      orderBy: { id: "asc" },
    })
    const userIds = members
      .map((member) => Number(member.user_id ?? 0))
      .filter((value): value is number => Boolean(value))
    const avatarMap = await identityImageUrls(this.prisma, "User", userIds)
    const now = new Date()
    const activeSince = new Date(now.getTime() - 90_000)
    const sessions = userIds.length
      ? await this.prisma.chatPresenceSession.findMany({
          where: { user_id: { in: userIds } },
          include: { room: { select: { id: true, name: true } } },
          orderBy: [{ last_seen_at: "desc" }, { id: "desc" }],
        })
      : []
    const sessionsByUser = new Map<number, typeof sessions>()
    sessions.forEach((session) => {
      const list = sessionsByUser.get(session.user_id) ?? []
      list.push(session)
      sessionsByUser.set(session.user_id, list)
    })

    return {
      members: await Promise.all(members.map(async (member) => {
        const userAvatarUrl = avatarMap.get(member.user_id) ?? null
        const memberSessions = sessionsByUser.get(member.user_id) ?? []
        const currentSession = memberSessions.find(
          (session) => session.room_id === id && !session.left_at && session.last_seen_at >= activeSince,
        )
        const lastSession = memberSessions[0] ?? null
        const locationAccess = lastSession ? await this.circleAccess.resolve(lastSession.room_id, userId) : null

        return {
          id: Number(member.id ?? 0),
          user_id: Number(member.user_id ?? 0),
          display_username: member.username_override || member.user?.username || "user",
          display_avatar_url: userAvatarUrl,
          avatar_url: userAvatarUrl,
          presence: {
            is_here: Boolean(currentSession),
            last_seen_at: lastSession?.last_seen_at.toISOString() ?? null,
          },
          location: lastSession
            ? locationAccess
              ? { room_id: lastSession.room_id, name: lastSession.room?.name ?? null, is_private: false }
              : { room_id: null, name: "Another room", is_private: true }
            : { room_id: null, name: null, is_private: false },
        }
      })),
    }
  }

  async listAdjacentRooms(parentId: number, userId: number, now = new Date()) {
    return this.relationships.listAdjacentRooms(parentId, userId, now)
  }

  async createSideRoom(parentId: number, userId: number, input: SideRoomInput, now = new Date()) {
    return this.relationships.createSideRoom(parentId, userId, input, now)
  }

  async joinRoom(roomId: number, userId: number, now = new Date()) {
    return this.relationships.joinRoom(roomId, userId, now)
  }

  async listJoinRequests(roomId: number, managerId: number) {
    return this.relationships.listJoinRequests(roomId, managerId)
  }

  async reviewJoinRequest(roomId: number, requestId: number, managerId: number, status: RelationshipStatus, now = new Date()) {
    return this.relationships.reviewJoinRequest(roomId, requestId, managerId, status, now)
  }

  async inviteExistingUser(roomId: number, targetUserId: number, inviterId: number, now = new Date()) {
    return this.relationships.inviteExistingUser(roomId, targetUserId, inviterId, now)
  }

  async suggestKnock(roomId: number, targetUserId: number, suggesterId: number, now = new Date()) {
    return this.relationships.suggestKnock(roomId, targetUserId, suggesterId, now)
  }

  async acceptMemberInvitation(roomId: number, invitationId: number, userId: number, now = new Date()) {
    return this.relationships.acceptMemberInvitation(roomId, invitationId, userId, now)
  }

  async listMemberInvitations(roomId: number, managerId: number) {
    return this.relationships.listMemberInvitations(roomId, managerId)
  }

  async reviewMemberInvitation(
    roomId: number,
    invitationId: number,
    managerId: number,
    status: InvitationStatus,
    now = new Date(),
  ) {
    return this.relationships.reviewMemberInvitation(roomId, invitationId, managerId, status, now)
  }

  async knock(roomId: number, userId: number, now = new Date()) {
    return this.relationships.knock(roomId, userId, now)
  }

  async listKnocks(roomId: number, managerId: number) {
    return this.relationships.listKnocks(roomId, managerId)
  }

  async reviewKnock(roomId: number, knockId: number, managerId: number, status: KnockStatus, now = new Date()) {
    return this.relationships.reviewKnock(roomId, knockId, managerId, status, now)
  }

  async removeMember(roomId: number, userId: number, membershipId: number): Promise<DeleteRoomMemberPayload> {
    return withActiveRoomTransaction(this.prisma, roomId, async transaction => {
      const room = await transaction.room.findFirst({ where: { id: roomId, owner_id: userId, deleted_at: null }, select: { id: true } })
      if (!room) throw new ForbiddenException("Forbidden")
      const membership = await transaction.roomMembership.findFirst({
        where: { id: Number(membershipId ?? 0), room_id: Number(roomId ?? 0), disabled: false },
        select: { id: true, room_id: true, user_id: true },
      })
      if (!membership) throw new NotFoundException("Not Found")
      const now = new Date()
      await transaction.roomMembership.update({
        where: { id: membership.id },
        data: { disabled: true, revoked_at: now, updated_at: now },
      })
      return { success: true, member_id: Number(membership.id ?? 0) }
    })
  }

  async deleteRoom(roomId: number, userId: number): Promise<DeleteRoomPayload> {
    const id = Number(roomId ?? 0)
    const room = await this.prisma.room.findFirst({
      where: { id, owner_id: Number(userId ?? 0) },
      select: { id: true },
    })
    if (!room) throw new ForbiddenException("Forbidden")

    const now = new Date()
    await this.prisma.$transaction(async transaction => {
      await transaction.room.updateMany({ where: { id, owner_id: userId, deleted_at: null }, data: { deleted_at: now, updated_at: now } })
      await transaction.roomMembership.updateMany({
        where: { room_id: id, disabled: false },
        data: { disabled: true, revoked_at: now, updated_at: now },
      })
      await transaction.invite.updateMany({ where: { room_id: id, used_at: null }, data: { expires_at: now, updated_at: now } })
      await transaction.roomVisit.updateMany({ where: { room_id: id, last_activity_at: { lte: now }, expires_at: { gt: now } }, data: { expires_at: now } })
      // Child Rooms retain independent ownership, membership and history.
      await transaction.room.updateMany({ where: { parent_id: id }, data: { parent_id: null, updated_at: now } })
    })

    return { success: true, room_id: id }
  }

  async listNotificationDeliveries(roomId: number, userId: number): Promise<RoomNotificationDeliveriesPayload> {
    await this.assertCommunityOwner(roomId, userId)
    return this.deliveries.listForCommunity(roomId)
  }

  async updateRoom(id: number, userId: number, input: RoomInput): Promise<RoomPayload> {
    const room = await this.prisma.room.findFirst({
      where: { id: Number(id ?? 0), owner_id: Number(userId ?? 0), deleted_at: null },
    })
    if (!room) throw new ForbiddenException("Forbidden")

    let updated = room
    const updateData: Prisma.RoomUpdateInput = {}
    if (input.name !== undefined) {
      updateData.name = cleanName(input.name)
    }
    if (input.porosity !== undefined) {
      updateData.porosity = this.cleanPorosity(input.porosity) ?? "open"
    }

    if (Object.keys(updateData).length > 0) {
      updated = await this.prisma.room.update({
        where: { id: room.id, deleted_at: null },
        data: {
          ...updateData,
          updated_at: new Date(),
        },
      })
    }

    if (input.removeAvatar) {
      await this.uploadsService.removeAttachment(userId, {
        record_type: "Circle",
        record_id: room.id,
        name: "avatar",
      })
    }

    if (input.avatarFile) {
      await this.uploadsService.createAttachmentUpload(userId, input.avatarFile, {
        record_type: "Circle",
        record_id: room.id,
        name: "avatar",
      })
    }

    return this.serializeCommunity(updated, {
      canEditReplyMode: true,
      access: this.memberAccess(updated, userId),
      viewerUserId: userId,
    })
  }

  private async serializeCommunity(
    room: {
      id: number
      name: string | null
      owner_id: number | null
      parent_id?: number | null
      porosity?: string | null
    },
    options: { canEditReplyMode?: boolean; access: RoomAccessContext; viewerUserId: number },
  ): Promise<RoomPayload> {
    const parent = room.parent_id
      ? await this.prisma.room.findUnique({
          where: { id: room.parent_id, deleted_at: null },
          select: { id: true, name: true },
        })
      : null
    const requested =
      options.access.kind === "visitor"
        ? await this.prisma.roomJoinRequest.findUnique({
            where: { room_id_user_id: { room_id: room.id, user_id: options.viewerUserId } },
            select: { id: true, status: true },
          })
        : null
    const viewerInvitation =
      options.access.kind === "visitor"
        ? await this.prisma.roomMemberInvitation.findUnique({
            where: { room_id_user_id: { room_id: room.id, user_id: options.viewerUserId } },
            include: { user: true, invited_by: true },
          })
        : null
    const replySettings = serializeRoomFeedbackSettings(await roomFeedbackSettings(this.prisma, room.id), { canEditReplyMode: options.canEditReplyMode })
    return {
      id: Number(room.id ?? 0),
      name: room.name,
      avatar_url: await identityImageUrl(this.prisma, "Circle", room.id),
      owner_id: room.owner_id,
      canManage: Boolean(options.canEditReplyMode),
      replySettings,
      porosity: serializePorosity(room.porosity),
      porosity_label: porosityLabel(room.porosity),
      parent: parent ? { id: parent.id, name: parent.name } : null,
      membership_state:
        options.access.kind === "member"
          ? "member"
          : requested && requested.status !== "approved"
            ? "requested"
            : options.access.source === "knock"
              ? "admitted_visitor"
              : "visitor",
      access: this.serializeAccess(options.access),
      viewer_invitation:
        viewerInvitation?.status === "pending" ? await this.relationships.serializeInvitation(viewerInvitation) : null,
    }
  }

  private memberAccess(
    room: { id: number; name: string | null; owner_id: number | null; parent_id?: number | null; porosity?: string | null },
    userId: number,
  ): RoomAccessContext {
    return {
      room: {
        id: room.id,
        name: room.name,
        owner_id: room.owner_id,
        parent_id: room.parent_id ?? null,
        porosity: serializePorosity(room.porosity),
      },
      kind: "member",
      source: "membership",
      membershipId: null,
      canManage: room.owner_id === userId,
      canCreateSideCircle: true,
      canViewNotes: true,
      canWriteWall: true,
      canParticipateActivities: true,
    }
  }

  private serializeAccess(access: RoomAccessContext) {
    return {
      kind: access.kind,
      can_manage: access.canManage,
      can_create_adjacent_room: access.canCreateSideCircle,
      can_view_notes: access.canViewNotes,
      can_write_wall: access.canWriteWall,
      can_participate_rounds: access.canParticipateActivities,
    }
  }

  private async assertCommunityOwner(roomId: number, userId: number) {
    const room = await this.prisma.room.findFirst({
      where: { id: Number(roomId ?? 0), owner_id: Number(userId ?? 0), deleted_at: null },
      select: { id: true },
    })
    if (!room) throw new ForbiddenException("Forbidden")
  }

  private cleanPorosity(value?: string | null): RoomPorosity | undefined {
    if (value === "open" || value === "masked" || value === "closed") return value
    return undefined
  }
}
