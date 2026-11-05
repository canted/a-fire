import { Inject, Injectable } from "@nestjs/common"
import { PrismaService } from "../../../prisma/prisma.service"
import { identityImageUrls } from "../uploads/identity-images"

export type SlideMenuRoom = {
  id: string
  name: string | null
  owner_id: number | null
  canManage: boolean
  avatar_url: string | null
  porosity: "open" | "masked" | "closed"
}

export type SlideMenuPage = {
  id: string
  title: string | null
  icon: string | null
}

export type SlideMenuCurrentRoom = {
  id: string
  name: string | null
  owner_id: number | null
  canManage: boolean
  avatar_url: string | null
  porosity: "open" | "masked" | "closed"
  pages: SlideMenuPage[]
} | null

export type SlideMenuPayload = {
  rooms: SlideMenuRoom[]
  currentRoom: SlideMenuCurrentRoom
}

@Injectable()
export class NavigationService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  private toNumber(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0
    return typeof value === "number" ? value : Number(value)
  }

  async slideMenu(userId: number, currentRoomId?: number): Promise<SlideMenuPayload> {
    const memberships = await this.prisma.roomMembership.findMany({
      where: { user_id: userId, disabled: false },
      select: { room_id: true },
      orderBy: { room_id: "asc" },
    })

    const communityIds = memberships.map((membership) => this.toNumber(membership.room_id))
    if (communityIds.length === 0) {
      return { rooms: [], currentRoom: null }
    }

    const communities = await this.prisma.room.findMany({
      where: { id: { in: communityIds }, deleted_at: null },
      orderBy: { name: "asc" },
    })

    if (!communities.length) return { rooms: [], currentRoom: null }
    const avatarMap = await identityImageUrls(this.prisma, "Circle", communities.map(community => community.id))

    const communityPayload: SlideMenuRoom[] = communities.map((community) => {
      return {
        id: String(community.id),
        name: community.name,
        owner_id: community.owner_id,
        canManage: this.toNumber(community.owner_id) === this.toNumber(userId),
        avatar_url: avatarMap.get(community.id) ?? null,
        porosity: this.porosity(community.porosity),
      }
    })

    const preferredId = this.toNumber(currentRoomId) || communityIds[0]
    const currentRoom = communities.find((community) => community.id === preferredId) || communities[0]

    const pages = await this.prisma.page.findMany({
      where: { room_id: currentRoom.id, parent_id: null, deleted_at: null },
      orderBy: { title: "asc" },
    })

    const pagePayload: SlideMenuPage[] = pages.map((page) => ({
      id: String(page.id),
      title: page.title,
      icon: page.icon,
    }))

    return {
      rooms: communityPayload,
      currentRoom: {
        id: String(currentRoom.id),
        name: currentRoom.name,
        owner_id: currentRoom.owner_id,
        canManage: this.toNumber(currentRoom.owner_id) === this.toNumber(userId),
        avatar_url: avatarMap.get(currentRoom.id) ?? null,
        porosity: this.porosity(currentRoom.porosity),
        pages: pagePayload,
      },
    }
  }

  private porosity(value: string | null | undefined): "open" | "masked" | "closed" {
    return value === "masked" || value === "closed" ? value : "open"
  }
}
