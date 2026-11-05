// @vitest-environment node
import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { io } from "socket.io-client";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { PrismaService } from "@server/prisma/prisma.service";
import { AuthService } from "@server/api/v1/auth/auth.service";
import { BoardsDetailService } from "@server/api/v1/boards/boards.detail.service";
import { UploadsService } from "@server/api/v1/uploads/uploads.service";
import { RoomAccessService } from "@server/api/v1/rooms/room-access.service";
import { RealtimeGateway } from "@server/realtime/realtime.gateway";
import { RoomBannersService } from "@server/api/v1/rooms/room-banners.service";
import { RealtimeService } from "@server/realtime/realtime.service";
import { NotificationActivityService } from "@server/notifications/notification-activity.service";
import { MailerService } from "@server/mailer/mailer.service";
import { loadTestEnvironment } from "@server/runtime/test-environment.mjs";
import { loadEnv } from "@server/runtime/loadEnv";
import { RoundLifecycleService } from "@server/api/v1/rounds/round-lifecycle.service";

describe("realtime integration", () => {
  it("delivers Room refreshes and revokes connected sockets when membership or visits end", async () => {
    // Prisma imports can preload .env; let the test environment override it.
    loadEnv();
    loadTestEnvironment({ requireDatabase: true });
    class RealtimeTestModule {}
    Module({
      providers: [
        PrismaService,
        AuthService,
        BoardsDetailService,
        RoomAccessService,
        { provide: RoundLifecycleService, useValue: { reconcileCircle: async () => undefined } },
        { provide: UploadsService, useValue: {} },
        RoomBannersService,
        RealtimeService,
        {
          provide: NotificationActivityService,
          useValue: { recordActivity: async () => undefined },
        },
        RealtimeGateway,
        {
          provide: MailerService,
          useValue: {
            sendOtpEmail: async () => {},
            sendInviteEmail: async () => {},
          },
        },
      ],
    })(RealtimeTestModule);

    const app = await NestFactory.create(RealtimeTestModule, { abortOnError: false, logger: false });
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    const server = app.getHttpServer();
    const address = server.address();
    const port = typeof address === "string" ? 4000 : (address?.port ?? 4000);
    const prisma = app.get(PrismaService);
    const authService = app.get(AuthService);
    const boardsDetail = app.get(BoardsDetailService);
    const realtime = app.get(RealtimeService);

    await prisma.$connect();

    const now = new Date();
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `realtime-${uniqueId}@example.com`,
        username: `realtime-user-${uniqueId}`,
        created_at: now,
        updated_at: now,
      },
    });

    const parent = await prisma.room.create({
      data: { name: "Visitor parent", owner_id: user.id, porosity: "open", created_at: now, updated_at: now },
    });
    await prisma.roomMembership.create({ data: { room_id: parent.id, user_id: user.id, disabled: false, created_at: now, updated_at: now } });
    const community = await prisma.room.create({
      data: {
        name: "Realtime Community",
        owner_id: user.id,
        created_at: now,
        updated_at: now,
      },
    });

    await prisma.roomMembership.create({
      data: {
        room_id: community.id,
        user_id: user.id,
        disabled: false,
        created_at: now,
        updated_at: now,
      },
    });

    const project = await prisma.project.create({ data: { owner_id: user.id, name: "Private source", created_at: now, updated_at: now } });
    const source = await prisma.entry.create({ data: { user_id: user.id, project_id: project.id, creation_origin: "project_material", status: "published", created_at: now, updated_at: now } });

    const post = await prisma.entry.create({
      data: {
        user_id: user.id,
        source_entry_id: source.id,
        room_id: community.id,
        status: "published",
        published_at: now,
        created_at: now,
        updated_at: now,
      },
    });

    const notes = await prisma.page.createManyAndReturn({ data: [
      { room_id: community.id, title: "Room memory" },
      { room_id: parent.id, title: "Other Room private memory" },
    ].map(data => ({ ...data, created_at: now, updated_at: now })) });
    await prisma.reflection.createMany({ data: notes.map(page => ({
      page_id: page.id, reflectable_type: "Post", reflectable_id: post.id,
      user_id: user.id, created_at: now, updated_at: now,
    })) });

    const token = authService.issueAccessToken(user.id);
    const socket = io(`http://localhost:${port}`, {
      auth: { token },
      transports: ["websocket"],
    });

    try {
      const eventPromise = new Promise(resolve => {
        const handler = (event: { type: string }) => { if (event.type === "invalidate") { socket.off("ChatChannel", handler); resolve(event); } };
        socket.on("ChatChannel", handler);
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect_error", reject);
        socket.once("connect", () => {
          socket.emit("subscribe", { channel: "ChatChannel", id: community.id });
          resolve();
        });
      });
      // Receiving "connect" does not mean the server has authorized and joined the room yet.
      await expect.poll(() => app.get(RealtimeGateway).server.sockets.adapter.rooms.get(realtime.chatRoom(community.id))?.size).toBe(1);

      const home = await boardsDetail.fetchRoomHome(community.id, user.id);
      expect(JSON.stringify(home)).toContain("Room memory");
      expect(JSON.stringify(home)).not.toContain("Other Room private memory");
      await realtime.emit("ChatChannel", realtime.chatRoom(community.id), { type: "invalidate", room_id: community.id });
      expect(await eventPromise).toEqual({ type: "invalidate", room_id: community.id });
      expect(await prisma.reflection.count({ where: { reflectable_type: "Post", reflectable_id: post.id } })).toBe(2);

      // Revocation must affect the already joined socket, not only a new subscription.
      await prisma.roomMembership.updateMany({
        where: { room_id: community.id, user_id: user.id },
        data: { disabled: true },
      });
      // Ownership independently grants membership access; remove that path as well.
      await prisma.room.update({ where: { id: community.id }, data: { owner_id: null } });
      const unexpected: unknown[] = [];
      socket.on("ChatChannel", (event) => unexpected.push(event));
      await realtime.emit("ChatChannel", realtime.chatRoom(community.id), { type: "invalidate", secret: "revoked" });
      expect(app.get(RealtimeGateway).server.sockets.adapter.rooms.get(realtime.chatRoom(community.id))?.size ?? 0).toBe(0);
      expect(unexpected).toEqual([]);

      await prisma.room.update({ where: { id: community.id }, data: { parent_id: parent.id, porosity: "masked" } });
      await prisma.roomVisit.create({ data: {
        room_id: community.id, user_id: user.id, source: "porosity",
        last_activity_at: new Date(), expires_at: new Date(Date.now() + 86_400_000),
      } });
      socket.emit("subscribe", { channel: "ChatChannel", id: community.id });
      await expect.poll(() => app.get(RealtimeGateway).server.sockets.adapter.rooms.get(realtime.chatRoom(community.id))?.size).toBe(1);
      const visitorEvents: unknown[] = [];
      socket.on("ChatChannel", event => { if (event.type !== "presence") visitorEvents.push(event); });
      await realtime.emit("ChatChannel", realtime.chatRoom(community.id), {
        type: "message", room_id: community.id, privateHistory: "member-only",
      });
      await expect.poll(() => visitorEvents).toEqual([{ type: "invalidate", room_id: community.id }]);



      socket.emit("subscribe", { channel: "ChatChannel", id: community.id });
      await expect.poll(async () => prisma.chatPresenceSession.count({ where: { room_id: community.id, user_id: user.id, left_at: null } })).toBe(1);
      const gateway = app.get(RealtimeGateway);
      const connected = gateway.server.sockets.sockets.get(socket.id!);
      expect(connected).toBeDefined();
      const expiredAt = new Date(Date.now() - 1000);
      await prisma.roomVisit.update({
        where: { room_id_user_id: { room_id: community.id, user_id: user.id } },
        data: { last_activity_at: new Date(expiredAt.getTime() - 86400000), expires_at: expiredAt },
      });
      await gateway.refreshChatPresence(connected!, { id: community.id });
      expect(connected!.rooms.has(realtime.chatRoom(community.id))).toBe(false);
      expect(await prisma.chatPresenceSession.count({ where: { room_id: community.id, user_id: user.id, left_at: null } })).toBe(0);
      expect((await prisma.roomVisit.findUniqueOrThrow({ where: { room_id_user_id: { room_id: community.id, user_id: user.id } } })).expires_at).toEqual(expiredAt);

    } finally {
      socket.disconnect();
      await prisma.reflection.deleteMany({ where: { page_id: { in: notes.map(note => note.id) } } });
      await prisma.page.deleteMany({ where: { id: { in: notes.map(note => note.id) } } });
      await prisma.entry.delete({ where: { id: post.id } });
      await prisma.entry.delete({ where: { id: source.id } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.roomMembership.deleteMany({ where: { room_id: community.id } });
      await prisma.room.delete({ where: { id: community.id } });
      await prisma.roomMembership.deleteMany({ where: { room_id: parent.id } });
      await prisma.room.delete({ where: { id: parent.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await app.close();
    }
  }, 15_000);
});
