import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import "reflect-metadata"
import { Module } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { PrismaClient } from "@prisma/client"
import { expect, it } from "vitest"
import { RoomHomeController } from "@server/api/v1/rooms/room-home.controller"
import { BoardsDetailService } from "@server/api/v1/boards/boards.detail.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { NotificationActivityService } from "@server/notifications/notification-activity.service"

it("serves a Room without a Board through authenticated HTTP and rechecks membership", async () => {
  const prisma = new PrismaClient(), now = new Date(), rollback = new Error("Rollback Room home")
  try {
    await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { username: "Room member", email: `${crypto.randomUUID()}@room-home.test`, created_at: now, updated_at: now } })
      const room = await tx.room.create({ data: { owner_id: user.id, name: "No Board", created_at: now, updated_at: now } })
      const membership = await tx.roomMembership.create({ data: { room_id: room.id, user_id: user.id, created_at: now, updated_at: now } })
      const access = new RoomAccessService(), lifecycle = new RoundLifecycleService(), detail = new BoardsDetailService()
      Object.assign(access, { prisma: tx })
      Object.assign(lifecycle, { prisma: tx })
      Object.assign(detail, { prisma: tx, circleAccess: access, activityLifecycle: lifecycle })
      const communities = new RoomsService()
      Object.assign(communities, { prisma: { $transaction: (operation: (database: typeof tx) => unknown) => operation(tx) } })
      class TestModule {}
      Module({ controllers: [RoomHomeController], providers: [
        { provide: BoardsDetailService, useValue: detail },
        { provide: RoomsService, useValue: communities },
        { provide: AuthService, useValue: { verifyAccessToken: () => ({ userId: user.id }) } },
        { provide: NotificationActivityService, useValue: { recordActivity: async () => {} } },
      ] })(TestModule)
      const app = await NestFactory.create(TestModule, { logger: false, abortOnError: false })
      try {
        await app.listen(0, "127.0.0.1")
        const base = await app.getUrl(), path = `/api/v1/rooms/${room.id}/home`
        const get = (route = path) => fetch(`${base}${route}`, { headers: { Authorization: "Bearer test" } })
        expect((await fetch(`${base}${path}`)).status).toBe(401)
        expect((await get("/api/v1/rooms/not-a-number/home")).status).toBe(400)
        const response = await get()
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ roomId: String(room.id), members: [{ membershipId: String(membership.id), userId: String(user.id), username: user.username, avatarUrl: null, latestEntry: null, recentEntries: [] }], viewer_access: { kind: "member", can_write: true, can_reply: true, entry_history: "all" } })
        const settingsPath = `${base}/api/v1/rooms/${room.id}/feedback-settings`
        const patch = () => fetch(settingsPath, { method: "PATCH", headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: JSON.stringify({ replyMode: "guided", defaultFeedbackTypes: ["question"] }) })
        expect((await fetch(settingsPath, { method: "PATCH" })).status).toBe(401)
        const settingsResponse = await patch()
        expect(settingsResponse.status).toBe(200)
        expect(await settingsResponse.json()).toMatchObject({ replyMode: "guided", defaultFeedbackTypes: ["question"], canEditReplyMode: true })
        expect((await tx.room.findUniqueOrThrow({ where: { id: room.id } })).reply_mode).toBe("guided")
        await tx.room.update({ where: { id: room.id }, data: { owner_id: null } })
        expect((await patch()).status).toBe(403)
        expect(await tx.$queryRaw`SELECT to_regclass('public.boards')::text AS board, to_regclass('public.squares')::text AS square`).toEqual([{ board: null, square: null }])
        await tx.roomMembership.update({ where: { id: membership.id }, data: { disabled: true } })
        expect((await get()).status).toBe(403)
      } finally { await app.close() }
      throw rollback
    }, { timeout: 15000 })
  } catch (error) { if (error !== rollback) throw error }
  finally { await prisma.$disconnect() }
})
