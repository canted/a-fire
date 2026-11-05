import { Inject, Injectable, NotFoundException } from "@nestjs/common"
import { RoomAccessService } from "../rooms/room-access.service"
import { PrismaService } from "../../../prisma/prisma.service"
import { limitedChatAuthorIds } from "../../v2/rooms/chat-visibility"
import { canReadRoundStatus } from "../rounds/round-visibility"
import { hasLimitedRoomHistory } from "../rooms/room-door-policy"
import { recentRoomMemberEntryIds } from "../entries/room-entry-history"
import { identityImageUrls } from "../uploads/identity-images"

type MentionTargetType = "user" | "room" | "note" | "round"

type MentionableRoom = {
  id: number
  name: string | null
  parent_id: number | null
}

export type MentionTargetPayload = {
  id: string
  target_type: MentionTargetType
  target_id: string
  label: string
  subtitle: string | null
  avatar_url: string | null
  icon: string | null
  href: string | null
}

export type MentionTargetsPayload = {
  room_id: number
  targets: MentionTargetPayload[]
}

const toNumber = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined) return 0
  return typeof value === "number" ? value : Number(value)
}

@Injectable()
export class MentionsService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  async listTargets(communityId: number, userId: number): Promise<MentionTargetsPayload> {
    if (!userId) throw new NotFoundException("Not Found")

    const access = await this.circleAccess.require(communityId, userId)
    const limited = hasLimitedRoomHistory(access)

    const [memberships, pages, activities, circles] = await Promise.all([
      this.prisma.roomMembership.findMany({
        where: { room_id: communityId, disabled: false },
        include: { user: true },
        orderBy: { id: "asc" },
      }),
      access.canViewNotes ? this.prisma.page.findMany({
        where: { room_id: communityId, deleted_at: null },
        select: { id: true, title: true, icon: true },
        orderBy: [{ title: "asc" }, { id: "asc" }],
      }) : Promise.resolve([]),
      this.prisma.round.findMany({
        where: { room_id: communityId, ...(access.kind === "visitor" ? { status: { in: ["active", "archived"].filter(status => canReadRoundStatus(status, access.kind, limited)) } } : {}) },
        select: { id: true, name: true },
        orderBy: [{ updated_at: "desc" }, { id: "desc" }],
      }),
      this.prisma.room.findMany({
        where: {
          deleted_at: null,
          OR: [{ id: communityId }, { memberships: { some: { user_id: userId, disabled: false, room: { deleted_at: null } } } }],
        },
        select: { id: true, name: true, parent_id: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    ])

    // Limited visits reveal authors through visible work, never a member directory.
    let visibleMemberships = memberships
    if (limited) {
      const currentIds = await recentRoomMemberEntryIds(this.prisma, memberships.map(member => ({ roomId: communityId, userId: member.user_id })), 1)
      const posts = currentIds.length ? await this.prisma.entry.findMany({
        where: { id: { in: currentIds }, status: "published" }, select: { user_id: true },
      }) : []
      const [chatAuthors, feedback] = await Promise.all([
        limitedChatAuthorIds(this.prisma, communityId),
        currentIds.length ? this.prisma.reply.findMany({
          where: { entry_id: { in: currentIds }, status: "published" },
          select: { user_id: true }, distinct: ["user_id"],
        }) : Promise.resolve([]),
      ])
      const authors = new Set([...posts.map(post => post.user_id), ...chatAuthors, ...feedback.map(reply => reply.user_id)])
      visibleMemberships = memberships.filter(member => authors.has(member.user_id))
    }
    const userIds = visibleMemberships.map((item) => toNumber(item.user_id)).filter(Boolean)
    const avatarByUserId = await identityImageUrls(this.prisma, "User", userIds)

    const userTargets = visibleMemberships
      .map((item): MentionTargetPayload => {
        const targetId = String(item.user_id)
        const label = item.username_override || item.user?.username || "user"

        return {
          id: `user:${targetId}`,
          target_type: "user",
          target_id: targetId,
          label,
          subtitle: "User",
          avatar_url: avatarByUserId.get(Number(targetId)) ?? null,
          icon: null,
          href: `/app/rooms/${communityId}/members/${targetId}`,
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))

    const pageTargets = pages.map((page): MentionTargetPayload => {
      const targetId = String(page.id)
      return {
        id: `page:${targetId}`,
        target_type: "note",
        target_id: targetId,
        label: page.title?.trim() || "Untitled page",
        subtitle: "Note",
        avatar_url: null,
        icon: page.icon,
        href: `/app/note/${targetId}`,
      }
    })

    const activityTargets = activities.map((activity): MentionTargetPayload => ({
      id: `activity:${activity.id}`,
      target_type: "round",
      target_id: String(activity.id),
      label: activity.name.trim() || "Untitled Round",
      subtitle: "Round",
      avatar_url: null,
      icon: null,
      href: `/app/rounds/${activity.id}`,
    }))

    const circleTargets = sameTreeRooms(circles, communityId).map((circle): MentionTargetPayload => ({
      id: `circle:${circle.id}`,
      target_type: "room",
      target_id: String(circle.id),
      label: circle.name?.trim() || "Untitled circle",
      subtitle: "Circle",
      avatar_url: null,
      icon: null,
      href: `/app/rooms/${circle.id}`,
    }))

    return {
      room_id: communityId,
      targets: [...userTargets, ...pageTargets, ...activityTargets, ...circleTargets],
    }
  }
}

function sameTreeRooms(circles: MentionableRoom[], currentCircleId: number): MentionableRoom[] {
  const circlesById = new Map(circles.map((circle) => [circle.id, circle]))

  const rootId = (circleId: number): number => {
    let currentId = circleId
    const visited = new Set<number>()

    while (!visited.has(currentId)) {
      visited.add(currentId)
      const parentId = circlesById.get(currentId)?.parent_id
      if (!parentId || !circlesById.has(parentId)) break
      currentId = parentId
    }

    return currentId
  }

  const currentRootId = rootId(currentCircleId)
  return circles.filter((circle) => rootId(circle.id) === currentRootId)
}
