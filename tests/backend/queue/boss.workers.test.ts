import { withTestDependencies } from "@tests/backend/helpers/service";
import { BossWorkers } from "@server/queue/boss.workers";
import { vi } from "vitest";

const makePrisma = () => {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    notificationPushDelivery: { findUnique: vi.fn(), update: vi.fn() },
  notificationEvent: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  reflection: { findUnique: vi.fn() },
  page: { findUnique: vi.fn() },
  document: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  entry: { findUnique: vi.fn() },
  reply: { findMany: vi.fn(), findUnique: vi.fn() },
  roomMembership: { findMany: vi.fn(), findFirst: vi.fn() },
  chatMessage: { findUnique: vi.fn(), deleteMany: vi.fn() },
};
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  prisma.$queryRaw.mockImplementation(async (query, id) => query.join("").includes("FROM notes")
    ? [{ room_id: (await prisma.page.findUnique({ where: { id } }))?.room_id }]
    : [{ id }]);
  return prisma;
};

const makeBoss = () => ({ work: vi.fn(), enqueueAfter: vi.fn(), hasOutstandingJob: vi.fn().mockResolvedValue(false), enqueueInTransaction: vi.fn() });
const makeNotificationDelivery = () => ({
  deliverImmediately: vi.fn(),
  handleDelayedPush: vi.fn(),
});
const makeNotificationPreferences = () => ({ resolveForUser: vi.fn(), allowsEvent: vi.fn() });
const makeImageVariants = () => ({ process: vi.fn() });
const makeAudioProcessor = () => ({ process: vi.fn() });
const makeVideoProcessor = () => ({ process: vi.fn() });
const makeActivitiesService = () => ({
  handleScheduledNotification: vi.fn(),
  scheduleActiveActivityNotifications: vi.fn(),
});

describe("BossWorkers", () => {
  const makeWorkers = () => {
    return withTestDependencies(new BossWorkers(), {
      boss: makeBoss(),
      prisma: makePrisma(),
      notificationDelivery: makeNotificationDelivery(),
      notificationPreferences: makeNotificationPreferences(),
      imageVariants: makeImageVariants(),
      audioProcessor: makeAudioProcessor(),
      videoProcessor: makeVideoProcessor(),
      activitiesService: makeActivitiesService(),
    });
  };

  it("skips orphaned reflections whose author no longer exists", async () => {
    const prisma = makePrisma();
    prisma.reflection.findUnique.mockResolvedValue({ id: 12, user_id: null });
    const workers = withTestDependencies(new BossWorkers(), { prisma });

    await workers.handleReflectionApply({ reflectionId: 12 });

    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it("registers workers on init", async () => {
    const workers = makeWorkers();
    await workers.onModuleInit();
    expect(workers.activitiesService.scheduleActiveActivityNotifications).toHaveBeenCalledOnce();
    expect(workers.boss.work).toHaveBeenCalledTimes(11);
    expect(workers.boss.work).toHaveBeenCalledWith("audio.spectrum", expect.any(Function));
    expect(workers.boss.work).toHaveBeenCalledWith("mail.invite", expect.any(Function));
    expect(workers.boss.work).toHaveBeenCalledWith("rounds.notification", expect.any(Function));
  });

  it.each(["roundId", "activityId"])("dispatches scheduled Round jobs using %s", async (idKey) => {
    const workers = makeWorkers();
    await workers.onModuleInit();
    const registration = workers.boss.work.mock.calls.find(([queue]) => queue === "rounds.notification");
    const handler = registration?.[1];
    const job = {
      [idKey]: 9,
      milestone: "feedback_started" as const,
      expectedAt: "2027-06-30T12:00:00.000Z",
    };

    await handler?.(job);

    expect(workers.activitiesService.handleScheduledNotification).toHaveBeenCalledWith({ ...job, roundId: 9 });
  });

  it("handles fanout with eventId", async () => {
    const workers = makeWorkers();
    const deliverSpy = vi.spyOn(workers as any, "deliverToCommunity").mockResolvedValue(undefined);
    workers.prisma.notificationEvent.findUnique.mockResolvedValue({ id: 1, room_id: 2 });

    await workers.handleNotificationFanout({ eventId: 1 });

    expect(deliverSpy).toHaveBeenCalled();
  });

  it("delivers a circle membership invitation before the target has joined", async () => {
    const workers = makeWorkers();
    const event = {
      id: 1,
      event_type: "circle_member_invited",
      room_id: 2,
      actor_id: 7,
      target_user_id: 8,
      entry_id: null,
      payload: {},
      actor: { username: "Will" },
      room: { name: "Side circle" },
    };
    workers.prisma.notificationEvent.findUnique.mockResolvedValue(event);
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 7 }]);
    workers.notificationPreferences.resolveForUser.mockResolvedValue({
      notificationType: "all",
      deliveryMode: "immediate",
      pushEnabled: true,
    });
    workers.notificationPreferences.allowsEvent.mockReturnValue(true);

    await workers.handleNotificationFanout({ eventId: 1 });

    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      8,
      event,
      expect.objectContaining({ notificationType: "all" }),
    );
  });

  it("delivers a knock suggestion before the target has joined", async () => {
    const workers = makeWorkers();
    const event = {
      id: 2,
      event_type: "circle_knock_suggested",
      room_id: 2,
      actor_id: 7,
      target_user_id: 8,
      entry_id: null,
      payload: {},
      actor: { username: "Will" },
      room: { name: "Closed room" },
    };
    workers.prisma.notificationEvent.findUnique.mockResolvedValue(event);
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 7 }]);
    workers.notificationPreferences.resolveForUser.mockResolvedValue({
      notificationType: "all",
      deliveryMode: "immediate",
      pushEnabled: true,
    });
    workers.notificationPreferences.allowsEvent.mockReturnValue(true);

    await workers.handleNotificationFanout({ eventId: 2 });

    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      8,
      event,
      expect.objectContaining({ notificationType: "all" }),
    );
  });

  it("handles fanout with postId", async () => {
    const workers = makeWorkers();
    const postSpy = vi.spyOn(workers as any, "handlePostNotification").mockResolvedValue(undefined);

    await workers.handleNotificationFanout({ entryId: 9 });

    expect(postSpy).toHaveBeenCalledWith(9);
  });

  it("handles delayed notification pushes", async () => {
    const workers = makeWorkers();

    await workers.handleDelayedNotificationPush({ deliveryId: 7 });

    expect(workers.notificationDelivery.handleDelayedPush).toHaveBeenCalledWith(7);
  });

  it("drains legacy chat expiration jobs without deleting durable messages", async () => {
    const workers = makeWorkers();
    workers.prisma.chatMessage.findUnique.mockResolvedValue({
      id: 7,
      room_id: 2,
      expires_at: new Date("2020-01-01T00:00:00Z"),
      note_copies: [{ note_id: 12 }],
    });
    workers.prisma.document.findMany.mockResolvedValue([
      {
        id: 90,
        content: {
          type: "doc",
          content: [
            {
              type: "blockquote",
              attrs: { sourceMessageId: 7, sourceHref: "/app/rooms/2/chat#chat-7" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Mira said:" }] },
                { type: "paragraph", content: [{ type: "text", text: "Durable quote" }] },
                { type: "paragraph", content: [{ type: "text", text: "Saved from Chat by Alex" }] },
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Source: " },
                    { type: "text", text: "View in Chat", marks: [{ type: "link", attrs: { href: "/app/rooms/2/chat#chat-7" } }] },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);

    await workers.handleChatExpire({ messageId: 7 });

    expect(workers.prisma.document.update).not.toHaveBeenCalled();
    expect(workers.prisma.chatMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("handles fanout with replyId", async () => {
    const workers = makeWorkers();
    const replySpy = vi.spyOn(workers as any, "handleReplyNotification").mockResolvedValue(undefined);

    await workers.handleNotificationFanout({ replyId: 4 });

    expect(replySpy).toHaveBeenCalledWith(4);
  });

  it("logs and rethrows fanout errors", async () => {
    const workers = makeWorkers();
    const postSpy = vi.spyOn(workers as any, "handlePostNotification").mockRejectedValue(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(workers.handleNotificationFanout({ entryId: 9 })).rejects.toThrow("boom");

    expect(postSpy).toHaveBeenCalledWith(9);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("handles reflection apply by updating page doc", async () => {
    const workers = makeWorkers();
    workers.prisma.reflection.findUnique.mockResolvedValue({ id: 1, page_id: 2, user_id: 7, reflectable_type: "Post", reflectable_id: 3 });
    workers.prisma.page.findUnique.mockResolvedValue({ id: 2, room_id: 8 });
    workers.prisma.entry.findUnique.mockResolvedValue({
      id: 3,
      status: "published",
      user_id: 7,
      room_id: 8,
      square: null,
      user: { username: "Alice" },
    });
    workers.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    workers.prisma.document.findFirst
      .mockResolvedValueOnce({ content: { type: "doc", content: [{ type: "paragraph" }] } })
      .mockResolvedValueOnce({ id: 9, content: { type: "doc", content: [] } });

    await workers.handleReflectionApply({ reflectionId: 1 });

    expect(workers.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: {
            type: "doc",
            content: [
              { type: "paragraph" },
              {
                type: "contentSource",
                attrs: {
                  sourceType: "Post",
                  sourceId: 3,
                  sourcePath: "/app/entries/3",
                  authorName: "Alice",
                },
              },
            ],
          },
        }),
      }),
    );
  });

  it("creates page doc when missing", async () => {
    const workers = makeWorkers();
    workers.prisma.reflection.findUnique.mockResolvedValue({ id: 1, page_id: 2, user_id: 7, reflectable_type: "Post", reflectable_id: 3 });
    workers.prisma.page.findUnique.mockResolvedValue({ id: 2, room_id: 8 });
    workers.prisma.entry.findUnique.mockResolvedValue({
      id: 3,
      status: "published",
      user_id: 7,
      room_id: 8,
      square: null,
      user: { username: "Alice" },
    });
    workers.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    workers.prisma.document.findFirst
      .mockResolvedValueOnce({ content: { type: "doc", content: [{ type: "paragraph" }] } })
      .mockResolvedValueOnce(null);

    await workers.handleReflectionApply({ reflectionId: 1 });

    expect(workers.prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: {
            type: "doc",
            content: [
              { type: "paragraph" },
              {
                type: "contentSource",
                attrs: {
                  sourceType: "Post",
                  sourceId: 3,
                  sourcePath: "/app/entries/3",
                  authorName: "Alice",
                },
              },
              { type: "paragraph" },
            ],
          },
        }),
      }),
    );
  });

  it("stores anchored source paths for reply reflections", async () => {
    const workers = makeWorkers();
    workers.prisma.reflection.findUnique.mockResolvedValue({ id: 1, page_id: 2, user_id: 7, reflectable_type: "Reply", reflectable_id: 7 });
    workers.prisma.page.findUnique.mockResolvedValue({ id: 2, room_id: 8 });
    workers.prisma.entry.findUnique.mockResolvedValue({ id: 3, status: "published", room_id: 8, square: null });
    workers.prisma.reply.findUnique.mockResolvedValue({
      id: 7,
      status: "published",
      entry_id: 3,
      user_id: 7,
      user: { username: "Alice" },
      entry: { room_id: 8, square: null },
    });
    workers.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    workers.prisma.document.findFirst
      .mockResolvedValueOnce({ content: { type: "doc", content: [{ type: "paragraph" }] } })
      .mockResolvedValueOnce({ id: 9, content: { type: "doc", content: [] } });

    await workers.handleReflectionApply({ reflectionId: 1 });

    expect(workers.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: {
            type: "doc",
            content: [
              { type: "paragraph" },
              {
                type: "contentSource",
                attrs: {
                  sourceType: "Reply",
                  sourceId: 7,
                  sourcePath: "/app/entries/3#reply-7",
                  authorName: "Alice",
                },
              },
            ],
          },
        }),
      }),
    );
  });

  it("skips reflection apply when the page already points at the same source", async () => {
    const workers = makeWorkers();
    workers.prisma.reflection.findUnique.mockResolvedValue({ id: 1, page_id: 2, user_id: 7, reflectable_type: "Post", reflectable_id: 3 });
    workers.prisma.page.findUnique.mockResolvedValue({ id: 2, room_id: 8 });
    workers.prisma.entry.findUnique.mockResolvedValue({
      id: 3,
      status: "published",
      user_id: 7,
      room_id: 8,
      square: null,
      user: { username: "Alice" },
    });
    workers.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    workers.prisma.document.findFirst
      .mockResolvedValueOnce({ content: { type: "doc", content: [{ type: "paragraph" }] } })
      .mockResolvedValueOnce({
        id: 9,
        content: {
          type: "doc",
          content: [
            {
              type: "contentSource",
              attrs: { sourceType: "Post", sourceId: 3, sourcePath: "/app/entries/3", authorName: "Alice" },
            },
            { type: "paragraph", content: [{ type: "text", text: "Existing" }] },
          ],
        },
      });

    await workers.handleReflectionApply({ reflectionId: 1 });

    expect(workers.prisma.document.update).not.toHaveBeenCalled();
    expect(workers.prisma.document.create).not.toHaveBeenCalled();
  });

  it("uses community membership username overrides for post source blocks", async () => {
    const workers = makeWorkers();
    workers.prisma.reflection.findUnique.mockResolvedValue({ id: 1, page_id: 2, user_id: 7, reflectable_type: "Post", reflectable_id: 3 });
    workers.prisma.page.findUnique.mockResolvedValue({ id: 2, room_id: 8 });
    workers.prisma.entry.findUnique.mockResolvedValue({
      id: 3,
      status: "published",
      user_id: 7,
      room_id: 8,
      square: null,
      user: { username: "Alice" },
    });
    workers.prisma.roomMembership.findFirst.mockResolvedValue({ username_override: "TrailGuide" });
    workers.prisma.document.findFirst
      .mockResolvedValueOnce({ content: { type: "doc", content: [{ type: "paragraph" }] } })
      .mockResolvedValueOnce({ id: 9, content: { type: "doc", content: [] } });

    await workers.handleReflectionApply({ reflectionId: 1 });

    expect(workers.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "contentSource",
                attrs: expect.objectContaining({ authorName: "TrailGuide" }),
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("uses community membership username overrides for reply source blocks", async () => {
    const workers = makeWorkers();
    workers.prisma.reflection.findUnique.mockResolvedValue({ id: 1, page_id: 2, user_id: 7, reflectable_type: "Reply", reflectable_id: 7 });
    workers.prisma.page.findUnique.mockResolvedValue({ id: 2, room_id: 8 });
    workers.prisma.entry.findUnique.mockResolvedValue({ id: 3, status: "published", room_id: 8, square: null });
    workers.prisma.reply.findUnique.mockResolvedValue({
      id: 7,
      status: "published",
      entry_id: 3,
      user_id: 7,
      user: { username: "Alice" },
      entry: { room_id: 8, square: null },
    });
    workers.prisma.roomMembership.findFirst.mockResolvedValue({ username_override: "TrailGuide" });
    workers.prisma.document.findFirst
      .mockResolvedValueOnce({ content: { type: "doc", content: [{ type: "paragraph" }] } })
      .mockResolvedValueOnce({ id: 9, content: { type: "doc", content: [] } });

    await workers.handleReflectionApply({ reflectionId: 1 });

    expect(workers.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "contentSource",
                attrs: expect.objectContaining({
                  sourcePath: "/app/entries/3#reply-7",
                  authorName: "TrailGuide",
                }),
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("handles upload variants", async () => {
    const workers = makeWorkers();
    await workers.handleUploadVariant({ blobId: 1, variationDigest: "w600" });
    expect(workers.imageVariants.process).toHaveBeenCalled();
  });

  it("handles audio uploads", async () => {
    const workers = makeWorkers();
    await (workers as any).handleUploadAudio({ audioAssetId: 41 });
    expect(workers.audioProcessor.process).toHaveBeenCalledWith({ audioAssetId: 41 });
  });

  it("handles video uploads", async () => {
    const workers = makeWorkers();
    await (workers as any).handleUploadVideo({ videoAssetId: 42 });
    expect(workers.videoProcessor.process).toHaveBeenCalledWith({ videoAssetId: 42 });
  });

  it("builds post notification excerpts from document", async () => {
    const workers = makeWorkers();
    workers.prisma.entry.findUnique.mockResolvedValue({
      id: 3,
      content: "fallback",
      status: "published",
      user_id: 9,
      room_id: 1,
    });
    workers.prisma.document.findFirst.mockResolvedValue({
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
          { type: "paragraph", content: [{ type: "text", text: "world" }] },
        ],
      },
    });
    workers.prisma.notificationEvent.create.mockResolvedValue({ id: 1, room_id: 1, event_type: "post_created" });
    const deliverSpy = vi.spyOn(workers as any, "deliverToCommunity").mockResolvedValue(undefined);

    await (workers as any).handlePostNotification(3);

    expect(workers.prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: { excerpt: "Hello world" },
          target_path: "/app/entries/3",
        }),
      }),
    );
    expect(deliverSpy).toHaveBeenCalled();
  });

  it.each([
    { room_id: 1, expectedEvents: 1 },
    { room_id: null, expectedEvents: 0 },
  ])("uses canonical Room scope and empty Document authority for queued post events: %j", async ({ room_id, expectedEvents }) => {
    const workers = makeWorkers();
    workers.prisma.entry.findUnique.mockResolvedValue({ id: 3, user_id: 9, status: "published", room_id: room_id, content: "Obsolete body" });
    workers.prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [] } });
    workers.prisma.notificationEvent.create.mockResolvedValue({ id: 1 });
    const deliver = vi.spyOn(workers as any, "deliverToCommunity").mockResolvedValue(undefined);
    await workers.handleNotificationFanout({ entryId: 3 });
    expect(workers.prisma.notificationEvent.create).toHaveBeenCalledTimes(expectedEvents);
    expect(deliver).toHaveBeenCalledTimes(expectedEvents);
    if (expectedEvents) expect(workers.prisma.notificationEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ room_id: 1, payload: { excerpt: "" }, entry_id: 3 }),
    }));
  });

  it("delivers to reply and post participants", async () => {
    const workers = makeWorkers();
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 2 }, { user_id: 3 }]);
    workers.prisma.reply.findMany.mockResolvedValue([{ user_id: 4 }, { user_id: 5 }]);
    workers.prisma.entry.findUnique.mockResolvedValue({ user_id: 6 });
    workers.notificationPreferences.resolveForUser.mockResolvedValue({
      notificationType: "all",
      deliveryMode: "immediate",
      pushEnabled: true,
    });
    workers.notificationPreferences.allowsEvent.mockReturnValue(true);

    await (workers as any).deliverToCommunity({
      id: 1,
      room_id: 2,
      actor_id: 2,
      entry_id: 9,
      event_type: "post_created",
    });

    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      3,
      expect.anything(),
      expect.anything(),
    );
    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      4,
      expect.anything(),
      expect.anything(),
    );
    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      5,
      expect.anything(),
      expect.anything(),
    );
    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      6,
      expect.anything(),
      expect.anything(),
    );
  });

  it("delivers mention events only to the target user", async () => {
    const workers = makeWorkers();
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 2 }, { user_id: 3 }]);
    workers.notificationPreferences.resolveForUser.mockResolvedValue({
      notificationType: "posts",
      deliveryMode: "immediate",
      pushEnabled: true,
    });
    workers.notificationPreferences.allowsEvent.mockReturnValue(true);

    await (workers as any).deliverToCommunity({
      id: 1,
      room_id: 2,
      actor_id: 2,
      target_user_id: 3,
      entry_id: 9,
      event_type: "mention",
    });

    expect(workers.prisma.reply.findMany).not.toHaveBeenCalled();
    expect(workers.prisma.entry.findUnique).not.toHaveBeenCalled();
    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledTimes(1);
    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      3,
      expect.anything(),
      expect.anything(),
    );
  });

  it.each(["introduction_created", "round_reminder"])("keeps %s addressed only to its explicit target even with Entry context", async eventType => {
    const workers = makeWorkers();
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 2 }, { user_id: 3 }]);
    workers.prisma.reply.findMany.mockResolvedValue([{ user_id: 4 }]);
    workers.prisma.entry.findUnique.mockResolvedValue({ user_id: 5 });
    workers.notificationPreferences.resolveForUser.mockResolvedValue({ notificationType: "all", deliveryMode: "immediate", pushEnabled: false });
    workers.notificationPreferences.allowsEvent.mockReturnValue(true);
    await (workers as any).deliverToCommunity({ id: 1, room_id: 2, actor_id: 2, target_user_id: 3, entry_id: 9, event_type: eventType });
    expect(workers.notificationDelivery.deliverImmediately.mock.calls.map(call => call[0])).toEqual([3]);
    expect(workers.prisma.reply.findMany).not.toHaveBeenCalled();
    expect(workers.prisma.entry.findUnique).not.toHaveBeenCalled();
  });

  it("does not broadcast a direct notification when its target is no longer a member", async () => {
    const workers = makeWorkers();
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 2 }, { user_id: 3 }]);

    workers.prisma.reply.findMany.mockResolvedValue([{ user_id: 5 }]);
    workers.prisma.entry.findUnique.mockResolvedValue({ user_id: 6 });
    workers.notificationPreferences.resolveForUser.mockResolvedValue({ notificationType: "all", deliveryMode: "immediate", pushEnabled: false });
    workers.notificationPreferences.allowsEvent.mockReturnValue(true);

    await (workers as any).deliverToCommunity({
      id: 1,
      room_id: 2,
      actor_id: 2,
      target_user_id: 4,
      entry_id: 9,
      event_type: "round_reminder",
    });

    expect(workers.notificationPreferences.resolveForUser).not.toHaveBeenCalled();
    expect(workers.notificationDelivery.deliverImmediately).not.toHaveBeenCalled();
  });

  it("delivers automated Activity notifications when the host is also the direct target", async () => {
    const workers = makeWorkers();
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 2 }]);
    workers.notificationPreferences.resolveForUser.mockResolvedValue({
      notificationType: "all",
      deliveryMode: "immediate",
      pushEnabled: true,
    });
    workers.notificationPreferences.allowsEvent.mockReturnValue(true);

    await (workers as any).deliverToCommunity({
      id: 1,
      room_id: 2,
      actor_id: 2,
      target_user_id: 2,
      event_type: "round_phase_changed",
      payload: { include_actor: true },
    });

    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      2,
      expect.anything(),
      expect.anything(),
    );
  });

  it("rethrows when post lookup fails in fanout", async () => {
    const workers = makeWorkers();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 1 }]);
    workers.prisma.reply.findMany.mockRejectedValue(new Error("db"));

    await expect(
      (workers as any).deliverToCommunity({
        id: 1,
        room_id: 2,
        actor_id: null,
        entry_id: 9,
        event_type: "post_created",
      }),
    ).rejects.toThrow("db");

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("delivers notifications based on preferences", async () => {
    const workers = makeWorkers();
    workers.prisma.roomMembership.findMany.mockResolvedValue([
      { user_id: 1 },
      { user_id: 2 },
    ]);
    workers.notificationPreferences.resolveForUser.mockResolvedValue({
      notificationType: "all",
      deliveryMode: "immediate",
      pushEnabled: true,
    });
    workers.notificationPreferences.allowsEvent.mockReturnValue(true);
    const dueAt = new Date("2026-01-01T00:00:00.000Z");
    workers.notificationDelivery.deliverImmediately.mockResolvedValue({
      inboxItem: { id: 5 },
      scheduledPushDelivery: { deliveryId: 9, dueAt },
    });
    workers.boss.enqueueInTransaction.mockResolvedValue("job-1");
    workers.prisma.notificationPushDelivery.findUnique.mockResolvedValue({ id: 9, state: "scheduled", scheduled_job_id: null, due_at: dueAt });

    await (workers as any).deliverToCommunity({ id: 1, room_id: 2, actor_id: 1, event_type: "post_created" });

    expect(workers.notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      2,
      expect.anything(),
      expect.anything(),
    );
    expect(workers.boss.enqueueInTransaction).toHaveBeenCalledWith(workers.prisma, "notifications.push.delayed", { deliveryId: 9 }, { startAfter: dueAt });
    expect(workers.prisma.notificationPushDelivery.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { scheduled_job_id: "job-1", updated_at: expect.any(Date) } });
  });

  it("skips delivery when preferences disallow", async () => {
    const workers = makeWorkers();
    workers.prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 2 }]);
    workers.notificationPreferences.resolveForUser.mockResolvedValue({
      notificationType: "none",
      deliveryMode: "immediate",
      pushEnabled: true,
    });
    workers.notificationPreferences.allowsEvent.mockReturnValue(false);

    await (workers as any).deliverToCommunity({ id: 1, room_id: 2, actor_id: 1, event_type: "post_created" });

    expect(workers.notificationDelivery.deliverImmediately).not.toHaveBeenCalled();
  });

  it("handles post notification when no community", async () => {
    const workers = makeWorkers();
    workers.prisma.entry.findUnique.mockResolvedValue({ id: 1, square: { room_id: null }, user: { id: 1 } });

    await (workers as any).handlePostNotification(1);

    expect(workers.prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("handles reply notification when missing community", async () => {
    const workers = makeWorkers();
    workers.prisma.reply.findUnique.mockResolvedValue({ id: 1, user_id: 1, entry: { square: { room_id: null } } });

    await (workers as any).handleReplyNotification(1);

    expect(workers.prisma.notificationEvent.create).not.toHaveBeenCalled();
  });
});


it("retries orphan purge failures without treating them as successful cleanup", async () => {
  const imageStorage = { purgeOrphan: vi.fn().mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValue(undefined) };
  const worker = withTestDependencies(new BossWorkers(), { imageStorage });
  await expect(worker.handleOrphanPurge({ blobId: 5 })).rejects.toThrow("Storage unavailable");
  await worker.handleOrphanPurge({ blobId: 5 });
  await expect(worker.handleOrphanPurge({ blobId: -1 })).rejects.toThrow("Invalid orphan blob ID");
  expect(imageStorage.purgeOrphan).toHaveBeenCalledTimes(2);
});
