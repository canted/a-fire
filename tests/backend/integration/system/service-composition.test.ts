import "reflect-metadata"
import { ForbiddenException, Module, type Provider } from "@nestjs/common"
import { MODULE_METADATA } from "@nestjs/common/constants"
import { NestFactory } from "@nestjs/core"
import { BoardsDetailService } from "@server/api/v1/boards/boards.detail.service"
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { RoomsModule } from "@server/api/v1/rooms/rooms.module"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { LinkPreviewsService } from "@server/api/v1/link-previews/link-previews.service"
import { EntriesModule } from "@server/api/v1/entries/entries.module"
import { EntriesService } from "@server/api/v1/entries/entries.service"
import { ProjectsService } from "@server/api/v1/projects/projects.service"
import { RoundsModule } from "@server/api/v1/rounds/rounds.module"
import { RoundsService } from "@server/api/v1/rounds/rounds.service"
import { RoundRuntimeModule } from "@server/api/v1/rounds/runtime/round-templates.module"
import { UploadsService } from "@server/api/v1/uploads/uploads.service"
import { PrismaService } from "@server/prisma/prisma.service"
import { BossService } from "@server/queue/boss.service"
import { RealtimeService } from "@server/realtime/realtime.service"

async function composeServices() {
  const prisma = {
    $transaction: vi.fn(), $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([]),
    roomMembership: { findMany: vi.fn().mockResolvedValue([]) },
    entry: { findMany: vi.fn().mockResolvedValue([]) },
    room: { findFirst: vi.fn().mockResolvedValue({ id: 3 }) },
    roomJoinRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 4 }),
    },
    notificationEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 5 }),
    },
    notificationPushDelivery: { findMany: vi.fn().mockResolvedValue([]) },
    round: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    chatMessage: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({ id: 10, room_id: 3 }) },
    activityParticipation: { findMany: vi.fn() },
  }
  prisma.$transaction.mockImplementation(callback => callback(prisma))
  const boss = { enqueue: vi.fn(), enqueueAfter: vi.fn(), enqueueInTransaction: vi.fn() }
  const circleAccess = { require: vi.fn(), requireMember: vi.fn() }

  // Use the production registrations so a missing provider breaks composition.
  const providers: Provider[] = [EntriesModule, RoomsModule, RoundsModule, RoundRuntimeModule].flatMap(
    module => Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) ?? [],
  )
  class CompositionModule {}
  Module({ providers: [
    ...providers,
    { provide: PrismaService, useValue: prisma },
    { provide: BossService, useValue: boss },
    { provide: RoomAccessService, useValue: circleAccess },
    { provide: RealtimeService, useValue: { emit: vi.fn(), chatRoom: (id: number) => `chat:${id}` } },
    { provide: BoardsDetailService, useValue: {} },
    { provide: LinkPreviewsService, useValue: {} },
    { provide: ProjectsService, useValue: {} },
    { provide: UploadsService, useValue: {} },
  ] })(CompositionModule)
  const app = await NestFactory.createApplicationContext(CompositionModule, { logger: false, abortOnError: false })
  return { app, prisma, boss, circleAccess }
}

describe("service composition through production Nest providers", () => {
  it("keeps post list authorization ahead of its extracted read service's query", async () => {
    const { app, prisma, circleAccess } = await composeServices()
    try {
      const posts = app.get(EntriesService)
      await expect(posts.listPosts(3, 2)).resolves.toEqual([])
      expect(circleAccess.requireMember).toHaveBeenCalledWith(3, 2)
      expect(prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { status: "published", room_id: { in: [3] } },
        take: 200,
      }))

      circleAccess.requireMember.mockRejectedValue(new ForbiddenException("Members only"))
      prisma.entry.findMany.mockClear()
      await expect(posts.listPosts(3, 2)).rejects.toBeInstanceOf(ForbiddenException)
      expect(prisma.entry.findMany).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it("routes circle admission and delivery reporting through the facade with access checks intact", async () => {
    const { app, prisma, boss, circleAccess } = await composeServices()
    try {
      const communities = app.get(RoomsService)
      circleAccess.require.mockResolvedValue({ kind: "visitor", room: { id: 3, owner_id: 9, porosity: "masked" } })
      await expect(communities.joinRoom(3, 2)).resolves.toEqual({ state: "requested" })
      expect(prisma.roomJoinRequest.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ room_id: 3, user_id: 2, status: "pending" }),
      }))
      expect(boss.enqueue).toHaveBeenCalledWith("notifications.fanout", { eventId: 5 })

      await expect(communities.listNotificationDeliveries(3, 9)).resolves.toEqual({ items: [] })
      expect(prisma.notificationPushDelivery.findMany).toHaveBeenCalledOnce()
      prisma.room.findFirst.mockResolvedValue(null)
      prisma.notificationPushDelivery.findMany.mockClear()
      await expect(communities.listNotificationDeliveries(3, 2)).rejects.toBeInstanceOf(ForbiddenException)
      expect(prisma.notificationPushDelivery.findMany).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it("delivers scheduled activity notifications through the facade and ignores stale jobs", async () => {
    const { app, prisma, boss } = await composeServices()
    try {
      const startedAt = new Date(Date.now() - 30_000)
      prisma.round.findUnique.mockResolvedValue({
        id: 6, room_id: 3, host_id: 9, name: "September", status: "active", started_at: startedAt,
        created_at: startedAt, _count: { participations: 1, submission_records: 0 },
      })
      prisma.activityParticipation.findMany.mockResolvedValue([{ user_id: 2, role: "participant", submitted_entry_id: null }])
      const activities = app.get(RoundsService)
      await activities.handleScheduledNotification({ roundId: 6, milestone: "submission_started", expectedAt: startedAt.toISOString() })
      expect(prisma.notificationEvent.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ event_type: "round_phase_changed", room_id: 3, target_user_id: 2, target_path: "/app/rounds/6" }),
      }))
      expect(prisma.notificationEvent.create.mock.calls[0][0].data).not.toHaveProperty("board_id")
      expect(prisma.notificationEvent.create.mock.calls[0][0].data).not.toHaveProperty("square_id")
      expect(boss.enqueueInTransaction).toHaveBeenCalledWith(prisma, "notifications.fanout", { eventId: 5 })

      expect(prisma.chatMessage.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ timeline_kind: "round_event", room_id: 3,
          content: { round_event: expect.objectContaining({ event_label: "Round started" }) },
        }),
      }))

      prisma.notificationEvent.create.mockClear()
      await activities.handleScheduledNotification({ roundId: 6, milestone: "submission_started", expectedAt: new Date(0).toISOString() })
      expect(prisma.notificationEvent.create).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
