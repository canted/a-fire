import { describe, expect, it, vi } from "vitest"
import { UnseenContentService } from "@server/api/v1/unseen/unseen-content.service"
import { ForbiddenException } from "@nestjs/common"
import { withTestDependencies } from "@tests/backend/helpers/service"

describe("UnseenContentService", () => {
  it.each(["draft", "published"])("rejects private project %s IDs before unread reads or writes", async (status) => {
    const service = withTestDependencies(new UnseenContentService(), {
      prisma: {
        entry: { findUnique: vi.fn().mockResolvedValue({
          id: 12, status, project_id: 8, creation_origin: "project_material", room_id: null, square_id: null, square: null,
        }) },
        reply: { findMany: vi.fn() },
        entryViewState: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      },
    })
    await expect(service.markPostSeen(9, 12, { postVisible: true, replyIds: [3] })).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.prisma.reply.findMany).not.toHaveBeenCalled()
    expect(service.prisma.entryViewState.findUnique).not.toHaveBeenCalled()
    expect(service.prisma.entryViewState.create).not.toHaveBeenCalled()
    expect(service.prisma.entryViewState.update).not.toHaveBeenCalled()
  })

  it("counts only unread notice cards, including chat, and bundles replies", async () => {
    const records = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    const prisma = { notificationInboxItem: { findMany: vi.fn().mockResolvedValue(records) } }
    const serialize = vi.fn().mockResolvedValue([
      { contentSeen: true, notificationEvent: { eventType: "post_created" } },
      { contentSeen: false, notificationEvent: { eventType: "chat_message_created" } },
      { contentSeen: false, notificationEvent: { eventType: "reply_created", entryId: "9", replyId: "1" } },
      { contentSeen: false, notificationEvent: { eventType: "reply_created", entryId: "9", replyId: "2" } },
    ])
    const service = new UnseenContentService()
    Object.assign(service, { prisma, inboxSerializer: { serialize } })
    await expect(service.countForUser(1)).resolves.toEqual({ total: 2, entries: 1, replies: 1 })
    expect(prisma.notificationInboxItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { user_id: 1, seen_at: null },
    }))
    expect(serialize).toHaveBeenCalledWith(records)
    serialize.mockResolvedValue([{ contentSeen: true, notificationEvent: { eventType: "chat_message_created" } }])
    await expect(service.countForUser(1)).resolves.toEqual({ total: 0, entries: 0, replies: 0 })
  })

  it("includes older unread notices across batches and deduplicates reply groups across them", async () => {
    const first = Array.from({ length: 250 }, (_, index) => ({ id: index + 1 }))
    const findMany = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([{ id: 251 }])
    const reply = { contentSeen: false, notificationEvent: { eventType: "reply_created", entryId: "9", replyId: "1" } }
    const serialize = vi.fn().mockResolvedValueOnce([reply]).mockResolvedValueOnce([
      reply, { contentSeen: false, notificationEvent: { eventType: "chat_message_created" } },
    ])
    const service = new UnseenContentService()
    Object.assign(service, { prisma: { notificationInboxItem: { findMany } }, inboxSerializer: { serialize } })
    await expect(service.countForUser(7)).resolves.toEqual({ total: 2, entries: 1, replies: 1 })
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { user_id: 7, seen_at: null, id: { gt: 250 } },
    }))
  })

  it("does not write a read position when nothing was exposed", async () => {
    const service = new UnseenContentService()
    const execute = vi.fn()
    Object.assign(service, { prisma: {
      entry: { findUnique: vi.fn().mockResolvedValue({ id: 9, room_id: 3, square: null }) },
      roomMembership: { findFirst: vi.fn().mockResolvedValue({ id: 1 }) },
      $executeRaw: execute,
    } })
    vi.spyOn(service, "countForUser").mockResolvedValue({ total: 0, entries: 0, replies: 0 })
    await service.markPostSeen(1, 9, {})
    expect(execute).not.toHaveBeenCalled()
  })

  it("marks all currently readable posts and replies as seen", async () => {
    const countForUser = vi.spyOn(UnseenContentService.prototype, "countForUser").mockResolvedValue({
      total: 0,
      entries: 0,
      replies: 0,
    })
    const prisma = {
      $executeRaw: vi.fn(async (_query: { strings: string[] }) => 3),
      notificationInboxItem: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    }
    const service = new UnseenContentService()
    ;(service as any).prisma = prisma

    await expect(service.markAllSeen(1)).resolves.toEqual({ total: 0, entries: 0, replies: 0 })

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    const query = prisma.$executeRaw.mock.calls[0][0] as { strings: string[] }
    expect(query.strings.join(" ")).toContain("latest_reply_cursors")
    expect(query.strings.join(" ")).toContain("room_memberships")
    expect(query.strings.join(" ")).toContain("cm.room_id = p.room_id")
    expect(query.strings.join(" ")).toContain("ON CONFLICT")
    expect(query.strings.join(" ")).toContain("UPDATE notification_inbox_items")
    expect(prisma.notificationInboxItem.updateMany).not.toHaveBeenCalled()
    expect(countForUser).toHaveBeenCalledWith(1)
    countForUser.mockRestore()
  })
})

it("counts unique unseen responses to accessible work owned by the viewer", async () => {
  const prisma = { entry: { findMany: vi.fn().mockResolvedValue([{ id: 9 }]) }, notificationInboxItem: { findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) } };
  const reply = { contentSeen: false, notificationEvent: { eventType: "reply_created", entryId: "9", replyId: "2" } };
  const serialize = vi.fn().mockResolvedValue([reply, reply, { ...reply, contentSeen: true, notificationEvent: { ...reply.notificationEvent, replyId: "3" } }]);
  const service = new UnseenContentService();
  Object.assign(service, { prisma, inboxSerializer: { serialize } });
  await expect(service.countResponsesToOwnPosts(8, [4])).resolves.toBe(1);
  expect(prisma.entry.findMany).not.toHaveBeenCalled();
  expect(prisma.notificationInboxItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 8, seen_at: null, notification_event: { room_id: { in: [4] }, entry: { user_id: 8, status: "published", room_id: { in: [4] } } } } }));
});

it("computes overall and requested Room counts from one authorized scan", async () => {
  const records = [
    { id: 1, notification_event: { room_id: 4 } },
    { id: 2, notification_event: { room_id: 4 } },
    { id: 3, notification_event: { room_id: 5 } },
    { id: 4, notification_event: { room_id: 6 } },
    { id: 5, notification_event: { room_id: 4 } },
    { id: 6, notification_event: { room_id: 4 } },
  ];
  const findMany = vi.fn().mockResolvedValue(records);
  const reply = { contentSeen: false, notificationEvent: { eventType: "reply_created", entryId: "9", replyId: "2" } };
  const serialize = vi.fn().mockResolvedValue([
    { ...reply, id: "1" }, { ...reply, id: "2" },
    { id: "3", contentSeen: false, notificationEvent: { eventType: "post_created" } },
    { id: "4", contentSeen: false, notificationEvent: { eventType: "post_created" } },
    { ...reply, id: "5", contentSeen: true },
    // Item 6 is withheld by canonical authorization.
  ]);
  const service = new UnseenContentService();
  Object.assign(service, { prisma: { notificationInboxItem: { findMany } }, inboxSerializer: { serialize } });
  const result = await service.countForUserWithRooms(8, [4, 5, 7]);
  expect(result.overall).toEqual({ total: 3, entries: 2, replies: 1 });
  expect(result.byRoom.get(4)).toEqual({ total: 1, entries: 0, replies: 1 });
  expect(result.byRoom.get(5)).toEqual({ total: 1, entries: 1, replies: 0 });
  expect(result.byRoom.get(7)).toEqual({ total: 0, entries: 0, replies: 0 });
  expect(result.byRoom.has(6)).toBe(false);
  expect(findMany).toHaveBeenCalledTimes(1);
  expect(serialize).toHaveBeenCalledTimes(1);
});
