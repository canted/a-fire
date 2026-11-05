import { trimTrailingBlankNodes } from "@server/realtime/document-content";
import { withTestDependencies } from "@tests/backend/helpers/service";
import { BadRequestException, ForbiddenException, GoneException, NotFoundException } from "@nestjs/common";
import { vi } from "vitest";
import { RepliesService } from "@server/api/v1/replies/replies.service";

const { captureReplyPublishedMock } = vi.hoisted(() => ({
  captureReplyPublishedMock: vi.fn(),
}));

vi.mock("@server/runtime/posthog", () => ({
  capturePosthogEvent: vi.fn(),
  captureReplyPublished: captureReplyPublishedMock,
}));

type PrismaMock = ReturnType<typeof mockPrisma>;

const mockPrisma = () => ({
  $queryRaw: vi.fn().mockResolvedValue([{ status: "draft", published_at: null }]),
  $transaction: vi.fn(function(this: unknown, callback: (database: unknown) => unknown) { return callback(this) }),
  entry: { findUnique: vi.fn() },
  page: { findFirst: vi.fn() },
  chatMessage: { findFirst: vi.fn(), findMany: vi.fn() },
  reply: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(1) },
  roomMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  document: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  activeStorageBlob: { findMany: vi.fn().mockResolvedValue([]) },
  activeStorageAttachment: { findFirst: vi.fn() },
  reflection: { findMany: vi.fn() },
  notificationEvent: { create: vi.fn() },
  notificationInboxItem: { updateMany: vi.fn() },
});

const mockBoss = () => ({ enqueue: vi.fn(), enqueueInTransaction: vi.fn() });
const mockRealtime = () => ({
  emit: vi.fn(),
  entryRoom: vi.fn((id: number) => `post:${id}`),
  boardRoom: vi.fn((id: number) => `board:${id}`),
  chatRoom: vi.fn((id: number) => `chat:${id}`),
});
const mockLinkPreviews = () => ({
  prepareAttachment: vi.fn().mockResolvedValue(null),
  applyPreparedAttachment: vi.fn().mockResolvedValue(null),
  upsertAttachment: vi.fn().mockResolvedValue(null),
  serializeAttachment: vi.fn().mockResolvedValue(null),
});

describe("RepliesService", () => {
  beforeEach(() => {
    captureReplyPublishedMock.mockClear();
  });

  const makeService = (prisma: PrismaMock) => {
    return withTestDependencies(new RepliesService(), {
      prisma,
      boss: mockBoss(),
      realtime: mockRealtime(),
      linkPreviews: mockLinkPreviews(),
      circleAccess: {
        canReadPublishedChatMessage: vi.fn().mockResolvedValue(true),
        requireAccessesInTransaction: vi.fn().mockResolvedValue({ kind: "member" }),
        require: vi.fn().mockResolvedValue({ kind: "member" }),
        resolve: vi.fn().mockResolvedValue({ kind: "member" }),
        requireMember: vi.fn().mockResolvedValue({ kind: "member" }),
      },
    });
  };

  it("omits Note summaries from visitor reply serialization", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue({ id: 2, user_id: 1, entry_id: 3, status: "published", created_at: new Date(), user: { id: 1, username: "Author" } });
    prisma.document.findFirst.mockResolvedValue(null);
    prisma.roomMembership.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);
    service.circleAccess.resolve.mockResolvedValue({ kind: "visitor" } as never);
    const payload = await (service as any).serializeReply(2, 4, 9);
    expect(payload.reflections).toEqual([]);
    expect(prisma.reflection.findMany).not.toHaveBeenCalled();
  });


  it("acknowledges only visible published replies for this recipient and chat parent", async () => {
    const prisma = mockPrisma();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 30, author_id: 4, pinned_at: new Date(), replies: [] });
    prisma.reply.findMany.mockResolvedValue([{ id: 51 }]);
    const service = makeService(prisma);
    await service.markChatRepliesSeen(7, 30, 2, [51, 999]);
    expect(prisma.reply.findMany).toHaveBeenCalledWith({
      where: { id: { in: [51, 999] }, chat_message_id: 30, status: "published" }, select: { id: true },
    });
    expect(prisma.notificationInboxItem.updateMany).toHaveBeenCalledWith({
      where: { user_id: 2, seen_at: null, notification_event: { room_id: 7, AND: [
        { payload: { path: ["chat_message_id"], equals: 30 } },
        { OR: [{ payload: { path: ["replyId"], equals: 51 } }] },
      ] } }, data: { seen_at: expect.any(Date) },
    });
    await expect(service.markChatRepliesSeen(7, 30, 2, [-1])).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(["create", "update", "publish"])("rejects circle %s feedback for private project material before side effects", async (operation) => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({
      id: 12, user_id: 2, project_id: 8, creation_origin: "project_material", status: "published",
      room_id: null, square_id: null, square: null,
    });
    prisma.reply.findUnique.mockResolvedValue({ id: 11, entry_id: 12, user_id: 7 });
    const service = makeService(prisma);
    const action = operation === "create"
      ? service.create(12, 7, { status: "published" })
      : operation === "update"
        ? service.update(12, 11, 7, { status: "published" })
        : service.publish(12, 11, 7);
    await expect(action).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reply.create).not.toHaveBeenCalled();
    expect(prisma.reply.update).not.toHaveBeenCalled();
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(service.boss.enqueue).not.toHaveBeenCalled();
    expect(service.realtime.emit).not.toHaveBeenCalled();
  });

  it.each(["update", "publish"])("rechecks circle access before %s, even for the reply author", async (operation) => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 12, status: "published", room_id: 4 });
    prisma.reply.findUnique.mockResolvedValue({ id: 11, entry_id: 12, user_id: 7 });
    const service = makeService(prisma);
    service.circleAccess.resolve.mockResolvedValue(null);
    await expect(operation === "update" ? service.update(12, 11, 7, { status: "published" }) : service.publish(12, 11, 7)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reply.update).not.toHaveBeenCalled();
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
  });

  it("rejects empty replies before publication", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 12, status: "published", room_id: 4 });
    const service = makeService(prisma);
    await expect(service.create(12, 7, { status: "published", content: { type: "doc", content: [] } })).rejects.toThrow("Add a title");
    expect(prisma.reply.create).not.toHaveBeenCalled();
  });

  it("accepts unclassified media replies on activity entries while keeping their circle parent", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 12, status: "published", room_id: 4, round_id: 9, reply_mode: "guided", requested_feedback_types: ["question"] });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 2 });
    prisma.reply.create.mockResolvedValue({ id: 11, user_id: 7 });
    prisma.reply.findUnique.mockResolvedValue({ id: 11, entry_id: 12, user_id: 7, created_at: new Date(), status: "published" });
    prisma.reflection.findMany.mockResolvedValue([]);
    const service = makeService(prisma);
    await service.create(12, 7, { status: "published", content: { type: "doc", content: [{ type: "audio", attrs: { audioAssetId: 3 } }] } });
    expect(prisma.reply.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entry_id: 12, feedback_type: null, status: "published" }) }));
  });

  it.each(["create", "update", "publish"] as const)("retires Chat reply %s without touching historical data", async (operation) => {
    const prisma = mockPrisma();
    const service = makeService(prisma);
    const action = operation === "create"
      ? service.createForChatMessage(7, 30, 2, { status: "published" })
      : operation === "update"
        ? service.updateForChatMessage(7, 30, 80, 2, { status: "published" })
        : service.publishForChatMessage(7, 30, 80, 2, {});
    await expect(action).rejects.toBeInstanceOf(GoneException);
    expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(prisma.reply.create).not.toHaveBeenCalled();
    expect(prisma.reply.update).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
    expect(service.boss.enqueue).not.toHaveBeenCalled();
    expect(service.realtime.emit).not.toHaveBeenCalled();
  });

  it.each(["list", "seen"])("denies historical reply %s when canonical Chat access expires", async (operation) => {
    const prisma = mockPrisma();
    const service = makeService(prisma);
    service.circleAccess.canReadPublishedChatMessage.mockResolvedValue(false);
    await expect(operation === "list"
      ? service.listForChatMessage(7, 30, 2)
      : service.markChatRepliesSeen(7, 30, 2, [80])).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.reply.findMany).not.toHaveBeenCalled();
    expect(prisma.notificationInboxItem.updateMany).not.toHaveBeenCalled();
  });

  it("keeps an existing chat reply thread available after its message is unpinned", async () => {
    const prisma = mockPrisma();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 30, author_id: 4, pinned_at: null, replies: [{ id: 80 }] });
    prisma.reply.findMany.mockResolvedValue([]);
    const service = makeService(prisma);

    await expect(service.listForChatMessage(7, 30, 2)).resolves.toEqual({ message_id: 30, replies: [], next_cursor: null });
  });

  it.each(["update", "publish"])("rejects %s for a reply without a parent post", async (operation) => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue({ id: 11, entry_id: null, user_id: 7 });
    const service = makeService(prisma);
    await expect(operation === "update" ? service.update(0, 11, 7, {}) : service.publish(0, 11, 7))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.entry.findUnique).not.toHaveBeenCalled();
    expect(prisma.reply.update).not.toHaveBeenCalled();
  });

  it("throws when post missing", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue(null);

    const service = makeService(prisma);
    await expect(service.create(1, 2, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects orphan published Entries before allocating a reply", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ id: 1, status: "published", room_id: null, square: null });
    const service = makeService(prisma);
    await expect(service.create(1, 2, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.reply.create).not.toHaveBeenCalled();
    expect(service.circleAccess.resolve).not.toHaveBeenCalled();
  });

  it("throws when Room access is missing", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ status: "published", id: 1, room_id: 3, square: null });
    prisma.roomMembership.findFirst.mockResolvedValue(null);

    const service = makeService(prisma);
    service.circleAccess.resolve.mockResolvedValue(null);
    await expect(service.create(1, 2, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("requires a feedback type for guided posts", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ status: "published",
      id: 1,
      room_id: 4,
      reply_mode: "guided",
      requested_feedback_types: ["impression", "question"],
      square: { room_id: 4 },
    });

    const service = makeService(prisma);
    await expect(service.create(1, 2, { status: "draft" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reply.create).not.toHaveBeenCalled();
  });

  it("stores selected feedback type for guided replies", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ status: "published",
      id: 1,
      room_id: 4,
      reply_mode: "guided",
      requested_feedback_types: ["impression", "idea"],
      square: { room_id: 4 },
    });
    prisma.reply.create.mockResolvedValue({ id: 2, user_id: 1 });
    prisma.reply.findUnique.mockResolvedValue({
      id: 2,
      entry_id: 1,
      user_id: 1,
      created_at: new Date(),
      status: "draft",
      feedback_type: "idea",
      user: { id: 1, username: "u" },
    });
    prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });
    prisma.reflection.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const result = await service.create(1, 1, { status: "draft", feedback_type: "idea" });

    expect(prisma.reply.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ feedback_type: "idea" }),
      }),
    );
    expect(result.feedback_type).toBe("idea");
  });

  it("update forbids non-owner", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue({ id: 2, entry_id: 1, user_id: 5, status: "draft" });

    const service = makeService(prisma);
    await expect(service.update(1, 2, 7, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("publish rejects missing reply", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue(null);

    const service = makeService(prisma);
    await expect(service.publish(1, 2, 3)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("trims trailing blank nodes", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
        { type: "paragraph", content: [{ type: "text", text: "" }] },
      ],
    };

    const trimmed = trimTrailingBlankNodes(content);
    expect(trimmed).toEqual({ ...content, content: [content.content[0]] });
  });

  it("creates published replies and emits", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ status: "published", id: 1, room_id: 4, square: { room_id: 4 } });
    prisma.reply.create.mockResolvedValue({ id: 2, user_id: 1 });
    prisma.reply.findUnique.mockResolvedValue({ id: 2, entry_id: 1, user_id: 1, created_at: new Date(), status: "published" });
    prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });
    prisma.reflection.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const result = await service.create(1, 1, { status: "published", content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });

    expect(result.id).toBe(2);
    expect(service.realtime.emit).toHaveBeenCalledWith(
      "EntryChannel",
      "post:1",
      expect.objectContaining({ type: "reply", entry_id: 1, reply_count: 1 }),
    );
    expect(captureReplyPublishedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, replyId: 2, entryId: 1 }),
    );
  });

  it("rejects browser-local media URLs before creating replies", async () => {
    const prisma = mockPrisma();
    prisma.entry.findUnique.mockResolvedValue({ status: "published", id: 1, room_id: 4, square: { room_id: 4 } });

    const service = makeService(prisma);
    await expect(
      service.create(1, 1, {
        status: "published",
        content: {
          type: "doc",
          content: [{ type: "image", attrs: { src: "blob:https://afire.app/local-reply-image" } }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reply.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it("updates replies to published and enqueues", async () => {
    const prisma = mockPrisma();
    let storedReply = { id: 2, entry_id: 1, user_id: 1, status: "draft", created_at: new Date(), updated_at: new Date(), user: { id: 1, username: "u" } };
    prisma.reply.findUnique.mockImplementation(async () => storedReply);
    prisma.reply.update.mockImplementation(async ({ data }) => { storedReply = { ...storedReply, ...data }; return storedReply; });
    prisma.entry.findUnique.mockResolvedValue({ status: "published", id: 1, room_id: 3, square: { room_id: 3 } });
    prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });
    prisma.reflection.findMany.mockResolvedValue([]);
    prisma.notificationEvent.create.mockResolvedValue({ id: 9 });

    const service = makeService(prisma);
    const result = await service.update(1, 2, 1, { status: "published", content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });

    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(prisma, "notifications.fanout", { eventId: 9 });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: { excerpt: "", replyId: 2 },
          target_path: "/app/entries/1#reply-2",
        }),
      }),
    );
    expect(result.id).toBe(2);
    expect(captureReplyPublishedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, replyId: 2, entryId: 1, roomId: 3 }),
    );
  });

  it("creates targeted mention notifications for published replies", async () => {
    const prisma = mockPrisma();
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Thanks" },
            { type: "mention", attrs: { id: "user:3", targetType: "user", targetId: "3", label: "Lin" } },
            { type: "mention", attrs: { id: "page:4", targetType: "note", targetId: "4", label: "Roadmap" } },
          ],
        },
      ],
    };
    prisma.entry.findUnique.mockResolvedValue({ status: "published", id: 1, room_id: 3, square_id: 4, square: { room_id: 3, board_id: 5 } });
    prisma.reply.create.mockResolvedValue({ id: 2, user_id: 1 });
    prisma.reply.findUnique.mockResolvedValue({ id: 2, entry_id: 1, user_id: 1, created_at: new Date(), status: "published", user: { id: 1, username: "u" } });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    prisma.roomMembership.findMany.mockResolvedValue([{ user_id: 3 }]);
    prisma.document.findFirst.mockResolvedValue({ content });
    prisma.reflection.findMany.mockResolvedValue([]);
    prisma.notificationEvent.create.mockResolvedValueOnce({ id: 9 }).mockResolvedValueOnce({ id: 10 });

    prisma.page.findFirst.mockResolvedValue({ room_id: 3 });
    const service = makeService(prisma);
    service.circleAccess.resolve.mockResolvedValue({ kind: "member", canViewNotes: true } as never);
    await service.create(1, 1, { status: "published", content });

    expect(prisma.notificationEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          event_type: "mention",
          actor_id: 1,
          room_id: 3,
          entry_id: 1,
          target_user_id: 3,
          payload: { excerpt: "Thanks" },
          target_path: "/app/entries/1#reply-2",
        }),
      }),
    );
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(prisma, "notifications.fanout", { eventId: 9 });
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(prisma, "notifications.fanout", { eventId: 10 });
  });

  it("publishes replies and emits", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique
      .mockResolvedValueOnce({ id: 2, entry_id: 1, user_id: 1 })
      .mockResolvedValueOnce({ id: 2, entry_id: 1, user_id: 1, created_at: new Date(), status: "published", user: { id: 1, username: "u" } });
    prisma.entry.findUnique.mockResolvedValue({ status: "published", id: 1, room_id: 3, square: { room_id: 3 } });
    prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });
    prisma.notificationEvent.create.mockResolvedValue({ id: 9 });
    prisma.reply.findUnique.mockResolvedValueOnce({ id: 2, entry_id: 1, user_id: 1, created_at: new Date(), status: "published", user: { id: 1, username: "u" } });
    prisma.reflection.findMany.mockResolvedValue([]);

    const service = makeService(prisma);
    const result = await service.publish(1, 2, 1);

    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(prisma, "notifications.fanout", { eventId: 9 });
    expect(service.realtime.emit).toHaveBeenCalled();
    expect(result.id).toBe(2);
  });

  it("serializes replies with reflections and display names", async () => {
    const prisma = mockPrisma();
    prisma.reply.findUnique.mockResolvedValue({ id: 2, user_id: 1, status: "published", created_at: new Date(), user: { id: 1, username: "u" } });
    prisma.document.findFirst.mockResolvedValue({ content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } });
    prisma.reflection.findMany.mockResolvedValue([
      { page_id: 3, user_id: 1, page: { title: "T", icon: "I" } },
      { page_id: 3, user_id: 2, page: { title: "T", icon: "I" } },
    ]);
    prisma.roomMembership.findFirst.mockResolvedValue({ user_id: 1, username_override: "alt", user: { username: "u" } });
    prisma.activeStorageAttachment.findFirst.mockResolvedValue({ blob_id: "reply-avatar" });

    const service = makeService(prisma);
    const result = await (service as any).serializeReply(2, 1, 1);

    expect(result.display_username).toBe("alt");
    expect(result.display_avatar_url).toBe("/api/v1/uploads/reply-avatar");
    expect(result.reflections?.[0].count).toBe(2);
  });
});
