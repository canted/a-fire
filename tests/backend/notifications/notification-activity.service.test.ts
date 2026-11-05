import { NotificationActivityService } from "@server/notifications/notification-activity.service";
import { vi } from "vitest";

const makePrisma = () => {
  return {
    prisma: {
      user: { update: vi.fn() },
      notificationPushDelivery: { updateMany: vi.fn() },
    },
  };
};

describe("NotificationActivityService", () => {
  it("updates last seen and cancels scheduled pushes created before activity", async () => {
    const { prisma } = makePrisma();
    const service = new NotificationActivityService();
    (service as any).prisma = prisma;
    const occurredAt = new Date("2026-01-01T00:00:00.000Z");

    await service.recordActivity(7, occurredAt);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { last_seen_at: occurredAt },
    });
    expect(prisma.notificationPushDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        user_id: 7,
        state: "scheduled",
        notification_event: {
          created_at: { lte: occurredAt },
        },
      },
      data: {
        state: "cancelled",
        cancelled_at: occurredAt,
        skip_reason: "user_activity",
        updated_at: occurredAt,
      },
    });
  });

  it("does not cancel scheduled pushes for passive disconnect activity", async () => {
    const { prisma } = makePrisma();
    const service = new NotificationActivityService();
    (service as any).prisma = prisma;

    await service.recordActivity(7, new Date("2026-01-01T00:00:00.000Z"), { cancelScheduledPushes: false });

    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.notificationPushDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("throttles repeated activity writes for the same user", async () => {
    const { prisma } = makePrisma();
    const service = new NotificationActivityService();
    (service as any).prisma = prisma;

    await service.recordActivity(7, new Date("2026-01-01T00:00:00.000Z"));
    await service.recordActivity(7, new Date("2026-01-01T00:00:10.000Z"));
    await service.recordActivity(7, new Date("2026-01-01T00:01:01.000Z"));

    expect(prisma.user.update).toHaveBeenCalledTimes(2);
    expect(prisma.notificationPushDelivery.updateMany).toHaveBeenCalledTimes(2);
  });

  it("can disable throttling for explicit callers", async () => {
    const { prisma } = makePrisma();
    const service = new NotificationActivityService();
    (service as any).prisma = prisma;

    await service.recordActivity(7, new Date("2026-01-01T00:00:00.000Z"), { throttleMs: 0 });
    await service.recordActivity(7, new Date("2026-01-01T00:00:00.000Z"), { throttleMs: 0 });

    expect(prisma.user.update).toHaveBeenCalledTimes(2);
  });
});
