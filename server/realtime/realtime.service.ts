import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common"
import { CommittedIdChangeListener } from "./committed-id-change-listener"
import type { Server, Socket } from "socket.io"

export type ChannelName = "EntryChannel" | "NoteChannel" | "NotificationChannel" | "ChatChannel"
export type DeliveryDecision = boolean | "refresh"
type DeliveryAuthorization = (client: Socket, channel: ChannelName, room: string) => Promise<DeliveryDecision>

@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private server: Server | null = null
  private activeUsers = new Map<number, number>()
  private readonly logger = new Logger(RealtimeService.name)
  private authorizeDelivery: DeliveryAuthorization | null = null
  private roomListener: CommittedIdChangeListener | null = null
  private pendingRooms = new Set<number>()
  private roomTimer: ReturnType<typeof setTimeout> | null = null
  private roomFlush: Promise<void> | null = null

  async onApplicationBootstrap() {
    if (this.roomListener || !this.server || !process.env.DATABASE_URL) return
    this.roomListener = new CommittedIdChangeListener("afire_room_changes", "afire-room-changes", process.env.DATABASE_URL,
      id => this.queueRoomRefresh(id),
      () => {
        for (const room of this.server?.sockets.adapter.rooms.keys() ?? []) {
          const match = /^chat:([1-9]\d*)$/.exec(room)
          if (match) this.queueRoomRefresh(Number(match[1]))
        }
      }, () => this.logger.warn("Room change listener disconnected; reconnecting"))
    await this.roomListener.start()
  }

  async onModuleDestroy() {
    const listener = this.roomListener
    this.roomListener = null
    if (this.roomTimer) clearTimeout(this.roomTimer)
    this.roomTimer = null
    this.pendingRooms.clear()
    await listener?.stop()
    await this.roomFlush
  }

  private queueRoomRefresh(id: number) {
    if (!this.roomListener || !Number.isSafeInteger(id) || id <= 0 || !this.server?.sockets.adapter.rooms.has(this.chatRoom(id))) return
    this.pendingRooms.add(id)
    this.scheduleRoomRefresh()
  }

  private scheduleRoomRefresh() {
    if (!this.roomListener || this.roomTimer || this.roomFlush || !this.pendingRooms.size) return
    this.roomTimer = setTimeout(() => {
      this.roomTimer = null
      const batch = [...this.pendingRooms].slice(0, 64)
      batch.forEach(id => this.pendingRooms.delete(id))
      this.roomFlush = Promise.all(batch.map(id => this.emit("ChatChannel", this.chatRoom(id), { type: "invalidate", room_id: id })))
        .then(() => {}).finally(() => { this.roomFlush = null; this.scheduleRoomRefresh() })
    }, 0)
  }

  setServer(server: Server, authorizeDelivery: DeliveryAuthorization) {
    this.server = server
    this.authorizeDelivery = authorizeDelivery
  }

  async emit(channel: ChannelName, room: string, payload: Record<string, unknown>) {
    const server = this.server
    const authorize = this.authorizeDelivery
    if (!server || !authorize) return
    const normalized = this.normalizeNumber(payload)
    // Room membership is only a routing hint. Recheck access for each delivery,
    // including sockets that joined before a lease expired or access changed.
    const socketIds = [...(server.sockets.adapter.rooms.get(room) ?? [])]
    await Promise.all(socketIds.map(async (socketId) => {
      const client = server.sockets.sockets.get(socketId)
      if (!client) return
      try {
        const decision = await authorize(client, channel, room)
        if (!decision) {
          await client.leave(room)
          return
        }
        if (client.connected && client.rooms.has(room)) {
          const idKey = channel === "EntryChannel" ? "entry_id" : "room_id"
          client.emit(channel, decision === "refresh"
            ? { type: "invalidate", [idKey]: Number(room.split(":")[1]) }
            : normalized)
        }
      } catch {
        // Existing publishers may deliberately not await delivery. Fail closed
        // without turning an authorization/storage outage into an unhandled rejection.
        this.logger.warn(`Realtime delivery authorization failed for ${channel}`)
      }
    }))
  }

  disconnectAll(): void { this.server?.disconnectSockets(true) }

  markUserActive(userId: number) {
    const count = this.activeUsers.get(userId) ?? 0
    const nextCount = count + 1
    this.activeUsers.set(userId, nextCount)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "realtime_active", user_id: userId, count: nextCount }))
  }

  markUserInactive(userId: number) {
    const count = this.activeUsers.get(userId) ?? 0
    if (count <= 1) {
      this.activeUsers.delete(userId)
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ event: "realtime_inactive", user_id: userId, count: 0 }))
      return
    }
    const nextCount = count - 1
    this.activeUsers.set(userId, nextCount)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "realtime_inactive", user_id: userId, count: nextCount }))
  }

  isUserActive(userId: number): boolean {
    return (this.activeUsers.get(userId) ?? 0) > 0
  }

  entryRoom(postId: number) {
    return `entry:${postId}`
  }



  noteRoom(pageId: number) {
    return `note:${pageId}`
  }

  notificationRoom(userId: number) {
    return `notification:${userId}`
  }

  chatRoom(communityId: number) {
    return `chat:${communityId}`
  }

  private normalizeNumber(value: unknown): unknown {
    if (typeof value === "number") return Number(value)
    if (Array.isArray(value)) return value.map((item) => this.normalizeNumber(item))
    if (!value || typeof value !== "object") return value
    if (value instanceof Date) return value

    const entries = Object.entries(value as Record<string, unknown>)
    return entries.reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = this.normalizeNumber(val)
      return acc
    }, {})
  }
}
