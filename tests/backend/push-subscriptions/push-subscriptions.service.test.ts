import { PushSubscriptionsService } from "@server/api/push-subscriptions/push-subscriptions.service";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { capturePushSubscriptionEnabledMock, capturePushSubscriptionDisabledMock } = vi.hoisted(() => ({
  capturePushSubscriptionEnabledMock: vi.fn(),
  capturePushSubscriptionDisabledMock: vi.fn(),
}));

vi.mock("@server/runtime/posthog", () => ({
  capturePushSubscriptionEnabled: capturePushSubscriptionEnabledMock,
  capturePushSubscriptionDisabled: capturePushSubscriptionDisabledMock,
}));

const makePrisma = () => ({
  pushSubscription: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
});

describe("PushSubscriptionsService", () => {
  beforeEach(() => {
    capturePushSubscriptionEnabledMock.mockClear();
    capturePushSubscriptionDisabledMock.mockClear();
  });

  it("captures when subscriptions are created and disabled", async () => {
    const prisma = makePrisma();
    prisma.pushSubscription.findFirst.mockResolvedValue(null);
    const service = new PushSubscriptionsService();
    (service as any).prisma = prisma;

    await service.upsertSubscription(7, "endpoint", "p256dh", "auth");
    await service.unsubscribe(7, "endpoint");

    expect(prisma.pushSubscription.create).toHaveBeenCalled();
    expect(capturePushSubscriptionEnabledMock).toHaveBeenCalledWith({ userId: 7 });
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalled();
    expect(capturePushSubscriptionDisabledMock).toHaveBeenCalledWith({ userId: 7 });
  });
});
