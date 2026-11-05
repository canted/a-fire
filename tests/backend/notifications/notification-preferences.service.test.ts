import { withTestDependencies } from "@tests/backend/helpers/service";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { NotificationPreferencesService } from "@server/notifications/notification-preferences.service";
import { vi } from "vitest";

const { captureNotificationPreferencesUpdatedMock } = vi.hoisted(() => ({
  captureNotificationPreferencesUpdatedMock: vi.fn(),
}));

vi.mock("@server/runtime/posthog", () => ({
  captureNotificationPreferencesUpdated: captureNotificationPreferencesUpdatedMock,
}));

type PrismaMock = ReturnType<typeof mockPrisma>;

const mockPrisma = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ id: 2 }]),
  $transaction: vi.fn(function(this: unknown, callback: (database: unknown) => unknown) { return callback(this); }),
  roomMembership: { findMany: vi.fn(), findFirst: vi.fn() },
  notificationPreference: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  activeStorageAttachment: { findMany: vi.fn() },
});

describe("NotificationPreferencesService", () => {
  beforeEach(() => {
    captureNotificationPreferencesUpdatedMock.mockClear();
  });

  const makeService = (prisma: PrismaMock) => {
    return withTestDependencies(new NotificationPreferencesService(), {
      prisma,
    });
  };

  it("lists empty when no memberships", async () => {
    const prisma = mockPrisma();
    prisma.roomMembership.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const result = await service.listForUser(1);

    expect(result.items).toEqual([]);
  });

  it("lists preferences and defaults per community", async () => {
    const prisma = mockPrisma();
    prisma.roomMembership.findMany.mockResolvedValue([
      { room_id: 1, room: { id: 1, name: "Alpha" } },
      { room_id: 2, room: { id: 2, name: "Beta" } },
    ]);
    prisma.notificationPreference.findMany.mockResolvedValue([
      { scope_id: 2, notification_type: "posts" },
    ]);
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_id: 2, blob_id: 99 }]);

    const service = makeService(prisma);
    const result = await service.listForUser(1);

    expect(result.items).toEqual([
      {
        room_id: 1,
        room_name: "Alpha",
        room_avatar_url: null,
        notification_type: "all",
      },
      {
        room_id: 2,
        room_name: "Beta",
        room_avatar_url: "/api/v1/uploads/99/variants/icon160",
        notification_type: "posts",
      },
    ]);
  });

  it("rejects invalid notification type", async () => {
    const service = makeService(mockPrisma());
    await expect(service.updateForUser(1, 2, "bad")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when membership missing", async () => {
    const prisma = mockPrisma();
    prisma.roomMembership.findFirst.mockResolvedValue(null);

    const service = makeService(prisma);
    await expect(service.updateForUser(1, 2, "all")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updates existing preference", async () => {
    const prisma = mockPrisma();
    prisma.roomMembership.findFirst.mockResolvedValue({ room: { id: 2, name: "C" } });
    prisma.notificationPreference.findFirst.mockResolvedValue({ id: 9 });
    prisma.notificationPreference.update.mockResolvedValue({ notification_type: "none" });
    prisma.activeStorageAttachment.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const result = await service.updateForUser(1, 2, "none");

    expect(prisma.notificationPreference.update).toHaveBeenCalled();
    expect(captureNotificationPreferencesUpdatedMock).toHaveBeenCalledWith({
      userId: 1,
      roomId: 2,
      notificationType: "none",
    });
    expect(result.notification_type).toBe("none");
  });

  it("creates preference when missing", async () => {
    const prisma = mockPrisma();
    prisma.roomMembership.findFirst.mockResolvedValue({ room: { id: 2, name: "C" } });
    prisma.notificationPreference.findFirst.mockResolvedValue(null);
    prisma.notificationPreference.create.mockResolvedValue({ notification_type: "posts" });
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_id: 2, blob_id: 7 }]);

    const service = makeService(prisma);
    const result = await service.updateForUser(1, 2, "posts");

    expect(prisma.notificationPreference.create).toHaveBeenCalled();
    expect(result.notification_type).toBe("posts");
    expect(result.room_avatar_url).toBe("/api/v1/uploads/7/variants/icon160");
  });

  it("resolves scoped preferences", async () => {
    const prisma = mockPrisma();
    prisma.notificationPreference.findMany.mockResolvedValue([{
      scope_type: "Global", scope_id: null,
      notification_type: "posts",
      delivery_mode: "immediate",
      push_enabled: false,
    }]);

    const service = makeService(prisma);
    const result = await service.resolveForUser(1, {
      id: 1,
      event_type: "post_created",
      actor: null,
      room: null,
      entry_id: 1,
      square_id: null,
      board_id: null,
      room_id: null,
    } as any);

    expect(result.notificationType).toBe("posts");
    expect(result.pushEnabled).toBe(false);
  });

  it("maps community avatars when listing", async () => {
    const prisma = mockPrisma();
    prisma.roomMembership.findMany.mockResolvedValue([
      { room_id: 1, room: { id: 1, name: "A" } },
    ]);
    prisma.notificationPreference.findMany.mockResolvedValue([]);
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_id: 1, blob_id: 9 }]);

    const service = makeService(prisma);
    const result = await service.listForUser(1);

    expect(result.items[0].room_avatar_url).toBe("/api/v1/uploads/9/variants/icon160");
  });

  it("resolves preferences defaults", async () => {
    const prisma = mockPrisma();
    prisma.notificationPreference.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const result = await service.resolveForUser(1, {
      id: 1,
      event_type: "post_created",
      actor: null,
      room: null,
      entry_id: null,
      square_id: null,
      board_id: null,
      room_id: null,
    } as any);

    expect(result.notificationType).toBe("all");
    expect(result.deliveryMode).toBe("immediate");
  });

  it("resolves preference fields with fallbacks", async () => {
    const prisma = mockPrisma();
    prisma.notificationPreference.findMany.mockResolvedValue([{
      scope_type: "Global", scope_id: null,
      notification_type: null,
      delivery_mode: null,
      push_enabled: null,
    }]);

    const service = makeService(prisma);
    const result = await service.resolveForUser(1, {
      id: 1,
      event_type: "post_created",
      actor: null,
      room: null,
      entry_id: null,
      square_id: null,
      board_id: null,
      room_id: null,
    } as any);

    expect(result.notificationType).toBe("all");
    expect(result.deliveryMode).toBe("immediate");
    expect(result.pushEnabled).toBe(true);
  });

  it("filters events based on preference", () => {
    const service = makeService(mockPrisma());

    expect(service.allowsEvent({ notificationType: "none", deliveryMode: "immediate", pushEnabled: true }, "post_created")).toBe(false);
    expect(service.allowsEvent({ notificationType: "posts", deliveryMode: "immediate", pushEnabled: true }, "post_created")).toBe(true);
    expect(service.allowsEvent({ notificationType: "posts", deliveryMode: "immediate", pushEnabled: true }, "mention")).toBe(true);
    expect(service.allowsEvent({ notificationType: "posts", deliveryMode: "immediate", pushEnabled: true }, "reply_created")).toBe(false);
    expect(service.allowsEvent({ notificationType: "all", deliveryMode: "mute", pushEnabled: true }, "post_created")).toBe(false);
  });
});
