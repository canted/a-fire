import "reflect-metadata"
import { createServer } from "node:http"
import { Server } from "socket.io"
import { io, type Socket } from "socket.io-client"
import { expect, it, vi } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RealtimeService } from "@server/realtime/realtime.service"
import { notifyRoomChanged } from "@server/realtime/room-change"
import { publishRoundWall } from "@server/api/v1/rounds/publish-round-wall"

it("refreshes two API socket servers after commit, repairs a missed hint and rechecks revoked access", async () => {
  const prisma = new PrismaService(), now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@room-change.test`, username: "Member", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Private Room", porosity: "closed", owner_id: user.id, created_at: now, updated_at: now } })
  const membership = await prisma.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
  const round = await prisma.round.create({ data: { name: "Completed Round", room_id: room.id, host_id: user.id, status: "archived", closed_at: now, created_at: now, updated_at: now } })
  const access = new RoomAccessService(); Object.assign(access, { prisma })
  const hosts: Array<{ io: Server; realtime: RealtimeService; client: Socket; received: unknown[] }> = []
  try {
    for (let index = 0; index < 2; index++) {
      const http = createServer(), server = new Server(http), realtime = new RealtimeService()
      realtime.setServer(server, async () => Boolean(await access.resolve(room.id, user.id)))
      server.on("connection", socket => socket.on("join", async (ack: () => void) => { await socket.join(`chat:${room.id}`); ack() }))
      await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve))
      await realtime.onApplicationBootstrap()
      const address = http.address() as { port: number }
      const client = io(`http://127.0.0.1:${address.port}`, { transports: ["websocket"], forceNew: true })
      const received: unknown[] = []
      client.on("ChatChannel", message => received.push(message))
      hosts.push({ io: server, realtime, client, received })
      await new Promise<void>((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject) })
      await new Promise<void>(resolve => client.emit("join", resolve))
    }
    await expect(prisma.$transaction(async tx => { await publishRoundWall(tx, round.id); throw new Error("Rollback") })).rejects.toThrow("Rollback")
    expect(await prisma.roundResult.count({ where: { round_id: round.id } })).toBe(0)
    await prisma.$transaction(tx => publishRoundWall(tx, round.id))
    await vi.waitFor(() => expect(hosts.map(host => host.received)).toEqual([
      [{ type: "invalidate", room_id: room.id }], [{ type: "invalidate", room_id: room.id }],
    ]))
    await hosts[0].realtime.onModuleDestroy()
    await prisma.$transaction(tx => notifyRoomChanged(tx, room.id))
    await vi.waitFor(() => expect(hosts[1].received).toHaveLength(2))
    expect(hosts[0].received).toHaveLength(1)
    await hosts[0].realtime.onApplicationBootstrap()
    await vi.waitFor(() => expect(hosts[0].received).toHaveLength(2))
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
    await prisma.$transaction(tx => notifyRoomChanged(tx, room.id))
    await vi.waitFor(() => {
      for (const host of hosts) expect(host.io.sockets.sockets.get(host.client.id!)?.rooms.has(`chat:${room.id}`)).toBe(false)
    })
    expect(hosts.map(host => host.received.length)).toEqual([2, 2])
  } finally {
    for (const host of hosts) {
      host.client.disconnect()
      await host.realtime.onModuleDestroy()
      await new Promise<void>(resolve => host.io.close(() => resolve()))
    }
    await prisma.chatMessage.deleteMany({ where: { room_id: room.id } })
    await prisma.roundResult.deleteMany({ where: { round_id: round.id } })
    await prisma.round.delete({ where: { id: round.id } })
    await prisma.roomMembership.delete({ where: { id: membership.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}, 15000)
