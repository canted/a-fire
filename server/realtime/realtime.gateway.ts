import { roomEntryRoomId } from "../api/v1/entries/room-entry-scope"
import { Inject } from "@nestjs/common"
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets"
import type { Server, Socket } from "socket.io"
import { AuthService } from "../api/v1/auth/auth.service"
import { NotificationActivityService } from "../notifications/notification-activity.service"
import { PrismaService } from "../prisma/prisma.service"
import { RealtimeService, type ChannelName, type DeliveryDecision } from "./realtime.service"
import { RoomAccessService } from "../api/v1/rooms/room-access.service"
import { isProjectEntry } from "../api/v1/projects/project-access"

type SubscribePayload = {
  channel: "EntryChannel" | "NoteChannel" | "NotificationChannel" | "ChatChannel"
  id?: number | string
}

const CHAT_PRESENCE_TTL_MS = 90_000

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server

  @Inject(AuthService)
  private readonly authService!: AuthService

  @Inject(PrismaService)
  private readonly prisma!: PrismaService

  @Inject(RealtimeService)
  private readonly realtime!: RealtimeService

  @Inject(NotificationActivityService)
  private readonly notificationActivity!: NotificationActivityService

  @Inject(RoomAccessService)
  private readonly circleAccess!: RoomAccessService

  afterInit() {
    this.realtime.setServer(this.server, (client, channel, room) => this.canReceive(client, channel, room))
  }

  private async canReceive(client: Socket, channel: ChannelName, room: string): Promise<DeliveryDecision> {
    const userId = this.userId(client)
    if (!userId) return false
    if (channel === "NotificationChannel") return room === this.realtime.notificationRoom(userId)
    const [prefix, rawId, extra] = room.split(":")
    const id = Number(rawId)
    if (extra !== undefined || !Number.isSafeInteger(id) || id <= 0) return false
    if (channel === "EntryChannel" && prefix === "entry") return this.canReadPost(id, userId, true)
    if (channel === "NoteChannel" && prefix === "note") return this.canReadPage(id, userId)
    // Parent changes and visit expiry apply while a socket remains connected.
    if (channel === "ChatChannel" && prefix === "chat") {
      const access = await this.circleAccess.resolve(id, userId)
      return access?.kind === "visitor" ? "refresh" : Boolean(access)
    }
    return false
  }

  async handleConnection(client: Socket) {
    const userId = await this.authenticate(client)
    if (!userId) {
      client.disconnect()
      return
    }
    client.data.userId = userId
    this.realtime.markUserActive(userId)
    await this.notificationActivity.recordActivity(userId)
  }

  async handleDisconnect(client: Socket) {
    const userId = this.userId(client)
    if (!userId) return
    await this.leaveChatRooms(client, userId)
    this.realtime.markUserInactive(userId)
    await this.notificationActivity.recordActivity(userId, new Date(), { cancelScheduledPushes: false })
  }

  @SubscribeMessage("subscribe")
  async subscribe(client: Socket, payload: SubscribePayload) {
    if (!payload?.channel) return
    const userId = this.userId(client)
    if (!userId) return

    if (payload.channel === "NotificationChannel") {
      client.join(this.realtime.notificationRoom(userId))
      return
    }

    const id = this.numberId(payload.id)
    if (!id) return

    if (payload.channel === "EntryChannel") {
      const allowed = await this.canReadPost(id, userId)
      if (!allowed) return
      client.join(this.realtime.entryRoom(id))
      return
    }


    if (payload.channel === "ChatChannel") {
      const allowed = await this.canReadCommunity(id, userId)
      if (!allowed) return
      await client.join(this.realtime.chatRoom(id))
      await this.enterChatRoom(client, id, userId)
      return { subscribed: true }
    }

    if (payload.channel === "NoteChannel") {
      const allowed = await this.canReadPage(id, userId)
      if (!allowed) return
      client.join(this.realtime.noteRoom(id))
    }
  }

  @SubscribeMessage("unsubscribe")
  async unsubscribe(client: Socket, payload: SubscribePayload) {
    if (!payload?.channel) return
    const userId = this.userId(client)
    if (!userId) return

    if (payload.channel === "NotificationChannel") {
      client.leave(this.realtime.notificationRoom(userId))
      return
    }

    const id = this.numberId(payload.id)
    if (!id) return

    if (payload.channel === "EntryChannel") {
      client.leave(this.realtime.entryRoom(id))
    } else if (payload.channel === "NoteChannel") {
      client.leave(this.realtime.noteRoom(id))
    } else if (payload.channel === "ChatChannel") {
      client.leave(this.realtime.chatRoom(id))
      await this.leaveChatRoom(client, id, userId)
    }
  }

  @SubscribeMessage("chat_presence")
  async refreshChatPresence(client: Socket, payload: { id?: number | string }) {
    const userId = this.userId(client)
    const communityId = this.numberId(payload?.id)
    if (!userId || !communityId || !this.chatCircleIds(client).includes(communityId)) return
    if (!(await this.canReadCommunity(communityId, userId))) {
      await client.leave(this.realtime.chatRoom(communityId))
      await this.leaveChatRoom(client, communityId, userId)
      return
    }

    await this.prisma.chatPresenceSession.updateMany({
      where: { room_id: communityId, connection_id: client.id, user_id: userId, left_at: null },
      data: { last_seen_at: new Date() },
    })
  }

  private async authenticate(client: Socket): Promise<number | null> {
    const authToken = typeof client.handshake.auth?.token === "string" ? client.handshake.auth.token : null
    if (authToken) {
      try {
        const { userId } = this.authService.verifyAccessToken(authToken)
        return userId
      } catch {
        return null
      }
    }

    const headerAuth = client.handshake.headers.authorization
    if (typeof headerAuth === "string" && headerAuth.startsWith("Bearer ")) {
      const token = headerAuth.slice("Bearer ".length)
      try {
        const { userId } = this.authService.verifyAccessToken(token)
        return userId
      } catch {
        return null
      }
    }

    return null
  }

  private userId(client: Socket): number | null {
    const value = client.data.userId
    return typeof value === "number" ? value : null
  }

  private chatCircleIds(client: Socket): number[] {
    const value = client.data.chatCircleIds
    return Array.isArray(value) ? value.filter((id): id is number => typeof id === "number") : []
  }

  private async enterChatRoom(client: Socket, communityId: number, userId: number) {
    const now = new Date()
    await this.prisma.chatPresenceSession.upsert({
      where: { room_id_connection_id: { room_id: communityId, connection_id: client.id } },
      create: {
        room_id: communityId,
        user_id: userId,
        connection_id: client.id,
        entered_at: now,
        last_seen_at: now,
        left_at: null,
      },
      update: {
        user_id: userId,
        entered_at: now,
        last_seen_at: now,
        left_at: null,
      },
    })
    client.data.chatCircleIds = Array.from(new Set([...this.chatCircleIds(client), communityId]))
    await this.emitChatPresence(communityId)
  }

  private async leaveChatRoom(client: Socket, communityId: number, userId: number) {
    const now = new Date()
    await this.prisma.chatPresenceSession.updateMany({
      where: { room_id: communityId, connection_id: client.id, user_id: userId, left_at: null },
      data: { left_at: now, last_seen_at: now },
    })
    client.data.chatCircleIds = this.chatCircleIds(client).filter((id) => id !== communityId)
    await this.emitChatPresence(communityId, now)
  }

  private async leaveChatRooms(client: Socket, userId: number) {
    const communityIds = this.chatCircleIds(client)
    if (communityIds.length === 0) return
    const now = new Date()
    await this.prisma.chatPresenceSession.updateMany({
      where: { room_id: { in: communityIds }, connection_id: client.id, user_id: userId, left_at: null },
      data: { left_at: now, last_seen_at: now },
    })
    client.data.chatCircleIds = []
    await Promise.all(communityIds.map((communityId) => this.emitChatPresence(communityId, now)))
  }

  private async emitChatPresence(communityId: number, now = new Date()) {
    const activeSince = new Date(now.getTime() - CHAT_PRESENCE_TTL_MS)
    const sessions = await this.prisma.chatPresenceSession.findMany({
      where: { room_id: communityId, left_at: null, last_seen_at: { gte: activeSince } },
      select: { user_id: true },
    })
    this.realtime.emit("ChatChannel", this.realtime.chatRoom(communityId), {
      type: "presence",
      room_id: communityId,
      present_user_ids: Array.from(new Set(sessions.map((session) => session.user_id))),
    })
  }

  private numberId(value: unknown): number | null {
    const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : null
    if (!parsed || Number.isNaN(parsed)) return null
    return parsed
  }

  private async canReadPost(postId: number, userId: number, delivery = false): Promise<DeliveryDecision> {
    const post = await this.prisma.entry.findUnique({ where: { id: postId } })
    // Private entries have no circle discussion channel. Project queries recheck membership on every read.
    if (!post || post.status === "deleted" || isProjectEntry(post)) return false
    const communityId = roomEntryRoomId(post)
    if (!communityId) return post.user_id === userId

    const access = await this.circleAccess.resolve(communityId, userId)
    if (!access) return false
    if (access.kind === "member" && post.creation_origin !== "chat_attachment") return true
    const visible = await this.circleAccess.canReadPublishedPostWithRoomHistory(post, access)
    return visible && delivery && access.kind === "visitor" ? "refresh" : visible
  }

  private async canReadPage(pageId: number, userId: number): Promise<boolean> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } })
    if (!page || page.deleted_at) return false
    if (!page.room_id) return true

    const access = await this.circleAccess.resolve(page.room_id, userId)
    return access?.kind === "member"
  }

  private async canReadCommunity(communityId: number, userId: number): Promise<boolean> {
    return Boolean(await this.circleAccess.resolve(communityId, userId))
  }
}
