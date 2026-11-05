import { withTestDependencies } from "@tests/backend/helpers/service";
import { vi } from "vitest";
import { NotificationDeliveryService } from "@server/notifications/notification-delivery.service";

var webpushMock: {
  sendNotification: ReturnType<typeof vi.fn>;
};

vi.mock("web-push", () => {
  webpushMock = {
    sendNotification: vi.fn(),
  };
  return { default: webpushMock };
});

vi.mock("@server/notifications/push-device-journal", async importOriginal => ({
  ...await importOriginal<typeof import("@server/notifications/push-device-journal")>(),
  beginPushDeviceAttempt: vi.fn(async()=>({claimed:true,attempt:{id:1,attempt_count:1}})),
  completePushDeviceAttempt: vi.fn(async()=>true),
}));

type PrismaMock = ReturnType<typeof mockPrisma>;

const mockPrisma = () => ({
  round: { findUnique: vi.fn() },
  introduction: { findUnique: vi.fn() },
  entry: { findUnique: vi.fn().mockResolvedValue({ id: 42, status: "published", room_id: 3 }) },
  reply: { findUnique: vi.fn().mockResolvedValue({ entry_id: 42, status: "published" }) },
  notificationInboxItem: { upsert: vi.fn() },
  notificationPushDelivery: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn().mockResolvedValue({count:1}), update: vi.fn() },
  pushSubscription: { findMany: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
});

const mockRealtime = () => ({
  emit: vi.fn(),
  notificationRoom: vi.fn((id: number) => `notification:${id}`),
  isUserActive: vi.fn(() => false),
});

describe("NotificationDeliveryService", () => {
  const originalVapidEnv = {
    VITE_VAPID_PUBLIC_KEY: process.env.VITE_VAPID_PUBLIC_KEY,
    VITE_VAPID_PRIVATE_KEY: process.env.VITE_VAPID_PRIVATE_KEY,
    VITE_VAPID_SUBJECT: process.env.VITE_VAPID_SUBJECT,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    BREVO_SENDER: process.env.BREVO_SENDER,
  };

  const makeService = (prisma: PrismaMock) => {
    return withTestDependencies(new NotificationDeliveryService(), {
      prisma,
      preferences: {
        resolveForUser: vi.fn().mockResolvedValue({ notificationType: "all", deliveryMode: "immediate", pushEnabled: true }),
        allowsEvent: vi.fn().mockReturnValue(true),
      },
      circleAccess: { canReadPublishedChatMessage: vi.fn().mockResolvedValue(true), resolve: vi.fn().mockResolvedValue({ kind: "member" }) },
      realtime: mockRealtime(),
      unseenContent: { countForUser: vi.fn(async () => ({ total: 2, entries: 1, replies: 1 })) },
      inboxSerializer: {
        serialize: vi.fn(async () => [
          {
            id: "1",
            deliveryState: "delivered",
            notificationEvent: { id: "9", eventType: "post_created", payload: {}, createdAt: new Date().toISOString() },
          },
        ]),
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries(originalVapidEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("withholds a queued Chat excerpt when its source is no longer readable", async () => {
    const prisma = mockPrisma();
    const service = makeService(prisma);
    service.circleAccess.canReadPublishedChatMessage.mockResolvedValue(false);
    const event = { id: 9, event_type: "chat_message_created", payload: { chat_message_id: 12, excerpt: "Private text" } } as any;
    expect(await service.deliverImmediately(1, event, { pushEnabled: true } as any)).toMatchObject({ inboxItem: null });
    expect(service.circleAccess.canReadPublishedChatMessage).toHaveBeenCalledWith(12, 1, expect.any(Date), prisma);
    expect(prisma.notificationInboxItem.upsert).not.toHaveBeenCalled();
    expect(service.realtime.emit).not.toHaveBeenCalled();
    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("cancels delayed Chat pushes after access changes and keeps authorization failures retryable", async () => {
    const prisma = mockPrisma();
    const service = makeService(prisma);
    prisma.notificationPushDelivery.findUnique.mockResolvedValue({ id: 30, user_id: 1, state: "scheduled", notification_event: {
      id: 9, event_type: "chat_message_created", payload: { chat_message_id: 12, excerpt: "Private text" },
    } });
    service.circleAccess.canReadPublishedChatMessage.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.handleDelayedPush(30)).rejects.toThrow("database unavailable");
    expect(prisma.notificationPushDelivery.update).not.toHaveBeenCalled();
    service.circleAccess.canReadPublishedChatMessage.mockResolvedValue(false);
    await service.handleDelayedPush(30);
    expect(prisma.notificationPushDelivery.update).toHaveBeenCalledWith({ where: { id: 30 }, data: expect.objectContaining({ state: "cancelled", skip_reason: "content_unavailable" }) });
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("leaves a delayed push retryable when current preference lookup fails", async () => {
    const prisma = mockPrisma();
    const service = makeService(prisma);
    prisma.notificationPushDelivery.findUnique.mockResolvedValue({ id: 30, user_id: 1, state: "scheduled", notification_event: { id: 9, event_type: "reply_created" } });
    service.preferences.resolveForUser.mockRejectedValue(new Error("database unavailable"));
    await expect(service.handleDelayedPush(30)).rejects.toThrow("database unavailable");
    expect(prisma.notificationPushDelivery.update).not.toHaveBeenCalled();
    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it.each(["Entry", "Round", "Introduction"] as const)("withholds delayed %s content and retries authorization lookup errors", async kind => {
    const prisma = mockPrisma();
    const service = makeService(prisma);
    const event = kind === "Entry" ? { id: 9, event_type: "post_created", entry_id: 42 } : kind === "Round" ? { id: 9, event_type: "round_reminder", payload: { round_id: 42 } } : { id: 9, event_type: "introduction_created", payload: { introductionId: 42 } };
    const source = kind === "Entry" ? prisma.entry : kind === "Round" ? prisma.round : prisma.introduction;
    prisma.notificationPushDelivery.findUnique.mockResolvedValue({ id: 30, user_id: 1, state: "scheduled", notification_event: event });
    source.findUnique.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.handleDelayedPush(30)).rejects.toThrow("database unavailable");
    expect(prisma.notificationPushDelivery.update).not.toHaveBeenCalled();
    source.findUnique.mockResolvedValue(null);
    await service.handleDelayedPush(30);
    expect(prisma.notificationPushDelivery.update).toHaveBeenCalledWith({ where: { id: 30 }, data: expect.objectContaining({ state: "cancelled", skip_reason: "content_unavailable" }) });
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("does not broadcast event metadata when the serializer withholds the notice", async () => {
    const prisma = mockPrisma();
    prisma.notificationInboxItem.upsert.mockResolvedValue({ id: 1 });
    const service = makeService(prisma);
    service.inboxSerializer.serialize.mockResolvedValue([]);
    const result = await service.deliverImmediately(1, { id: 9, event_type: "post_created", entry_id: 42 } as any, { pushEnabled: true } as any);
    expect(result.scheduledPushDelivery).toBeUndefined();
    expect(service.realtime.emit).not.toHaveBeenCalled();
    expect(prisma.notificationPushDelivery.upsert).not.toHaveBeenCalled();
  });

  it("delivers notifications and emits", async () => {
    const prisma = mockPrisma();
    prisma.notificationInboxItem.upsert.mockResolvedValue({ id: 1 });

    const service = makeService(prisma);
    (service as any).sendPush = vi.fn();

    const event = { id: 9, event_type: "post_created", entry_id: 42 } as any;
    const preference = { pushEnabled: false } as any;

    const result = await service.deliverImmediately(1, event, preference);

    expect(result.inboxItem).toEqual({ id: 1 });
    expect(service.realtime.emit).toHaveBeenCalledWith(
      "NotificationChannel",
      "notification:1",
      expect.objectContaining({
        unseen_count: 2,
        unseen_counts: { total: 2, entries: 1, replies: 1 },
        notice: expect.objectContaining({ id: "1" }),
      }),
    );
  });

  it("includes affected post metadata in realtime notification payloads", async () => {
    const prisma = mockPrisma();
    prisma.notificationInboxItem.upsert.mockResolvedValue({ id: 1 });

    const service = makeService(prisma);
    (service as any).sendPush = vi.fn();

    const event = {
      id: 9,
      event_type: "reply_created",
      entry_id: 42,
      target_path: "/app/entries/42#reply-7",
    } as any;
    const preference = { pushEnabled: false } as any;

    await service.deliverImmediately(1, event, preference);

    expect(service.realtime.emit).toHaveBeenCalledWith(
      "NotificationChannel",
      "notification:1",
      expect.objectContaining({
        event_type: "reply_created",
        entry_id: 42,
        target_path: "/app/entries/42#reply-7",
      }),
    );
  });

  it("requests push when enabled", async () => {
    const prisma = mockPrisma();
    prisma.notificationInboxItem.upsert.mockResolvedValue({ id: 1 });
    prisma.notificationPushDelivery.findUnique.mockResolvedValue(null);
    prisma.notificationPushDelivery.upsert.mockResolvedValue({ id: 9, state: "scheduled", scheduled_job_id: null, due_at: new Date() });

    const service = makeService(prisma);
    const sendPush = vi.fn();
    (service as any).sendPush = sendPush;

    const result = await service.deliverImmediately(1, { id: 2, event_type: "post_created", entry_id: 42 } as any, { pushEnabled: true } as any);

    expect(sendPush).not.toHaveBeenCalled();
    expect(result.scheduledPushDelivery).toEqual({ deliveryId: 9, dueAt: expect.any(Date) });
  });

  it("schedules delayed push when the user was recently active", async () => {
    const prisma = mockPrisma();
    prisma.notificationInboxItem.upsert.mockResolvedValue({ id: 1 });
    prisma.user.findUnique.mockResolvedValue({ last_seen_at: new Date() });
    prisma.notificationPushDelivery.findUnique.mockResolvedValue(null);
    prisma.notificationPushDelivery.upsert.mockResolvedValue({ id: 9, state: "scheduled", scheduled_job_id: null, due_at: new Date() });

    const service = makeService(prisma);
    const sendPush = vi.fn();
    (service as any).sendPush = sendPush;

    const result = await service.deliverImmediately(1, { id: 2, event_type: "post_created", entry_id: 42 } as any, { pushEnabled: true } as any);

    expect(sendPush).not.toHaveBeenCalled();
    expect(result.scheduledPushDelivery).toEqual({ deliveryId: 9, dueAt: expect.any(Date) });
  });

  it("cancels delayed push when the user is realtime active at delivery time", async () => {
    const prisma = mockPrisma();
    prisma.notificationPushDelivery.findUnique.mockResolvedValue({
      id: 9,
      state: "scheduled",
      user_id: 1,
      notification_event: { id: 2, event_type: "post_created" },
    });

    const service = makeService(prisma);
    service.realtime.isUserActive.mockReturnValue(true);

    await service.handleDelayedPush(9);

    expect(prisma.notificationPushDelivery.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        state: "cancelled",
        skip_reason: "user_active",
      }),
    });
    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("skips push when user is active", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{
      id: 1,
      endpoint: "endpoint",
      p256dh: "p",
      auth: "a",
    }]);
    const service = makeService(prisma);
    service.realtime.isUserActive.mockReturnValue(true);

    await (service as any).sendPush(1, { id: 3, event_type: "post_created", entry_id: 42 } as any, 2);

    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("skips push when subscription missing", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([]);
    const service = makeService(prisma);

    await (service as any).sendPush(1, { id: 4, event_type: "post_created", entry_id: 42 } as any, 1);

    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("skips push when keys missing", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{
      id: 1,
      endpoint: "endpoint",
      p256dh: "p",
      auth: "a",
    }]);
    const service = makeService(prisma);
    process.env.VITE_VAPID_PUBLIC_KEY = "";
    process.env.VITE_VAPID_PRIVATE_KEY = "";
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    await (service as any).sendPush(1, { id: 5, event_type: "post_created", entry_id: 42 } as any, 1);

    expect(webpushMock.sendNotification).not.toHaveBeenCalled();
  });

  it("sends push and updates invalid subscriptions", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{
      id: 1,
      endpoint: "endpoint",
      p256dh: "p",
      auth: "a",
    }]);
    prisma.user.findUnique.mockResolvedValue({ last_seen_at: new Date(Date.now() - 10 * 60 * 1000) });
    webpushMock.sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    process.env.VITE_VAPID_PUBLIC_KEY = "pub";
    process.env.VITE_VAPID_PRIVATE_KEY = "priv";
    process.env.VITE_VAPID_SUBJECT = "mailto:test@example.com";

    const service = makeService(prisma);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await (service as any).sendPush(1, { id: 6, event_type: "post_created", entry_id: 42 } as any, 1);

    expect(webpushMock.sendNotification).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({
        vapidDetails: expect.objectContaining({
          publicKey: "pub",
          privateKey: "priv",
          subject: "mailto:test@example.com",
        }),
      }),
    );
    expect(prisma.pushSubscription.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { subscribed: false, updated_at: expect.any(Date) },
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to send push notification for event 6:", { statusCode: 410 });
    consoleErrorSpy.mockRestore();
  });

  it("sends push to every subscribed device for the recipient", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([
      {
        id: 12,
        endpoint: "https://fcm.googleapis.com/fcm/send/newer",
        p256dh: "p1",
        auth: "a1",
      },
      {
        id: 6,
        endpoint: "https://web.push.apple.com/older",
        p256dh: "p2",
        auth: "a2",
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({ last_seen_at: new Date(Date.now() - 10 * 60 * 1000) });
    process.env.VITE_VAPID_PUBLIC_KEY = "pub";
    process.env.VITE_VAPID_PRIVATE_KEY = "priv";

    const service = makeService(prisma);

    await (service as any).sendPush(1, { id: 7, event_type: "mention", entry_id: 42, payload: { excerpt: "hi" } } as any, 5, 99);

    expect(webpushMock.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpushMock.sendNotification.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ endpoint: "https://fcm.googleapis.com/fcm/send/newer" }),
      expect.objectContaining({ endpoint: "https://web.push.apple.com/older" }),
    ]);
    expect(prisma.notificationPushDelivery.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: expect.objectContaining({ state: "sent", sent_at: expect.any(Date) }),
    });
  });

  it("sends push payload with badge count", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{
      id: 1,
      endpoint: "endpoint",
      p256dh: "p",
      auth: "a",
    }]);
    prisma.user.findUnique.mockResolvedValue({ last_seen_at: new Date(Date.now() - 10 * 60 * 1000) });
    process.env.VITE_VAPID_PUBLIC_KEY = "pub";
    process.env.VITE_VAPID_PRIVATE_KEY = "priv";

    const service = makeService(prisma);

    await (service as any).sendPush(1, { id: 7, event_type: "mention", entry_id: 42, payload: { excerpt: "hi" } } as any, 5);

    const payload = webpushMock.sendNotification.mock.calls.at(-1)?.[1] as string;
    expect(payload).toContain("\"badgeCount\":5");
  });

  it("retries with legacy VAPID keys when current VAPID auth fails", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{
      id: 1,
      endpoint: "endpoint",
      p256dh: "p",
      auth: "a",
    }]);
    prisma.user.findUnique.mockResolvedValue({ last_seen_at: new Date(Date.now() - 10 * 60 * 1000) });
    webpushMock.sendNotification.mockRejectedValueOnce({ statusCode: 403 }).mockResolvedValueOnce({});
    process.env.VITE_VAPID_PUBLIC_KEY = "vite-pub";
    process.env.VITE_VAPID_PRIVATE_KEY = "vite-priv";
    process.env.VAPID_PUBLIC_KEY = "legacy-pub";
    process.env.VAPID_PRIVATE_KEY = "legacy-priv";
    process.env.BREVO_SENDER = "sender@example.com";

    const service = makeService(prisma);

    await (service as any).sendPush(1, { id: 8, event_type: "mention", entry_id: 42 } as any, 1);

    expect(webpushMock.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpushMock.sendNotification.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        timeout: 10_000,
        vapidDetails: expect.objectContaining({ publicKey: "vite-pub", privateKey: "vite-priv" }),
      }),
    );
    expect(webpushMock.sendNotification.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        timeout: 10_000,
        vapidDetails: expect.objectContaining({ publicKey: "legacy-pub", privateKey: "legacy-priv" }),
      }),
    );
  });

  it("records partial device failure without claiming complete delivery", async () => {
    const prisma=mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([1,2].map(id=>({id,endpoint:`https://example.test/${id}`,p256dh:"key",auth:"auth"})));
    prisma.user.findUnique.mockResolvedValue({last_seen_at:new Date(Date.now()-600_000)});
    process.env.VITE_VAPID_PUBLIC_KEY="pub";
    process.env.VITE_VAPID_PRIVATE_KEY="priv";
    process.env.VITE_VAPID_SUBJECT="mailto:test@example.com";
    webpushMock.sendNotification.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Socket timeout"));
    const service=makeService(prisma);
    await (service as any).sendPush(1,{id:8,event_type:"mention",entry_id:42},1,99);
    expect(webpushMock.sendNotification).toHaveBeenCalledTimes(2);
    expect(prisma.notificationPushDelivery.update).toHaveBeenCalledWith({where:{id:99},data:expect.objectContaining({state:"partial",sent_at:expect.any(Date),skip_reason:"partial_device_failure",last_error:JSON.stringify({sent:1,invalid:0,failed:0,uncertain:1,error:"Socket timeout"})})});
    expect(prisma.pushSubscription.update).not.toHaveBeenCalled();
  });

  it("records a socket timeout as uncertain without invalidating the subscription", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.findMany.mockResolvedValue([{ id: 1, endpoint: "https://example.test/push", p256dh: "key", auth: "auth" }]);
    prisma.user.findUnique.mockResolvedValue({ last_seen_at: new Date(Date.now() - 600_000) });
    process.env.VITE_VAPID_PUBLIC_KEY = "pub";
    process.env.VITE_VAPID_PRIVATE_KEY = "priv";
    process.env.VITE_VAPID_SUBJECT = "mailto:test@example.com";
    webpushMock.sendNotification.mockRejectedValueOnce(new Error("Socket timeout"));
    const service = makeService(prisma);
    await (service as any).sendPush(1, { id: 8, event_type: "mention", entry_id: 42 }, 1, 99);
    expect(webpushMock.sendNotification).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ timeout: 10_000 }));
    expect(prisma.pushSubscription.update).not.toHaveBeenCalled();
    expect(prisma.notificationPushDelivery.update).toHaveBeenCalledWith({ where: { id: 99 }, data: expect.objectContaining({ state: "uncertain", last_error: "Socket timeout" }) });
  });

  it("truncates long push bodies", async () => {
    const service = makeService(mockPrisma());
    const body = (service as any).pushBody({ payload: { excerpt: "x".repeat(200) } });
    expect(body.endsWith("...")).toBe(true);
    expect(body.length).toBe(120);
  });

  it("describes preserved chat messages as living on the board", () => {
    const service = makeService(mockPrisma());
    const body = (service as any).pushBody({
      event_type: "chat_message_saved_as_post",
      payload: { excerpt: "Keep this" },
    });

    expect(body).toBe('Now preserved on the board: "Keep this"');
  });

  it("uses event-specific push titles for chat and Activity lifecycle notices", async () => {
    const service = makeService(mockPrisma());

    await expect((service as any).pushTitle({
      event_type: "chat_message_created",
      actor: { username: "Mara" },
      room: { name: "Field Notes" },
    })).resolves.toBe("Mara messaged in Field Notes");
    await expect((service as any).pushTitle({
      event_type: "round_phase_changed",
      actor: { username: "Will" },
      room: { name: "Field Notes" },
      payload: { activity_name: "Sleeve Exchange", milestone: "round_completed" },
    })).resolves.toBe("Sleeve Exchange is complete");
  });

  it("gives circle invitations and knock suggestions actionable push copy", async () => {
    const service = makeService(mockPrisma());
    const invitation = {
      event_type: "circle_member_invited",
      actor: { username: "Ada" },
      room: { name: "Ember Room" },
      payload: {},
    };
    const suggestion = {
      event_type: "circle_knock_suggested",
      actor: { username: "Ada" },
      room: { name: "Field Notes" },
      payload: {},
    };

    await expect((service as any).pushTitle(invitation)).resolves.toBe("Ada invited you to Ember Room");
    expect((service as any).pushBody(invitation)).toBe("Tap to open the Circle and respond.");
    await expect((service as any).pushTitle(suggestion)).resolves.toBe("Ada suggested you knock on Field Notes");
    expect((service as any).pushBody(suggestion)).toBe("Tap to visit the Circle and knock.");
  });

  it("marks user active when last seen recently", async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({ last_seen_at: new Date() });
    const service = makeService(prisma);

    const result = await (service as any).userActivityStatus(1);

    expect(result.isActive).toBe(true);
  });
});
