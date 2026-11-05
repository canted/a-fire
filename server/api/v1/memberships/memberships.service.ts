import type { Prisma } from "@prisma/client"
import { withActiveRoomTransaction, withRoomMembershipTransaction } from "../rooms/room-membership-transaction"
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { identityImageUrl } from "../uploads/identity-images"
import { UploadsService } from "../uploads/uploads.service"

export type MembershipPayload = {
  id: number
  room: { id: number; name: string | null }
  username_override: string | null
  profile_line_override: string | null
  disabled: boolean
  display_username: string
  display_profile_line: string | null
  display_avatar_url: string | null
  avatar_url: string | null
  notify: boolean
}

export type MembershipIndexResponse = {
  user: { id: number; username: string; profile_line: string | null; avatar_url: string | null }
  memberships: MembershipPayload[]
}

const toNumber = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined) return 0
  return typeof value === "number" ? value : Number(value)
}

@Injectable()
export class MembershipsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService
  @Inject(UploadsService)
  private readonly uploadsService!: UploadsService

  async list(userId: number): Promise<MembershipIndexResponse> {
    if (!userId) throw new NotFoundException("Not Found")

    const user = await this.prisma.user.findUnique({ where: { id: toNumber(userId) ?? 0 } })
    if (!user) throw new NotFoundException("Not Found")
    const userAvatarUrl = await identityImageUrl(this.prisma, "User", user.id)

    const memberships = await this.prisma.roomMembership.findMany({
      where: { user_id: toNumber(userId) ?? 0, room: { deleted_at: null } },
      include: { room: true, user: true },
      orderBy: { id: "asc" },
    })

    return {
      user: {
        id: toNumber(user.id),
        username: user.username,
        profile_line: user.profile_line ?? null,
        avatar_url: userAvatarUrl,
      },
      memberships: await Promise.all(memberships.map((membership) => this.serializeMembership(membership))),
    }
  }

  async update(
    userId: number,
    membershipId: number,
    payload: {
      username_override?: string | null
      profile_line_override?: string | null
      notify?: boolean
      avatarFile?: Express.Multer.File
      removeAvatar?: boolean
    },
  ): Promise<MembershipPayload> {
    const membership = await this.prisma.roomMembership.findFirst({
      where: { id: toNumber(membershipId) ?? 0, user_id: toNumber(userId) ?? 0, disabled: false, room: { deleted_at: null } },
      include: { room: true, user: true },
    })
    if (!membership) throw new NotFoundException("Not Found")

    const data: {
      username_override?: string | null
      profile_line_override?: string | null
      notify?: boolean
      updated_at: Date
    } = {
      updated_at: new Date(),
    }
    if (payload.username_override !== undefined) {
      data.username_override = payload.username_override
    }
    if (payload.profile_line_override !== undefined) {
      data.profile_line_override = payload.profile_line_override
    }
    if (payload.notify !== undefined) {
      data.notify = payload.notify
    }

    const updated = await withActiveRoomTransaction(this.prisma, membership.room_id, async transaction => {
      const current = await transaction.roomMembership.findFirst({
        where: { id: membership.id, user_id: userId, disabled: false },
        select: { id: true },
      })
      if (!current) throw new NotFoundException("Not Found")
      return transaction.roomMembership.update({
        where: { id: membership.id }, data, include: { room: true, user: true },
      })
    })

    if (payload.removeAvatar) {
      await this.uploadsService.removeAttachment(userId, {
        record_type: "CircleMembership",
        record_id: membership.id,
        name: "avatar",
      })
    }

    if (payload.avatarFile) {
      await this.uploadsService.createAttachmentUpload(userId, payload.avatarFile, {
        record_type: "CircleMembership",
        record_id: membership.id,
        name: "avatar",
      })
    }

    return this.serializeMembership(updated)
  }

  async disable(userId: number, membershipId: number): Promise<MembershipPayload> {
    return this.setDisabled(userId, membershipId, true)
  }

  async enable(userId: number, membershipId: number): Promise<MembershipPayload> {
    return this.setDisabled(userId, membershipId, false)
  }

  private async setDisabled(userId: number, membershipId: number, disabled: boolean): Promise<MembershipPayload> {
    const membership = await this.prisma.roomMembership.findFirst({
      where: { id: toNumber(membershipId) ?? 0, user_id: toNumber(userId) ?? 0 },
      include: { room: true, user: true },
    })
    if (!membership) throw new NotFoundException("Not Found")
    const operation = async (transaction: Prisma.TransactionClient) => {
      const current = await transaction.roomMembership.findFirst({
        where: { id: membership.id, user_id: userId },
        select: { revoked_at: true },
      })
      if (!current) throw new NotFoundException("Not Found")
      if (current.revoked_at) throw new ForbiddenException("Circle access was removed by its owner")
      return transaction.roomMembership.update({
        where: { id: membership.id, revoked_at: null },
        data: { disabled, updated_at: new Date() },
        include: { room: true, user: true },
      })
    }
    const updated = disabled
      ? await withActiveRoomTransaction(this.prisma, membership.room_id, operation)
      : await withRoomMembershipTransaction(this.prisma, membership.room_id, userId, operation)

    return this.serializeMembership(updated)
  }

  private async serializeMembership(membership: {
    id: number
    room_id: number
    room?: { id: number; name: string | null } | null
    username_override: string | null
    profile_line_override: string | null
    disabled: boolean
    notify: boolean | null
    user_id: number
    user?: { username: string; profile_line?: string | null } | null
  }): Promise<MembershipPayload> {
    const username = membership.user?.username ?? ""
    const displayUsername = membership.username_override || username || "user"
    const displayProfileLine = membership.profile_line_override ?? membership.user?.profile_line ?? null
    const membershipAvatarUrl = await identityImageUrl(this.prisma, "CircleMembership", membership.id)
    const userAvatarUrl = await identityImageUrl(this.prisma, "User", membership.user_id)

    return {
      id: toNumber(membership.id),
      room: {
        id: toNumber(membership.room_id),
        name: membership.room?.name ?? null,
      },
      username_override: membership.username_override,
      profile_line_override: membership.profile_line_override,
      disabled: Boolean(membership.disabled),
      display_username: displayUsername,
      display_profile_line: displayProfileLine,
      display_avatar_url: membershipAvatarUrl ?? userAvatarUrl,
      avatar_url: membershipAvatarUrl,
      notify: Boolean(membership.notify),
    }
  }
}
