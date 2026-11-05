import { RoomRelationshipsService } from "@server/api/v1/rooms/room-relationships.service";
import { RoomNotificationDeliveriesService } from "@server/api/v1/rooms/room-notification-deliveries.service";
import { withTestDependencies } from "@tests/backend/helpers/service";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { RoomsService } from "@server/api/v1/rooms/rooms.service";
import { vi } from "vitest";

const { captureCommunityCreatedMock } = vi.hoisted(() => ({
  captureCommunityCreatedMock: vi.fn(),
}));

vi.mock("@server/runtime/posthog", () => ({
  captureCommunityCreated: captureCommunityCreatedMock,
}));

type PrismaMock = ReturnType<typeof makePrisma>;

const makePrisma = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id: 3 }]),
  $transaction: vi.fn(async function (this: PrismaMock, callback: (transaction: PrismaMock) => Promise<unknown>) { return callback(this); }),
  roomVisit: { updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
  room: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  roomMembership: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  invite: { updateMany: vi.fn() },
  board: { create: vi.fn(), findFirst: vi.fn() },
  square: { create: vi.fn(), findMany: vi.fn() },
  entry: { findMany: vi.fn() },
  reply: { findMany: vi.fn() },
  entryViewState: { findMany: vi.fn() },
  activeStorageAttachment: { findFirst: vi.fn(), findMany: vi.fn() },
  notificationPushDelivery: { findMany: vi.fn() },
  roomJoinRequest: { findUnique: vi.fn().mockResolvedValue(null) },
  roomMemberInvitation: { findUnique: vi.fn().mockResolvedValue(null) },
  chatPresenceSession: { findMany: vi.fn().mockResolvedValue([]) },
});

const makeUploads = () => ({
  createAttachmentUpload: vi.fn(),
  removeAttachment: vi.fn(),
});

const makeFile = () =>
  ({
    originalname: "avatar.png",
    mimetype: "image/png",
    buffer: Buffer.from("image"),
    size: 5,
  }) as Express.Multer.File;

describe("CommunitiesService", () => {
  beforeEach(() => {
    captureCommunityCreatedMock.mockClear();
  });

  const makeService = (prisma: PrismaMock, uploads = makeUploads()) => {
    return withTestDependencies(new RoomsService(), {
      prisma,
      uploadsService: uploads,
      relationships: withTestDependencies(new RoomRelationshipsService(), { prisma }),
      deliveries: withTestDependencies(new RoomNotificationDeliveriesService(), { prisma }),
      circleAccess: {
        require: vi.fn(async (id: number, userId: number) => {
          const membership = await prisma.roomMembership.findFirst({
            where: { room_id: id, user_id: userId, disabled: false },
          });
          if (!membership) throw new ForbiddenException("Forbidden");
          const circle = await prisma.room.findUnique({ where: { id } });
          if (!circle) throw new NotFoundException("Not Found");
          return {
            kind: "member",
            source: "membership",
            room: { ...circle, parent_id: circle.parent_id ?? null, porosity: circle.porosity ?? "open" },
            canManage: circle.owner_id === userId,
            canCreateSideCircle: true,
            canViewNotes: true,
            canWriteWall: true,
            canParticipateActivities: true,
          };
        }),
        resolve: vi.fn().mockResolvedValue(null),
      },
    });
  };

  it("fetches a member community with its ActiveStorage avatar", async () => {
    const prisma = makePrisma();
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 5 });
    prisma.room.findUnique.mockResolvedValue({ id: 1, name: "Studio", owner_id: 9 });
    prisma.activeStorageAttachment.findFirst.mockResolvedValue({ blob_id: 44 });

    const result = await makeService(prisma).fetchRoom(1, 2);

    expect(result).not.toHaveProperty("memberBoard");
    expect(result).toEqual(expect.objectContaining({
      id: 1,
      name: "Studio",
      avatar_url: "/api/v1/uploads/44/variants/icon160",
      owner_id: 9,
      canManage: false,
      porosity: "open",
      porosity_label: "Open",
      parent: null,
      membership_state: "member",
      access: expect.objectContaining({ kind: "member", can_view_notes: true, can_write_wall: true }),
    }));
  });

  it("serializes supported circle porosity values", async () => {
    const prisma = makePrisma();
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 5 });
    prisma.room.findUnique.mockResolvedValue({ id: 1, name: "Studio", owner_id: 9, porosity: "masked" });
    prisma.activeStorageAttachment.findFirst.mockResolvedValue(null);

    const result = await makeService(prisma).fetchRoom(1, 2);

    expect(result.porosity).toBe("masked");
  });

  it("creates a Room, owner membership and avatar without Boards or Squares", async () => {
    const prisma = makePrisma();
    const uploads = makeUploads();
    prisma.user.findUnique.mockResolvedValue({ id: 7, username: "will" });
    prisma.room.findUnique.mockResolvedValue({ reply_mode: "simple" });
    prisma.room.create.mockResolvedValue({ id: 11, name: "Studio", owner_id: 7 });
    prisma.board.create.mockResolvedValue({ id: 12 });
    prisma.activeStorageAttachment.findFirst.mockResolvedValue({ blob_id: 99 });
    uploads.createAttachmentUpload.mockResolvedValue({ id: 99 });

    const result = await makeService(prisma, uploads).createRoom(7, {
      name: " Studio ",
      porosity: "masked",
      avatarFile: makeFile(),
    });

    expect(prisma.room.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Studio", owner_id: 7, porosity: "masked" }),
    });
    expect(prisma.roomMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ room_id: 11, user_id: 7, disabled: false }),
    });
    expect(prisma.board.create).not.toHaveBeenCalled();
    expect(prisma.square.create).not.toHaveBeenCalled()

    expect(uploads.createAttachmentUpload).toHaveBeenCalledWith(7, expect.any(Object), {
      record_type: "Circle",
      record_id: 11,
      name: "avatar",
    });
    expect(captureCommunityCreatedMock).toHaveBeenCalledWith({ userId: 7, roomId: 11 });
    expect(result.avatar_url).toBe("/api/v1/uploads/99/variants/icon160");
  });

  it("allows creating an unnamed community", async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 1, username: "will" });
    prisma.room.findUnique.mockResolvedValue({ reply_mode: "simple" });
    prisma.room.create.mockResolvedValue({ id: 11, name: null, owner_id: 1 });
    prisma.board.create.mockResolvedValue({ id: 12 });
    prisma.activeStorageAttachment.findFirst.mockResolvedValue(null);

    const result = await makeService(prisma).createRoom(1, { name: " " });

    expect(prisma.room.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: null, owner_id: 1 }),
    });
    expect(result.name).toBeNull();
  });

  it("updates only communities owned by the user and can remove the avatar", async () => {
    const prisma = makePrisma();
    const uploads = makeUploads();
    prisma.room.findFirst.mockResolvedValue({ id: 3, name: "Old", owner_id: 2 });
    prisma.room.update.mockResolvedValue({ id: 3, name: "New", owner_id: 2 });
    prisma.room.findUnique.mockResolvedValue({ reply_mode: "simple" });
    prisma.activeStorageAttachment.findFirst.mockResolvedValue(null);

    const result = await makeService(prisma, uploads).updateRoom(3, 2, {
      name: "New",
      porosity: "open",
      removeAvatar: true,
    });

    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 3, deleted_at: null },
      data: expect.objectContaining({ name: "New", porosity: "open" }),
    });
    expect(uploads.removeAttachment).toHaveBeenCalledWith(2, {
      record_type: "Circle",
      record_id: 3,
      name: "avatar",
    });
    expect(result.avatar_url).toBeNull();
  });

  it("rejects updates for non-owners", async () => {
    const prisma = makePrisma();
    prisma.room.findFirst.mockResolvedValue(null);

    await expect(makeService(prisma).updateRoom(3, 2, { name: "New" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects fetching missing communities", async () => {
    const prisma = makePrisma();
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.room.findUnique.mockResolvedValue(null);

    await expect(makeService(prisma).fetchRoom(3, 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("lists active community members for members", async () => {
    const prisma = makePrisma();
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.room.findUnique.mockResolvedValue({ id: 3, name: "Circle", owner_id: 1, porosity: "open" });
    prisma.roomMembership.findMany.mockResolvedValue([
      { id: 1, user_id: 10, username_override: "Host", user: { username: "will" } },
      { id: 2, user_id: 11, username_override: null, user: { username: "alex" } },
    ]);
    prisma.$queryRaw.mockResolvedValue([{ record_id: 11, blob_id: 901 }]);
    prisma.board.findFirst.mockResolvedValue({ id: 77 });
    prisma.square.findMany.mockResolvedValue([{ id: 101, user_id: 10 }, { id: 102, user_id: 11 }]);

    const result = await makeService(prisma).listMembers(3, 2);

    expect(prisma.roomMembership.findMany).toHaveBeenCalledWith({
      where: { room_id: 3, disabled: false },
      include: { user: true },
      orderBy: { id: "asc" },
    });
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
    expect(prisma.square.findMany).not.toHaveBeenCalled();
    expect(prisma.activeStorageAttachment.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      members: [
        {
          id: 1,
          user_id: 10,
          display_username: "Host",
          display_avatar_url: null,
          avatar_url: null,
          presence: { is_here: false, last_seen_at: null },
          location: { room_id: null, name: null, is_private: false },
        },
        {
          id: 2,
          user_id: 11,
          display_username: "alex",
          display_avatar_url: "/api/v1/uploads/901/variants/avatarStripe40",
          avatar_url: "/api/v1/uploads/901/variants/avatarStripe40",
          presence: { is_here: false, last_seen_at: null },
          location: { room_id: null, name: null, is_private: false },
        },
      ],
    });
  });

  it("lets the circle owner remove a member from a community", async () => {
    const prisma = makePrisma();
    prisma.room.findFirst.mockResolvedValue({ id: 3 });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 2, room_id: 3, user_id: 11 });
    prisma.roomMembership.update.mockResolvedValue({ id: 2, room_id: 3, user_id: 11, disabled: true });

    const result = await makeService(prisma).removeMember(3, 1, 2);

    expect(prisma.roomMembership.findFirst).toHaveBeenCalledWith({
      where: { id: 2, room_id: 3, disabled: false },
      select: { id: true, room_id: true, user_id: true },
    });
    expect(prisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { disabled: true, revoked_at: expect.any(Date), updated_at: expect.any(Date) },
    });
    expect(result).toEqual({ success: true, member_id: 2 });
  });

  it("rejects member removal by a non-owner", async () => {
    const prisma = makePrisma();

    await expect(makeService(prisma).removeMember(3, 2, 2)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.roomMembership.update).not.toHaveBeenCalled();
  });

  it("lets an owner logically delete a community", async () => {
    const prisma = makePrisma();
    prisma.room.findFirst.mockResolvedValue({ id: 3 });

    const result = await makeService(prisma).deleteRoom(3, 9);

    expect(prisma.room.findFirst).toHaveBeenCalledWith({
      where: { id: 3, owner_id: 9 },
      select: { id: true },
    });
    expect(prisma.roomMembership.updateMany).toHaveBeenCalledWith({
      where: { room_id: 3, disabled: false },
      data: { disabled: true, revoked_at: expect.any(Date), updated_at: expect.any(Date) },
    });
    expect(prisma.invite.updateMany).toHaveBeenCalledWith({
      where: { room_id: 3, used_at: null },
      data: { expires_at: expect.any(Date), updated_at: expect.any(Date) },
    });
    expect(result).toEqual({ success: true, room_id: 3 });
  });

  it("rejects community deletion by a non-owner", async () => {
    const prisma = makePrisma();
    prisma.room.findFirst.mockResolvedValue(null);

    await expect(makeService(prisma).deleteRoom(3, 8)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.roomMembership.updateMany).not.toHaveBeenCalled();
  });

  it("lists recent notification deliveries for the circle owner", async () => {
    const prisma = makePrisma();
    prisma.room.findFirst.mockResolvedValue({ id: 4 });
    const createdAt = new Date("2026-06-28T20:42:00.000Z");
    const dueAt = new Date("2026-06-28T20:44:00.000Z");
    const replyPublishedAt = new Date("2026-06-28T20:41:00.000Z");
    prisma.notificationPushDelivery.findMany.mockResolvedValue([
      {
        id: 9,
        notification_event_id: 12,
        user_id: 44,
        state: "skipped",
        due_at: dueAt,
        sent_at: null,
        cancelled_at: null,
        skip_reason: "subscription_missing",
        last_error: "No active web push subscription",
        created_at: createdAt,
        user: { username: "Ada" },
        notification_event: {
          id: 12,
          event_type: "reply_created",
          entry_id: 183,
          payload: { replyId: 7 },
          target_path: "/app/entries/183#reply-7",
        },
      },
    ]);
    prisma.entry.findMany.mockResolvedValue([{ id: 183, created_at: new Date("2026-06-28T20:40:00.000Z"), published_at: null }]);
    prisma.reply.findMany.mockResolvedValue([{ id: 7, created_at: new Date("2026-06-28T20:40:30.000Z"), published_at: replyPublishedAt }]);
    prisma.entryViewState.findMany.mockResolvedValue([
      {
        user_id: 44,
        entry_id: 183,
        entry_seen_at: null,
        reply_seen_through_at: replyPublishedAt,
        reply_seen_through_id: 7,
      },
    ]);

    const result = await makeService(prisma).listNotificationDeliveries(4, 1);

    expect(prisma.notificationPushDelivery.findMany).toHaveBeenCalledWith({
      where: {
        notification_event: {
          room_id: 4,
        },
      },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        id: true,
        notification_event_id: true,
        user_id: true,
        state: true,
        due_at: true,
        sent_at: true,
        cancelled_at: true,
        skip_reason: true,
        last_error: true,
        created_at: true,
        user: { select: { username: true } },
        notification_event: {
          select: {
            id: true,
            event_type: true,
            entry_id: true,
            payload: true,
            target_path: true,
          },
        },
      },
    });
    expect(prisma.entry.findMany).toHaveBeenCalledWith({
      where: { id: { in: [183] } },
      select: { id: true, created_at: true, published_at: true },
    });
    expect(prisma.reply.findMany).toHaveBeenCalledWith({
      where: { id: { in: [7] } },
      select: { id: true, created_at: true, published_at: true },
    });
    expect(prisma.entryViewState.findMany).toHaveBeenCalledWith({
      where: { user_id: { in: [44] }, entry_id: { in: [183] } },
      select: {
        user_id: true,
        entry_id: true,
        entry_seen_at: true,
        reply_seen_through_at: true,
        reply_seen_through_id: true,
      },
    });
    expect(result).toEqual({
      items: [
        {
          id: 9,
          notification_event_id: 12,
          user_id: 44,
          user_name: "Ada",
          state: "skipped",
          created_at: "2026-06-28T20:42:00.000Z",
          due_at: "2026-06-28T20:44:00.000Z",
          sent_at: null,
          cancelled_at: null,
          skip_reason: "subscription_missing",
          last_error: "No active web push subscription",
          event_type: "reply_created",
          entry_id: 183,
          reply_id: "7",
          link_path: "/app/entries/183#reply-7",
          link_label: "Reply 7",
          content_seen: true,
        },
      ],
    });
  });

  it("rejects listing notification deliveries for a non-owner", async () => {
    const prisma = makePrisma();

    await expect(makeService(prisma).listNotificationDeliveries(4, 2)).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.notificationPushDelivery.findMany).not.toHaveBeenCalled();
  });

  it("rejects listing members for non-members", async () => {
    const prisma = makePrisma();
    prisma.roomMembership.findFirst.mockResolvedValue(null);

    await expect(makeService(prisma).listMembers(3, 2)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
