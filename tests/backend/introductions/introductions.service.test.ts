import { withTestDependencies } from "@tests/backend/helpers/service";
import { BadRequestException } from "@nestjs/common";
import { IntroductionsService } from "@server/api/v1/introductions/introductions.service";
import { vi } from "vitest";

const makePrisma = () => {
  const prisma = {
  $transaction: vi.fn(),
  $queryRaw: vi.fn().mockImplementation(async (query: TemplateStringsArray) => Array.isArray(query) && query.join("").includes("FROM rooms") ? [{ id: 9 }] : []),
  activeStorageAttachment: { findMany: vi.fn().mockResolvedValue([]) },
  roomMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  introduction: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  introductionRecipient: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  notificationEvent: { create: vi.fn() },
  entry: { findFirst: vi.fn() },
  square: { findMany: vi.fn() },
  };
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  return prisma;
};

const makeService = (prisma = makePrisma()) => {
  return withTestDependencies(new IntroductionsService(), {
    prisma,
    notificationPreferences: {
      resolveForUser: vi.fn(async () => ({ notificationType: "all", deliveryMode: "immediate", pushEnabled: false })),
      allowsEvent: vi.fn(() => true),
    },
    notificationDelivery: {
      deliverImmediately: vi.fn(async () => ({ inboxItem: { id: 1 } })),
    },
    boss: { enqueueInTransaction: vi.fn() },
  });
};

describe("IntroductionsService", () => {
  it("rejects attempts to include the introducer as a recipient", async () => {
    const service = makeService();

    await expect(
      service.create(1, {
        room_id: 9,
        recipient_user_ids: [1, 2],
        note: "Shared rhythm work",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([true, false])("delivers Room/member notices with historical Squares present=%s", async (hasSquares) => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue({
      id: 11,
      user_id: 1,
      username_override: "Mara",
      user: { username: "mara" },
    });
    service.prisma.roomMembership.findMany.mockResolvedValue([
      { id: 21, user_id: 2, username_override: "Taisha", user: { username: "taisha" } },
      { id: 22, user_id: 3, username_override: null, user: { username: "ana" } },
    ]);
    service.prisma.square.findMany.mockResolvedValue(hasSquares ? [
      { id: 31, user_id: 2, board_id: 41 },
      { id: 32, user_id: 3, board_id: 42 },
    ] : []);
    service.prisma.introduction.create.mockResolvedValue({
      id: 51,
      note: "You are both working with repetition.",
      created_by_id: 1,
      created_by: { id: 1, username: "mara" },
      recipients: [],
    });
    service.prisma.notificationEvent.create
      .mockResolvedValueOnce({ id: 61, event_type: "introduction_created" })
      .mockResolvedValueOnce({ id: 62, event_type: "introduction_created" });

    const result = await service.create(1, {
      room_id: 9,
      recipient_user_ids: [2, 3],
      note: "You are both working with repetition.",
    });

    expect(result.introduction.id).toBe("51");
    expect(service.prisma.introduction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          room_id: 9,
          created_by_id: 1,
          recipients: {
            create: [
              expect.objectContaining({ user_id: 2 }),
              expect.objectContaining({ user_id: 3 }),
            ],
          },
        }),
      }),
    );
    expect(service.prisma.square.findMany).not.toHaveBeenCalled();
    expect(service.prisma.notificationEvent.create).toHaveBeenCalledTimes(2);
    expect(service.prisma.notificationEvent.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "introduction_created",
          target_user_id: 2,
          target_path: "/app/rooms/9/members/3/introductions?introduction=51",
          payload: expect.objectContaining({ otherRecipientName: "ana" }),
        }),
      }),
    );
    expect(service.prisma.notificationEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          target_user_id: 3,
          target_path: "/app/rooms/9/members/2/introductions?introduction=51",
          payload: expect.objectContaining({ otherRecipientName: "Taisha" }),
        }),
      }),
    );
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledTimes(2);
    expect(service.boss.enqueueInTransaction).toHaveBeenNthCalledWith(1, service.prisma, "notifications.fanout", { eventId: 61 });
    expect(service.boss.enqueueInTransaction).toHaveBeenNthCalledWith(2, service.prisma, "notifications.fanout", { eventId: 62 });
    expect(service.notificationDelivery.deliverImmediately).not.toHaveBeenCalled();
  });

  it("returns an existing active introduction for the same creator and pair without notifying twice", async () => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 11, user_id: 1 });
    service.prisma.roomMembership.findMany.mockResolvedValue([
      { id: 21, user_id: 2, user: { username: "taisha" } },
      { id: 22, user_id: 3, user: { username: "ana" } },
    ]);
    service.prisma.introduction.findFirst.mockResolvedValue({ id: 51 });

    await expect(service.create(1, {
      room_id: 9,
      recipient_user_ids: [2, 3],
      note: "You are both working with repetition.",
    })).resolves.toEqual({ introduction: { id: "51" }, existing: true });

    expect(service.prisma.introduction.create).not.toHaveBeenCalled();
    expect(service.prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("lists the active pairs created by the viewer in a circle", async () => {
    const service = makeService();
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 11 });
    service.prisma.introduction.findMany.mockResolvedValue([
      { id: 51, recipients: [{ user_id: 3 }, { user_id: 2 }] },
      { id: 52, recipients: [{ user_id: 2 }] },
    ]);

    await expect(service.listCreatedPairs(1, 9)).resolves.toEqual({
      pairs: [{ introduction_id: "51", recipient_user_ids: [2, 3] }],
    });
    expect(service.prisma.introduction.findMany).toHaveBeenCalledWith({
      where: { room_id: 9, created_by_id: 1, retracted_at: null },
      select: { id: true, recipients: { select: { user_id: true } } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
    });
  });

  it("serializes visible introductions for a square viewer", async () => {
    const service = makeService();
    service.prisma.introduction.findMany.mockResolvedValue([
      {
        id: 51,
        note: "You are both working with voice and room tone.",
        entry_id: 70,
        created_at: new Date("2026-05-08T18:30:00Z"),
        created_by_id: 4,
        created_by: { id: 4, username: "mara" },
        recipients: [
          { user_id: 1, hidden_at: null, seen_at: null, user: { id: 1, username: "will" } },
          { user_id: 2, hidden_at: null, seen_at: null, user: { id: 2, username: "taisha" } },
        ],
      },
    ]);
    service.prisma.roomMembership.findMany.mockResolvedValue([
      { id: 11, user_id: 1, username_override: "Will", user: { username: "will" } },
      { id: 12, user_id: 2, username_override: "Taisha", user: { username: "taisha" } },
      { id: 13, user_id: 4, username_override: "Mara", user: { username: "mara" } },
    ]);
    service.prisma.square.findMany.mockResolvedValue([{ id: 20, user_id: 2 }]);

    const result = await service.pageForMember({
      roomId: 9,
      viewedUserId: 2,
      viewedSquareId: 20,
      viewerUserId: 1,
    });

    expect(service.prisma.introduction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recipients: { some: { user_id: 2 } },
          OR: [
            { created_by_id: 1 },
            { recipients: { some: { user_id: 1, hidden_at: null } } },
          ],
        }),
      }),
    );
    expect(service.prisma.square.findMany).not.toHaveBeenCalled();
    expect(result.introductions[0].participants.every(participant => participant.squareId === null)).toBe(true);
    expect(result.introductions).toEqual([
      expect.objectContaining({
        id: "51",
        note: "You are both working with voice and room tone.",
        entryId: "70",
        throughPost: true,
        viewerIsRecipient: true,
        viewerSeenAt: null,
        canHide: true,
        canRetract: false,
        createdBy: expect.objectContaining({ displayUsername: "Mara" }),
        otherUser: expect.objectContaining({ displayUsername: "Will" }),
      }),
    ]);
  });

  it("marks only the viewer recipient rows as seen", async () => {
    const service = makeService();
    service.prisma.introductionRecipient.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.markSeen(7, ["51", 52, "not-an-id"]);

    expect(service.prisma.introductionRecipient.updateMany).toHaveBeenCalledWith({
      where: {
        introduction_id: { in: [51, 52] },
        user_id: 7,
        seen_at: null,
        introduction: { retracted_at: null },
      },
      data: {
        seen_at: expect.any(Date),
        updated_at: expect.any(Date),
      },
    });
    expect(result).toEqual({ success: true, markedCount: 2 });
  });

});
