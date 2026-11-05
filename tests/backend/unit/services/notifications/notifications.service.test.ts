import { describe, expect, it, vi } from "vitest"
import { NotificationsService } from "@server/api/v1/notifications/notifications.service"

describe("NotificationsService", () => {
  it("advances past a full page of notices hidden by current authorization", async () => {
    const service = new NotificationsService()
    const findMany = vi.fn(async ({ take }: { take: number }) => Array.from({ length: take }, (_, index) => ({ id: 1000 - index })))
    Object.assign(service, {
      prisma: { userNoticeCursor: { findUnique: async () => null }, notificationInboxItem: { findMany } },
      inboxSerializer: { serialize: async () => [] },
    })
    const page = await service.inbox(7, 2)
    expect(page.items).toEqual([])
    const lastId = 1001 - findMany.mock.calls[0][0].take
    expect(page.nextCursor).toBe(String(lastId))
    findMany.mockResolvedValueOnce([])
    expect((await service.inbox(7, 2, lastId)).nextCursor).toBeNull()
    expect(findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: lastId }, skip: 1 })
  })

  it("marks only the recipient's selected notices read without advancing other notices", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const service = new NotificationsService()
    ;(service as any).prisma = { notificationInboxItem: { updateMany } }
    await service.markNoticesSeen(7, [11, 12])
    expect(updateMany).toHaveBeenCalledWith({
      where: { user_id: 7, id: { in: [11, 12] }, seen_at: null },
      data: { seen_at: expect.any(Date) },
    })
    await expect(service.markNoticesSeen(7, [-1])).rejects.toThrow()
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it("maps inbox items into REST payloads with a notice cursor snapshot", async () => {
    const prisma = {
      notificationInboxItem: {
        findMany: vi.fn(async () => [
          {
            id: 1,
            delivery_state: "delivered",
            delivered_at: new Date("2026-01-01T00:00:00Z"),
            notification_event: {
              id: 9,
              event_type: "post_created",
              actor_id: 2,
              room_id: 3,
              entry_id: 9,
              target_path: "/app/entries/9",
              payload: { excerpt: "hello" },
              created_at: new Date("2026-01-01T00:00:00Z"),
              actor: { username: "jordan" },
              room: { name: "Circle" },
            },
          },
        ]),
      },
      userNoticeCursor: {
        findUnique: async () => ({ seen_through_at: new Date("2025-12-31T00:00:00Z") }),
      },
    }
    const serializedItems = [
      {
        id: "1",
        deliveryState: "delivered",
        deliveredAt: "2026-01-01T00:00:00.000Z",
        notificationEvent: {
          id: "9",
          eventType: "post_created",
          actorUsername: "jordan",
          roomName: "Circle",
          targetPath: "/app/entries/9",
          entryId: "9",
          replyId: null,
          payload: { excerpt: "hello" },
          postContent: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ]
    const inboxSerializer = {
      serialize: vi.fn(async () => serializedItems),
    }

    const service = new NotificationsService()
    ;(service as any).prisma = prisma
    ;(service as any).inboxSerializer = inboxSerializer
    const result = await service.inbox(1, 10)

    expect(prisma.notificationInboxItem.findMany).toHaveBeenCalledWith({
      where: { user_id: 1 },
      include: { notification_event: { include: { actor: true, room: true } } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: 51,
    })
    expect(inboxSerializer.serialize).toHaveBeenCalledWith(expect.any(Array))
    expect(result).toEqual(
      expect.objectContaining({
        highlightAfter: "2025-12-31T00:00:00.000Z",
        items: serializedItems,
        nextCursor: null,
      }),
    )
  })

  it("returns a cursor when more notice inbox items are available", async () => {
    const records = [{ id: 6, notification_event: {} }, { id: 5, notification_event: {} }, { id: 4, notification_event: {} }]
    const prisma = {
      notificationInboxItem: {
        findMany: vi.fn(async () => records),
      },
      userNoticeCursor: {
        findUnique: async () => ({ seen_through_at: new Date("2025-12-31T00:00:00Z") }),
      },
    }
    const serializedItems = [
      { id: "6", contentSeen: true, notificationEvent: { eventType: "post_created" } },
      { id: "5", contentSeen: true, notificationEvent: { eventType: "post_created" } },
      { id: "4", contentSeen: true, notificationEvent: { eventType: "post_created" } },
    ]
    const inboxSerializer = {
      serialize: vi.fn(async () => serializedItems),
    }

    const service = new NotificationsService()
    ;(service as any).prisma = prisma
    ;(service as any).inboxSerializer = inboxSerializer

    const result = await service.inbox(1, 2, 7)

    expect(prisma.notificationInboxItem.findMany).toHaveBeenCalledWith({
      where: { user_id: 1 },
      include: { notification_event: { include: { actor: true, room: true } } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: 11,
      cursor: { id: 7 },
      skip: 1,
    })
    expect(inboxSerializer.serialize).toHaveBeenCalledWith(records)
    expect(result.nextCursor).toBe("5")
    expect(result.items).toEqual(serializedItems.slice(0, 2))
  })

  it("bundles reply notices for the same post using latest preview and oldest unseen target", async () => {
    const records = [
      { id: 10, notification_event: {} },
      { id: 9, notification_event: {} },
      { id: 8, notification_event: {} },
      { id: 7, notification_event: {} },
    ]
    const prisma = {
      notificationInboxItem: {
        findMany: vi.fn(async () => records),
      },
      userNoticeCursor: {
        findUnique: async () => ({ seen_through_at: new Date("2025-12-31T00:00:00Z") }),
      },
    }
    const serializedItems = [
      replyRecord("10", "SeenRecent", true, "10", "latest reply"),
      replyRecord("9", "UnseenRecent", false, "9", "newer unseen"),
      replyRecord("8", "UnseenOlder", false, "8", "older unseen"),
      {
        id: "7",
        deliveryState: "delivered",
        contentSeen: true,
        notificationEvent: {
          id: "7",
          eventType: "post_created",
          actorUsername: "Poster",
          entryId: "12",
          replyId: null,
          payload: { excerpt: "post" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ]
    const inboxSerializer = {
      serialize: vi.fn(async () => serializedItems),
    }

    const service = new NotificationsService()
    ;(service as any).prisma = prisma
    ;(service as any).inboxSerializer = inboxSerializer

    const result = await service.inbox(1, 10)

    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      id: "10",
      contentSeen: false,
      bundle: {
        key: "reply-post:4",
        itemIds: ["10", "9", "8"],
        replyCount: 3,
        actors: [
          { username: "UnseenRecent" },
          { username: "UnseenOlder" },
          { username: "SeenRecent" },
        ],
      },
      notificationEvent: {
        actorUsername: "UnseenRecent",
        replyId: "8",
        targetPath: "/app/entries/4#reply-8",
        payload: expect.objectContaining({
          replyCount: 3,
          bundledInboxItemIds: ["10", "9", "8"],
          excerpt: "latest reply",
        }),
        replyContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "latest reply" }] }] },
      },
    })
  })

  it("advances notice cursors monotonically", async () => {
    const update = vi.fn()
    const prisma = {
      userNoticeCursor: {
        findUnique: async () => ({ id: 1, seen_through_at: new Date("2026-01-01T00:00:00Z") }),
        update,
      },
    }

    const service = new NotificationsService()
    ;(service as any).prisma = prisma

    await service.markSeenThrough(1, "2026-01-01T00:01:00Z")

    expect(update).toHaveBeenCalledWith({
      where: { user_id: 1 },
      data: {
        seen_through_at: new Date("2026-01-01T00:01:00Z"),
        updated_at: expect.any(Date),
      },
    })
  })

  it("does not move notice cursors backward", async () => {
    const update = vi.fn()
    const prisma = {
      userNoticeCursor: {
        findUnique: async () => ({ id: 1, seen_through_at: new Date("2026-01-01T00:00:00Z") }),
        update,
      },
    }

    const service = new NotificationsService()
    ;(service as any).prisma = prisma

    await service.markSeenThrough(1, "2025-12-31T23:59:00Z")

    expect(update).not.toHaveBeenCalled()
  })

  it("retries notice cursor advancement when another request creates the cursor first", async () => {
    const create = vi.fn(async () => {
      throw { code: "P2002" }
    })
    const update = vi.fn()
    const prisma = {
      userNoticeCursor: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ seen_through_at: new Date("2026-01-01T00:00:00Z") }),
        create,
        update,
      },
    }

    const service = new NotificationsService()
    ;(service as any).prisma = prisma

    await service.markSeenThrough(1, "2026-01-01T00:01:00Z")

    expect(update).toHaveBeenCalledWith({
      where: { user_id: 1 },
      data: {
        seen_through_at: new Date("2026-01-01T00:01:00Z"),
        updated_at: expect.any(Date),
      },
    })
  })

  it("rejects notice cursor timestamps in the future", async () => {
    const prisma = {
      userNoticeCursor: {
        findUnique: async () => ({ id: 1, seen_through_at: new Date("2026-01-01T00:00:00Z") }),
      },
    }

    const service = new NotificationsService()
    ;(service as any).prisma = prisma
    const future = new Date(Date.now() + 60_000).toISOString()

    await expect(service.markSeenThrough(1, future)).rejects.toThrow("Invalid seenThroughAt")
  })
})

function replyRecord(id: string, actorUsername: string, contentSeen: boolean, replyId: string, excerpt: string) {
  return {
    id,
    deliveryState: "delivered",
    deliveredAt: "2026-01-01T00:00:00.000Z",
    contentSeen,
    notificationEvent: {
      id,
      eventType: "reply_created",
      actorUsername,
      actorAvatarUrl: `/avatar-${actorUsername}.png`,
      roomName: "Circle",
      roomAvatarUrl: "/circle.png",
      targetPath: `/app/entries/4#reply-${replyId}`,
      entryId: "4",
      replyId,
      postAuthorUsername: "Dave",
      payload: { excerpt },
      replyContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: excerpt }] }] },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  }
}
