import { activateRoomMembership } from "./room-membership"
import { withActiveRoomTransaction } from "./room-membership-transaction"
import { activeRoomVisit, grantRoomVisit } from "./room-visit-lease"
import { roomDoorEligibility } from "./room-door-policy"
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PrismaService } from "../../../prisma/prisma.service"
import { BossService } from "../../../queue/boss.service"
import { identityImageUrl } from "../uploads/identity-images"
import { RoomAccessService } from "./room-access.service"
import type {
  RoomInvitationPayload,
  InvitationStatus,
  KnockStatus,
  RelationshipStatus,
  SideRoomInput,
} from "./rooms.types"
import { cleanName, porosityLabel, serializePorosity } from "./room-presentation"

/** Owns side-circle creation, admission, invitations, and membership transitions. */
@Injectable()
export class RoomRelationshipsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  @Inject(BossService)
  private readonly boss!: BossService

  async listAdjacentRooms(parentId: number, userId: number, now = new Date()) {
    const parentAccess = await this.circleAccess.require(parentId, userId)
    const children = await this.prisma.room.findMany({
      where: {
        parent_id: parentId,
        deleted_at: null,
      },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    })
    const activeSince = new Date(now.getTime() - 90_000)

    const sideRooms = await Promise.all(
      children.map(async (circle) => {
        const childAccess = await this.circleAccess.resolveAdmission(circle.id, userId, now)
        const eligibility = roomDoorEligibility(parentAccess, serializePorosity(circle.porosity))
        if (eligibility === "hidden" && childAccess?.kind !== "member") return null
        const [memberships, presence, joinRequest, memberInvitation] = await Promise.all([
          this.prisma.roomMembership.findMany({
            where: { room_id: circle.id, disabled: false },
            select: { user_id: true },
          }),
          this.prisma.chatPresenceSession.findMany({
            where: { room_id: circle.id, left_at: null, last_seen_at: { gte: activeSince } },
            select: { user_id: true },
          }),
          this.prisma.roomJoinRequest.findUnique({
            where: { room_id_user_id: { room_id: circle.id, user_id: userId } },
            select: { status: true },
          }),
          this.prisma.roomMemberInvitation.findUnique({
            where: { room_id_user_id: { room_id: circle.id, user_id: userId } },
            include: { user: true, invited_by: true },
          }),
        ])
        const porosity = serializePorosity(circle.porosity)
        const member = childAccess?.kind === "member"
        const invited = !member && memberInvitation?.status === "pending"
        const requested = !member && Boolean(joinRequest && joinRequest.status !== "approved")
        return {
          id: circle.id,
          name: circle.name,
          porosity,
          porosity_label: porosityLabel(porosity),
          member_count: memberships.length,
          present_count: new Set(presence.map((session) => session.user_id)).size,
          viewer_state:
            member
              ? "member"
              : invited
                ? "invited"
              : requested
                ? "requested"
                : childAccess?.source === "knock"
                  ? "admitted_visitor"
                  : childAccess
                    ? "visitor"
                    : "none",
          viewer_invitation: invited ? await this.serializeInvitation(memberInvitation) : null,
          actions: {
            enter: Boolean(childAccess),
            join: porosity === "open" && !member && !invited,
            request_join: porosity === "masked" && !member && !invited && !joinRequest,
            knock: eligibility === "knock" && !member && !invited && !childAccess,
            invite: porosity === "closed" ? member : parentAccess.kind === "member",
            suggest_knock: porosity === "closed" && member,
          },
        }
      }),
    )

    return {
      parent: { id: parentAccess.room.id, name: parentAccess.room.name },
      adjacent_rooms: sideRooms.filter((circle) => circle !== null),
      can_create: parentAccess.canCreateSideCircle,
    }
  }

  async createSideRoom(parentId: number, userId: number, input: SideRoomInput, now = new Date()) {
    await this.circleAccess.requireMember(parentId, userId)
    const selectedUserIds = Array.from(
      new Set((input.userIds ?? []).map((value) => Number(value ?? 0)).filter((value) => value > 0 && value !== userId)),
    )
    const parentMembers = await this.prisma.roomMembership.findMany({
      where: { room_id: parentId, user_id: { in: [userId, ...selectedUserIds] }, disabled: false },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { id: "asc" },
    })
    const creatorMembership = parentMembers.find((membership) => membership.user_id === userId)
    if (!creatorMembership) throw new NotFoundException("Not Found")
    const inviteeMemberships = parentMembers.filter((membership) => selectedUserIds.includes(membership.user_id))
    if (inviteeMemberships.length !== selectedUserIds.length) {
      throw new BadRequestException("Selected users must be active parent-circle members")
    }
    const displayName = (membership: (typeof parentMembers)[number]) =>
      membership.username_override || membership.user.username
    const name = cleanName(input.name) ?? [creatorMembership, ...inviteeMemberships].map(displayName).join(", ")

    const created = await this.prisma.$transaction(async (transaction) => {
      const circle = await transaction.room.create({
        data: {
          name,
          owner_id: userId,
          parent_id: parentId,
          porosity: "masked",
          created_at: now,
          updated_at: now,
        },
      })
      await transaction.roomMembership.create({
        data: {
          room_id: circle.id,
          user_id: userId,
          disabled: false,
          notify: true,
          created_at: now,
          updated_at: now,
        },
      })
      const invitations = await Promise.all(
        inviteeMemberships.map((membership) =>
          transaction.roomMemberInvitation.create({
            data: {
              room_id: circle.id,
              user_id: membership.user_id,
              invited_by_id: userId,
              status: "pending",
              created_at: now,
              updated_at: now,
            },
          }),
        ),
      )
      return { room: circle, invitations }
    })

    await Promise.all(
      created.invitations.map((invitation) =>
        this.notifyCircleEvent(
          "circle_member_invited",
          userId,
          created.room.id,
          invitation.user_id,
          { invitation_id: invitation.id },
          `/app/rooms/${created.room.id}`,
          now,
        ),
      ),
    )

    return {
      room: {
        id: created.room.id,
        name: created.room.name,
        owner_id: created.room.owner_id,
        parent_id: created.room.parent_id,
        porosity: serializePorosity(created.room.porosity),
        porosity_label: porosityLabel(created.room.porosity),
      },
      invitations: created.invitations.map((invitation) => ({ id: invitation.id, user_id: invitation.user_id, status: invitation.status })),
    }
  }

  async joinRoom(circleId: number, userId: number, now = new Date()) {
    const access = await this.circleAccess.require(circleId, userId)
    if (access.kind === "member") return { state: "member" as const }
    if (access.room.porosity === "closed") throw new ForbiddenException("Knock-only circles cannot be joined directly")
    if (access.room.porosity === "open") {
      await this.activateMembership(circleId, userId, now)
      return { state: "member" as const }
    }

    const existing = await this.prisma.roomJoinRequest.findUnique({
      where: { room_id_user_id: { room_id: circleId, user_id: userId } },
    })
    if (!existing) {
      const request = await this.prisma.roomJoinRequest.create({
        data: { room_id: circleId, user_id: userId, status: "pending", created_at: now, updated_at: now },
      })
      if (access.room.owner_id && access.room.owner_id !== userId) {
        await this.notifyCircleEvent(
          "circle_join_requested",
          userId,
          circleId,
          access.room.owner_id,
          { join_request_id: request.id },
          `/app/rooms/${circleId}`,
          now,
        )
      }
    }
    return { state: "requested" as const }
  }

  async listJoinRequests(circleId: number, managerId: number) {
    await this.circleAccess.requireManager(circleId, managerId)
    const requests = await this.prisma.roomJoinRequest.findMany({
      where: { room_id: circleId },
      include: { user: true },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    })
    return { join_requests: await Promise.all(requests.map((request) => this.serializeJoinRequest(request))) }
  }

  async reviewJoinRequest(circleId: number, requestId: number, managerId: number, status: RelationshipStatus, now = new Date()) {
    await this.circleAccess.requireManager(circleId, managerId)
    if (!["pending", "approved", "declined"].includes(status)) throw new BadRequestException("Invalid join request status")
    const updated = await withActiveRoomTransaction(this.prisma, circleId, async transaction => {
      await this.assertManagerInTransaction(transaction, circleId, managerId)
      const request = await transaction.roomJoinRequest.findUnique({ where: { id: requestId }, include: { user: true } })
      if (!request || request.room_id !== circleId) throw new NotFoundException("Not Found")
      if (request.status === status) return request
      if (status === "approved") await this.activateMembershipInTransaction(transaction, circleId, request.user_id, now, true)
      if (request.status === "approved" && status !== "approved") {
        await this.deactivateMembershipInTransaction(transaction, circleId, request.user_id, now)
      }
      const changed = await transaction.roomJoinRequest.update({
        where: { id: request.id },
        data: { status, reviewed_by_id: managerId, reviewed_at: status === "pending" ? null : now, updated_at: now },
        include: { user: true },
      })
      if (status === "approved") {
        await this.notifyCircleEvent("circle_join_approved", managerId, circleId, request.user_id,
          { join_request_id: request.id }, `/app/rooms/${circleId}`, now, transaction)
      }
      return changed
    })
    return { join_request: await this.serializeJoinRequest(updated) }
  }

  async inviteExistingUser(circleId: number, targetUserId: number, inviterId: number, now = new Date()) {
    const invitation = await withActiveRoomTransaction(this.prisma, circleId, async transaction => {
      const access = await this.circleAccess.require(circleId, inviterId)
      if (!access.room.parent_id) throw new ForbiddenException("Side-circle invitation required")
      if (access.room.porosity === "closed") {
        if (access.kind !== "member") throw new ForbiddenException("Members only")
      } else {
        await this.circleAccess.requireMember(access.room.parent_id, inviterId)
      }
      const target = await transaction.user.findUnique({ where: { id: targetUserId }, select: { id: true } })
      if (!target || target.id === inviterId) throw new ForbiddenException("Forbidden")
      const parentMembership = await transaction.roomMembership.findFirst({
        where: { room_id: access.room.parent_id, user_id: targetUserId, disabled: false },
        select: { id: true },
      })
      if (!parentMembership) throw new ForbiddenException("Target must be an active parent-circle member")
      const currentMember = await transaction.roomMembership.findFirst({
        where: { room_id: circleId, user_id: targetUserId, disabled: false },
        select: { id: true },
      })
      if (currentMember) throw new BadRequestException("User is already a member")
      const existing = await transaction.roomMemberInvitation.findUnique({
        where: { room_id_user_id: { room_id: circleId, user_id: targetUserId } },
      })
      const changed = existing
        ? await transaction.roomMemberInvitation.update({
            where: { id: existing.id },
            data: { status: "pending", invited_by_id: inviterId, responded_at: null, updated_at: now },
            include: { user: true, invited_by: true },
          })
        : await transaction.roomMemberInvitation.create({
            data: {
              room_id: circleId,
              user_id: targetUserId,
              invited_by_id: inviterId,
              status: "pending",
              created_at: now,
              updated_at: now,
            },
            include: { user: true, invited_by: true },
          })
      await this.notifyCircleEvent(
        "circle_member_invited",
        inviterId,
        circleId,
        targetUserId,
        { invitation_id: changed.id },
        `/app/rooms/${circleId}`,
        now,
        transaction,
      )
      return changed
    })
    return { invitation: await this.serializeInvitation(invitation) }
  }

  async suggestKnock(circleId: number, targetUserId: number, suggesterId: number, now = new Date()) {
    const access = await this.circleAccess.requireMember(circleId, suggesterId)
    if (!access.room.parent_id || access.room.porosity !== "closed") {
      throw new ForbiddenException("Knock suggestions are only available for knock-only side circles")
    }
    if (!Number.isFinite(targetUserId) || targetUserId <= 0 || targetUserId === suggesterId) {
      throw new ForbiddenException("Forbidden")
    }
    const [target, parentMembership, currentMember] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } }),
      this.prisma.roomMembership.findFirst({
        where: { room_id: access.room.parent_id, user_id: targetUserId, disabled: false },
        select: { id: true },
      }),
      this.prisma.roomMembership.findFirst({
        where: { room_id: circleId, user_id: targetUserId, disabled: false },
        select: { id: true },
      }),
    ])
    if (!target || !parentMembership) {
      throw new ForbiddenException("Target must be an active parent-circle member")
    }
    if (currentMember) throw new BadRequestException("User is already a member")

    await this.notifyCircleEvent(
      "circle_knock_suggested",
      suggesterId,
      circleId,
      targetUserId,
      {},
      `/app/rooms/${access.room.parent_id}/adjacent-rooms`,
      now,
    )
    return { state: "suggested" as const }
  }

  async acceptMemberInvitation(circleId: number, invitationId: number, userId: number, now = new Date()) {
    const updated = await withActiveRoomTransaction(this.prisma, circleId, async transaction => {
      const invitation = await transaction.roomMemberInvitation.findUnique({ where: { id: invitationId } })
      if (!invitation || invitation.room_id !== circleId || invitation.user_id !== userId) {
        throw new NotFoundException("Not Found")
      }
      if (invitation.status !== "pending" && invitation.status !== "accepted") {
        throw new ForbiddenException("Invitation is not active")
      }
      await this.activateMembershipInTransaction(transaction, circleId, userId, now)
      return await transaction.roomMemberInvitation.update({
        where: { id: invitation.id },
        data: { status: "accepted", responded_at: invitation.responded_at ?? now, updated_at: now },
        include: { user: true, invited_by: true },
      })
    })
    return { invitation: await this.serializeInvitation(updated) }
  }

  async listMemberInvitations(circleId: number, managerId: number) {
    await this.circleAccess.requireManager(circleId, managerId)
    const invitations = await this.prisma.roomMemberInvitation.findMany({
      where: { room_id: circleId },
      include: { user: true, invited_by: true },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    })
    return { invitations: await Promise.all(invitations.map((invitation) => this.serializeInvitation(invitation))) }
  }

  async reviewMemberInvitation(
    circleId: number,
    invitationId: number,
    managerId: number,
    status: InvitationStatus,
    now = new Date(),
  ) {
    await this.circleAccess.requireManager(circleId, managerId)
    if (!["pending", "accepted", "declined", "revoked"].includes(status)) throw new BadRequestException("Invalid invitation status")
    const updated = await withActiveRoomTransaction(this.prisma, circleId, async transaction => {
      await this.assertManagerInTransaction(transaction, circleId, managerId)
      const invitation = await transaction.roomMemberInvitation.findUnique({ where: { id: invitationId } })
      if (!invitation || invitation.room_id !== circleId) throw new NotFoundException("Not Found")
      if (status === "accepted") await this.activateMembershipInTransaction(transaction, circleId, invitation.user_id, now, true)
      return await transaction.roomMemberInvitation.update({
        where: { id: invitation.id },
        data: {
          status,
          responded_at: status === "pending" ? null : now,
          invited_by_id: managerId,
          updated_at: now,
        },
        include: { user: true, invited_by: true },
      })
    })
    return { invitation: await this.serializeInvitation(updated) }
  }

  async knock(circleId: number, userId: number, now = new Date()) {
    const circle = await this.circleAccess.findCircle(circleId)
    if (!circle.parent_id) throw new ForbiddenException("Knock is not available")
    const parentAccess = await this.circleAccess.require(circle.parent_id, userId)
    if (roomDoorEligibility(parentAccess, circle.porosity) !== "knock") throw new ForbiddenException("Knock is not available")
    const existing = await this.prisma.roomKnock.findUnique({
      where: { room_id_user_id: { room_id: circleId, user_id: userId } },
    })
    if (existing) {
      if (existing.status === "admitted" && await activeRoomVisit(this.prisma, circleId, userId, now)) return { state: "admitted" }
      // An expired approval or a declined/revoked request can be knocked again.
      // Preserve a manager decision made after this request read the previous state.
      await this.prisma.roomKnock.updateMany({
        where: { id: existing.id, status: existing.status, reviewed_at: existing.reviewed_at },
        data: { status: "pending", reviewed_by_id: null, reviewed_at: null, updated_at: now },
      })
      return { state: "requested" }
    }
    await this.prisma.roomKnock.create({
      data: { room_id: circleId, user_id: userId, status: "pending", created_at: now, updated_at: now },
    })
    return { state: "requested" as const }
  }

  async listKnocks(circleId: number, managerId: number) {
    await this.circleAccess.requireManager(circleId, managerId)
    const knocks = await this.prisma.roomKnock.findMany({
      where: { room_id: circleId },
      include: { user: true },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    })
    return { knocks: await Promise.all(knocks.map((knock) => this.serializeKnock(knock))) }
  }

  async reviewKnock(circleId: number, knockId: number, managerId: number, status: KnockStatus, now = new Date()) {
    await this.circleAccess.requireManager(circleId, managerId)
    if (!["pending", "admitted", "declined", "revoked"].includes(status)) throw new BadRequestException("Invalid knock status")
    const knock = await this.prisma.roomKnock.findUnique({ where: { id: knockId } })
    if (!knock || knock.room_id !== circleId) throw new NotFoundException("Not Found")
    const updated = await this.prisma.$transaction(async tx => {
      const updated = await tx.roomKnock.update({
        where: { id: knock.id },
        data: {
          status,
          reviewed_by_id: managerId,
          reviewed_at: status === "pending" ? null : now,
          updated_at: now,
        },
        include: { user: true },
      })
      if (status === "admitted") await grantRoomVisit(tx, circleId, knock.user_id, "knock", now)
      else await tx.roomVisit.updateMany({ where: { room_id: circleId, user_id: knock.user_id }, data: { expires_at: now } })
      return updated
    })
    return { knock: await this.serializeKnock(updated) }
  }

  private async activateMembership(circleId: number, userId: number, now: Date, managerApproved = false) {
    return withActiveRoomTransaction(this.prisma, circleId, transaction => this.activateMembershipInTransaction(transaction, circleId, userId, now, managerApproved))
  }

  private async activateMembershipInTransaction(transaction: Prisma.TransactionClient, circleId: number, userId: number, now: Date, managerApproved = false) {
    const user = await transaction.user.findUnique({ where: { id: userId }, select: { id: true, username: true } })
    if (!user) throw new NotFoundException("Not Found")
    await activateRoomMembership(transaction, circleId, user, now, managerApproved)
  }

  private async assertManagerInTransaction(transaction: Prisma.TransactionClient, circleId: number, managerId: number) {
    const manager = await transaction.room.findFirst({
      where: { id: circleId, owner_id: managerId, deleted_at: null, memberships: { some: { user_id: managerId, disabled: false } } },
      select: { id: true },
    })
    if (!manager) throw new ForbiddenException("Circle manager only")
  }

  private async deactivateMembershipInTransaction(transaction: Prisma.TransactionClient, circleId: number, userId: number, now: Date) {
    const membership = await transaction.roomMembership.findFirst({
      where: { room_id: circleId, user_id: userId, disabled: false },
      select: { id: true },
    })
    if (!membership) return
    await transaction.roomMembership.update({
      where: { id: membership.id },
      data: { disabled: true, revoked_at: now, updated_at: now },
    })
  }

  private async notifyCircleEvent(
    eventType: string,
    actorId: number,
    circleId: number,
    targetUserId: number,
    payload: Prisma.InputJsonObject,
    targetPath: string,
    now: Date,
    transaction?: Prisma.TransactionClient,
  ) {
    const event = await (transaction ?? this.prisma).notificationEvent.create({
      data: {
        event_type: eventType,
        actor_id: actorId,
        room_id: circleId,
        target_user_id: targetUserId,
        payload,
        target_path: targetPath,
        created_at: now,
        updated_at: now,
      },
    })
    if (transaction) await this.boss.enqueueInTransaction(transaction, "notifications.fanout", { eventId: event.id })
    else await this.boss.enqueue("notifications.fanout", { eventId: event.id })
  }

  private async serializeJoinRequest(request: {
    id: number
    status: string
    created_at: Date
    reviewed_at: Date | null
    user: { id: number; username: string }
  }) {
    return {
      id: request.id,
      user: {
        id: request.user.id,
        display_username: request.user.username,
        avatar_url: await identityImageUrl(this.prisma, "User", request.user.id),
      },
      status: request.status,
      created_at: request.created_at.toISOString(),
      reviewed_at: request.reviewed_at?.toISOString() ?? null,
    }
  }

  async serializeInvitation(invitation: {
    id: number
    room_id: number
    status: string
    created_at: Date
    responded_at: Date | null
    user: { id: number; username: string }
    invited_by: { id: number; username: string }
  }): Promise<RoomInvitationPayload> {
    return {
      id: invitation.id,
      room_id: invitation.room_id,
      user: {
        id: invitation.user.id,
        display_username: invitation.user.username,
        avatar_url: await identityImageUrl(this.prisma, "User", invitation.user.id),
      },
      invited_by: {
        id: invitation.invited_by.id,
        display_username: invitation.invited_by.username,
      },
      status: invitation.status,
      created_at: invitation.created_at.toISOString(),
      responded_at: invitation.responded_at?.toISOString() ?? null,
    }
  }

  private async serializeKnock(knock: {
    id: number
    status: string
    created_at: Date
    reviewed_at: Date | null
    user: { id: number; username: string }
  }) {
    return {
      id: knock.id,
      user: {
        id: knock.user.id,
        display_username: knock.user.username,
        avatar_url: await identityImageUrl(this.prisma, "User", knock.user.id),
      },
      status: knock.status,
      created_at: knock.created_at.toISOString(),
      reviewed_at: knock.reviewed_at?.toISOString() ?? null,
    }
  }
}
