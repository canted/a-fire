import { BossService } from "../../../queue/boss.service"
import { INVITE_EMAIL_QUEUE } from "../../../queue/queue-names"
import { inviteTokenDigest } from "../../../mailer/invite-email.processor"
import { withActiveRoomTransaction } from "../rooms/room-membership-transaction"
import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import type { Prisma } from "@prisma/client"
import { InviteIndexResponse, InvitePayload, InviteStatus, InviteSuggestionsResponse, InviteType } from "./invites.types"
import crypto from "node:crypto"
import { captureInviteCreated } from "../../../runtime/posthog"

const INVITE_TYPE_MAP: Record<InviteType, number> = {
  room_invite: 0,
  new_room_invite: 1,
}

const INVITE_TYPE_REVERSE: Record<number, InviteType> = {
  0: "room_invite",
  1: "new_room_invite",
}

type InviteWithRelations = {
  id: number
  email: string
  invite_type: number
  token: string
  room_id: number | null
  room: { id: number; name: string | null } | null
  invited_by: { id: number; username: string }
  expires_at: Date
  used_at: Date | null
  created_at: Date
}

type SuggestionMembership = {
  id: number
  room_id: number
  user_id: number
  username_override: string | null
  room?: { id: number; name: string | null } | null
  user?: { id: number; email: string; username: string } | null
}

type InviteRecipientUser = { email: string; username: string } | null

@Injectable()
export class InvitesService {
  @Inject(BossService)
  private readonly boss!: BossService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  async listInvites(
    userId: number,
    filters: { roomId?: number; status?: InviteStatus; search?: string },
  ): Promise<InviteIndexResponse> {
    const memberRoomIds = await this.memberRoomIds(userId)
    if (filters.roomId && !memberRoomIds.includes(filters.roomId)) {
      throw new ForbiddenException("Forbidden")
    }

    const where: Record<string, unknown> = {}
    if (memberRoomIds.length > 0) {
      where.room_id = { in: memberRoomIds.map((id) => this.toNumber(id) ?? Number(0)) }
    } else {
      where.room_id = -1
    }

    if (filters.roomId) {
      where.room_id = this.toNumber(filters.roomId)
    }

    if (filters.status === "active") {
      where.used_at = null
      where.expires_at = { gt: new Date() }
    } else if (filters.status === "expired") {
      where.expires_at = { lte: new Date() }
    } else if (filters.status === "used") {
      where.used_at = { not: null }
    }

    if (filters.search) {
      where.email = { contains: filters.search, mode: "insensitive" }
    }

    const invites = await this.prisma.invite.findMany({
      where,
      include: { room: true, invited_by: true },
      orderBy: { created_at: "desc" },
      take: 200,
    })
    const recipientUsersByEmail = await this.recipientUsersByEmail(invites.map((invite) => invite.email))

    return {
      invites: invites.map((invite) =>
        this.serializeInvite(invite, recipientUsersByEmail.get(this.normalizeEmail(invite.email)) ?? null),
      ),
      permissions: { new_room_invite_allowed: false },
    }
  }

  async createInvite(
    userId: number,
    payload: { email?: string; invitee_membership_id?: number; invite_type?: InviteType; room_id?: number | null },
  ): Promise<InvitePayload> {
    const inviteType = payload.invite_type ?? "room_invite"
    if (inviteType === "new_room_invite") {
      throw new ForbiddenException("Forbidden")
    }

    if (!payload.room_id) {
      throw new UnprocessableEntityException("room_id is required")
    }

    const result = await withActiveRoomTransaction(this.prisma, Number(payload.room_id), async transaction => {
      const memberRoomIds = await this.memberRoomIds(userId, transaction)
      if (!memberRoomIds.includes(Number(payload.room_id))) throw new ForbiddenException("Forbidden")
      const community = await transaction.room.findUnique({ where: { id: Number(payload.room_id), deleted_at: null } })
      if (!community) throw new NotFoundException("Community not found")
      const recipient = payload.invitee_membership_id
        ? await this.resolveInviteeMembership(userId, memberRoomIds, community.id, payload.invitee_membership_id, transaction)
        : await this.resolveInviteEmail(payload.email, community.id, transaction)
      const existing = await this.findCommunityInvite(recipient.email, community.id, inviteType, transaction)
      const invite = existing
        ? this.isActive(existing) ? existing : await this.refreshInvite(existing, userId, transaction)
        : await transaction.invite.create({
            data: {
              email: recipient.email, invite_type: INVITE_TYPE_MAP[inviteType],
              token: await this.generateToken(transaction), expires_at: this.nextInviteExpiration(),
              invited_by_id: userId, room_id: community.id,
              created_at: new Date(), updated_at: new Date(),
            },
            include: { room: true, invited_by: true },
          })
      await this.enqueueInviteEmail(transaction, invite)
      return { invite, recipient, created: !existing }
    })
    if (result.created) captureInviteCreated({ userId, inviteId: result.invite.id, inviteType, roomId: result.invite.room_id ?? Number(payload.room_id) })
    return this.serializeInvite(result.invite, result.recipient.user)
  }

  async listInviteSuggestions(
    userId: number,
    filters: { roomId?: number; query?: string },
  ): Promise<InviteSuggestionsResponse> {
    if (!filters.roomId) {
      throw new UnprocessableEntityException("room_id is required")
    }

    const currentMemberships = await this.prisma.roomMembership.findMany({
      where: { user_id: this.toNumber(userId), disabled: false },
      include: { room: true },
      orderBy: { id: "asc" },
    })
    const targetRoomId = this.toNumber(filters.roomId)
    if (!currentMemberships.some((membership) => this.toNumber(membership.room_id) === targetRoomId)) {
      throw new ForbiddenException("Forbidden")
    }
    const normalizedQuery = (filters.query ?? "").trim().toLowerCase()
    if (!normalizedQuery) {
      return { suggestions: [] }
    }

    const sourceRoomIds = currentMemberships
      .map((membership) => this.toNumber(membership.room_id))
      .filter((communityId) => communityId && communityId !== targetRoomId)
    if (sourceRoomIds.length === 0) {
      return { suggestions: [] }
    }

    const candidateMemberships: SuggestionMembership[] = await this.prisma.roomMembership.findMany({
      where: {
        room_id: { in: sourceRoomIds },
        disabled: false,
        user_id: { not: this.toNumber(userId) },
      },
      include: { room: true, user: true },
      orderBy: [{ user_id: "asc" }, { room_id: "asc" }, { id: "asc" }],
    })
    if (candidateMemberships.length === 0) {
      return { suggestions: [] }
    }

    const candidateUserIds = Array.from(new Set(candidateMemberships.map((membership) => this.toNumber(membership.user_id))))
    const targetMemberships = await this.prisma.roomMembership.findMany({
      where: {
        room_id: targetRoomId,
        disabled: false,
        user_id: { in: candidateUserIds },
      },
      select: { user_id: true },
    })
    const existingTargetUserIds = new Set(targetMemberships.map((membership) => this.toNumber(membership.user_id)))
    const byUserId = new Map<
      number,
      {
        invitee_membership_id: number
        display_name: string
        shared_communities: Array<{ id: number; name: string | null }>
      }
    >()

    for (const membership of candidateMemberships) {
      const candidateUserId = this.toNumber(membership.user_id)
      const user = membership.user
      if (!user || existingTargetUserIds.has(candidateUserId)) continue

      const searchableValues = [user.email, user.username, membership.username_override ?? ""]
      if (!searchableValues.some((value) => value.toLowerCase().includes(normalizedQuery))) continue

      const existing = byUserId.get(candidateUserId)
      if (existing) {
        existing.shared_communities.push({
          id: this.toNumber(membership.room_id),
          name: membership.room?.name ?? null,
        })
        continue
      }

      byUserId.set(candidateUserId, {
        invitee_membership_id: this.toNumber(membership.id),
        display_name: membership.username_override || user.username || "Circle member",
        shared_communities: [
          {
            id: this.toNumber(membership.room_id),
            name: membership.room?.name ?? null,
          },
        ],
      })
    }

    return {
      suggestions: Array.from(byUserId.values()).sort((a, b) =>
        a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" }),
      ),
    }
  }

  async expireInvite(userId: number, inviteId: number): Promise<InvitePayload> {
    const updated = await this.withAccessibleInviteTransaction(userId, inviteId, async (transaction, invite) => {
      const now = new Date()
      const expiresAt = invite.expires_at <= now ? invite.expires_at : now
      return transaction.invite.update({
        where: { id: invite.id },
        data: { expires_at: expiresAt, updated_at: now },
        include: { room: true, invited_by: true },
      })
    })
    return this.serializeInviteWithRecipientPrivacy(updated)
  }

  async resendInvite(userId: number, inviteId: number): Promise<InvitePayload> {
    const current = await this.withAccessibleInviteTransaction(userId, inviteId, async (transaction, invite) => {
      if (!this.isActive(invite)) throw new UnprocessableEntityException("Cannot resend expired or used invite.")
      await this.enqueueInviteEmail(transaction, invite)
      return invite
    })
    return this.serializeInviteWithRecipientPrivacy(current)
  }

  private async withAccessibleInviteTransaction<T>(
    userId: number,
    inviteId: number,
    operation: (transaction: Prisma.TransactionClient, invite: InviteWithRelations) => Promise<T>,
  ): Promise<T> {
    const hint = await this.findAccessibleInvite(userId, inviteId)
    if (!hint.room_id) throw new ForbiddenException("Forbidden")
    return withActiveRoomTransaction(this.prisma, hint.room_id, async transaction => {
      const membership = await transaction.roomMembership.findFirst({ where: { room_id: hint.room_id!, user_id: userId, disabled: false } })
      if (!membership) throw new ForbiddenException("Forbidden")
      const current = await transaction.invite.findUnique({ where: { id: hint.id }, include: { room: true, invited_by: true } })
      if (!current || current.room_id !== hint.room_id) throw new ForbiddenException("Forbidden")
      return operation(transaction, current)
    })
  }

  private async findAccessibleInvite(userId: number, inviteId: number) {
    const memberRoomIds = await this.memberRoomIds(userId)
    const invite = await this.prisma.invite.findFirst({
      where: {
        id: this.toNumber(inviteId) ?? Number(0),
        room_id: { in: memberRoomIds.map((id) => this.toNumber(id) ?? Number(0)) },
      },
      include: { room: true, invited_by: true },
    })
    if (!invite) {
      throw new ForbiddenException("Forbidden")
    }
    return invite
  }

  private async memberRoomIds(userId: number, database: Prisma.TransactionClient = this.prisma) {
    const memberships = await database.roomMembership.findMany({
      where: { user_id: this.toNumber(userId) ?? Number(0), disabled: false, room: { deleted_at: null } },
      select: { room_id: true },
    })
    return memberships.map((membership) => this.toNumber(membership.room_id))
  }

  private async resolveInviteEmail(
    rawEmail: string | null | undefined,
    communityId: number,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<{ email: string; user: InviteRecipientUser }> {
    const email = this.normalizeEmail(rawEmail)
    if (!email) {
      throw new UnprocessableEntityException("email is required")
    }

    const existingUser = await database.user.findFirst({ where: { email } })
    if (existingUser) {
      const existingMembership = await database.roomMembership.findFirst({
        where: { room_id: communityId, user_id: existingUser.id, disabled: false },
      })
      if (existingMembership) {
        throw new UnprocessableEntityException("User is already a member of this community")
      }
    }

    return {
      email,
      user: existingUser ? { email: existingUser.email, username: existingUser.username || "Existing member" } : null,
    }
  }

  private async resolveInviteeMembership(
    userId: number,
    memberRoomIds: number[],
    targetRoomId: number,
    inviteeMembershipId: number,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<{ email: string; user: InviteRecipientUser }> {
    const membership: SuggestionMembership | null = await database.roomMembership.findFirst({
      where: { id: this.toNumber(inviteeMembershipId), disabled: false },
      include: { room: true, user: true },
    })
    const sourceRoomId = this.toNumber(membership?.room_id)
    const inviteeUserId = this.toNumber(membership?.user_id)
    const user = membership?.user

    if (
      !membership ||
      !user ||
      inviteeUserId === this.toNumber(userId) ||
      sourceRoomId === targetRoomId ||
      !memberRoomIds.includes(sourceRoomId)
    ) {
      throw new ForbiddenException("Forbidden")
    }

    const existingMembership = await database.roomMembership.findFirst({
      where: { room_id: targetRoomId, user_id: inviteeUserId, disabled: false },
    })
    if (existingMembership) {
      throw new UnprocessableEntityException("User is already a member of this community")
    }

    return { email: user.email, user: { email: user.email, username: user.username } }
  }

  private async findCommunityInvite(
    email: string,
    communityId: number,
    inviteType: InviteType,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<InviteWithRelations | null> {
    return database.invite.findFirst({
      where: {
        email,
        room_id: communityId,
        invite_type: INVITE_TYPE_MAP[inviteType],
      },
      include: { room: true, invited_by: true },
      orderBy: { created_at: "desc" },
    })
  }

  private async enqueueInviteEmail(transaction: Prisma.TransactionClient, invite: { id: number; token: string }) {
    await this.boss.enqueueInTransaction(transaction, INVITE_EMAIL_QUEUE, { inviteId: invite.id, tokenDigest: inviteTokenDigest(invite.token) })
  }

  private async refreshInvite(invite: InviteWithRelations, userId: number, database: Prisma.TransactionClient): Promise<InviteWithRelations> {
    return database.invite.update({
      where: { id: invite.id },
      data: {
        token: await this.generateToken(database),
        expires_at: this.nextInviteExpiration(),
        used_at: null,
        invited_by_id: userId,
        updated_at: new Date(),
      },
      include: { room: true, invited_by: true },
    })
  }

  private async serializeInviteWithRecipientPrivacy(invite: {
    id: number
    email: string
    invite_type: number
    token: string
    room: { id: number; name: string | null } | null
    invited_by: { id: number; username: string }
    expires_at: Date
    used_at: Date | null
    created_at: Date
  }): Promise<InvitePayload> {
    const recipientUser = await this.recipientUserByEmail(invite.email)
    return this.serializeInvite(invite, recipientUser)
  }

  private serializeInvite(invite: {
    id: number
    email: string
    invite_type: number
    token: string
    room: { id: number; name: string | null } | null
    invited_by: { id: number; username: string }
    expires_at: Date
    used_at: Date | null
    created_at: Date
  }, recipientUser: InviteRecipientUser = null): InvitePayload {
    const inviteType = INVITE_TYPE_REVERSE[invite.invite_type] ?? "room_invite"
    const hidesStoredEmail = Boolean(recipientUser)
    const recipientLabel = recipientUser ? recipientUser.username || "Existing member" : invite.email
    return {
      id: invite.id,
      email: hidesStoredEmail ? null : invite.email,
      recipient_label: recipientLabel,
      invite_type: inviteType,
      room: invite.room ? { id: invite.room.id, name: invite.room.name } : null,
      invited_by: { id: invite.invited_by.id, username: invite.invited_by.username },
      status: this.statusFor(invite),
      expires_at: invite.expires_at.toISOString(),
      used_at: invite.used_at ? invite.used_at.toISOString() : null,
      created_at: invite.created_at.toISOString(),
    }
  }

  private async recipientUserByEmail(email: string): Promise<InviteRecipientUser> {
    const user = await this.prisma.user.findFirst({
      where: { email: this.normalizeEmail(email) },
      select: { email: true, username: true },
    })
    return user ? { email: user.email, username: user.username } : null
  }

  private async recipientUsersByEmail(emails: string[]): Promise<Map<string, NonNullable<InviteRecipientUser>>> {
    const normalizedEmails = Array.from(new Set(emails.map((email) => this.normalizeEmail(email)).filter(Boolean)))
    if (normalizedEmails.length === 0) return new Map()

    const users = await this.prisma.user.findMany({
      where: { email: { in: normalizedEmails } },
      select: { email: true, username: true },
    })
    return new Map(users.map((user) => [this.normalizeEmail(user.email), { email: user.email, username: user.username }]))
  }

  private statusFor(invite: { expires_at: Date; used_at: Date | null }): InviteStatus {
    if (invite.used_at) return "used"
    if (invite.expires_at <= new Date()) return "expired"
    return "active"
  }

  private isActive(invite: { expires_at: Date; used_at: Date | null }) {
    return !invite.used_at && invite.expires_at > new Date()
  }

  private normalizeEmail(email: string | null | undefined): string {
    return (email ?? "").toLowerCase().trim()
  }

  private nextInviteExpiration(): Date {
    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + 3)
    return expiresAt
  }

  private async generateToken(database: Prisma.TransactionClient = this.prisma) {
    for (let attempts = 0; attempts < 5; attempts += 1) {
      const token = crypto.randomBytes(32).toString("base64url")
      const exists = await database.invite.findFirst({ where: { token } })
      if (!exists) return token
    }
    throw new Error("Unable to generate invite token")
  }

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? value : Number(value)
  }
}
