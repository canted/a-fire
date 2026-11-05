import { withTestDependencies } from "@tests/backend/helpers/service"
import { EntriesReadService } from "@server/api/v1/entries/entries.read.service"
import { EntryNotificationsService } from "@server/api/v1/entries/entry-notifications.service"
import { describe, expect, it, vi } from "vitest"
import { EntriesService } from "@server/api/v1/entries/entries.service"

function makePrisma<Overrides extends object>(overrides: Overrides) {
  const prisma = {
    $queryRaw: async () => [],
    notificationEvent: { create: async () => ({ id: 1 }) },
    entry: { findUnique: async () => null, findMany: async () => [] },
    roomMembership: { findFirst: async () => null, findMany: async () => [] },
    document: { findFirst: async () => null, findMany: async () => [] },
    entrySubject: { findUnique: async () => null, create: async () => null, update: async () => null },
    reflection: { findMany: async () => [] },
    reply: { findMany: async () => [], count: async () => 0 },
    chatMessage: { findUnique: async () => null },
    square: { findFirst: async () => null, update: async () => null },
    board: { findUnique: async () => null },
    room: { findUnique: async () => ({ reply_mode: "simple" }) },
    activeStorageAttachment: { findFirst: async () => null },
    ...overrides,
  }
  Object.assign(prisma.entry, { updateMany: async () => ({ count: 1 }) })
  return Object.assign(prisma, { $transaction: async function<T>(this: typeof prisma, callback: (tx: typeof prisma) => Promise<T>) { return callback(this) } })
}

function makeService<Prisma extends object>(prisma: Prisma) {
  const boss = { enqueue: async () => {}, enqueueInTransaction: async () => {} }
  const realtime = { emit: vi.fn(), boardRoom: () => "", chatRoom: (id: number) => `chat:${id}` }
  const boardsDetailService = { fetchBoard: async () => ({ squares: [] }) }
  const linkPreviews = {
    upsertAttachment: async () => null,
    serializeAttachment: async () => null,
    attachmentsForOwners: async () => new Map(),
  }
  const circleAccess = { requireAccessesInTransaction: vi.fn(async () => new Map([[1, { kind: "member", canWriteWall: true }]])), requireMemberInTransaction: async () => ({ kind: "member", canWriteWall: true }), require: async () => ({ kind: "member", canWriteWall: true }), resolve: async () => ({ kind: "member", canWriteWall: true }) }
  return withTestDependencies(new EntriesService(), {
    prisma, boss, realtime, boardsDetailService, linkPreviews, circleAccess,
    read: withTestDependencies(new EntriesReadService(), { prisma, linkPreviews, circleAccess }),
    notifications: withTestDependencies(new EntryNotificationsService(), { prisma, boss }),
  })
}

describe("PostsService", () => {
  it("returns post with default content when no document", async () => {
    const findAdjacentPost = vi
      .fn()
      .mockResolvedValueOnce({
        id: 9,
        status: "published", room_id: 1,
        created_at: new Date("2025-12-31T00:00:00Z"),
        published_at: new Date("2025-12-31T00:00:00Z"),
      })
      .mockResolvedValueOnce({
        id: 3,
        status: "published", room_id: 1,
        created_at: new Date("2026-01-02T00:00:00Z"),
        published_at: new Date("2026-01-02T00:00:00Z"),
      })
    const prisma = makePrisma({
      entry: {
        findFirst: findAdjacentPost,
        findUnique: async () => ({
          id: 1,
          status: "published",
          room_id: 1,
          created_at: new Date("2026-01-01T00:00:00Z"),
          updated_at: new Date("2026-01-01T00:00:00Z"),
          published_at: new Date("2026-01-01T00:00:00Z"),
          user_id: 2,
          content: null,
          user: { id: 2, username: "Jane" },

        }),
      },
      room: { findUnique: async () => ({ id: 1, name: "Studio Circle", reply_mode: "simple" }) },
      roomMembership: { findFirst: async () => ({ id: 1 }), findMany: async () => [] },
    })

    const service = makeService(prisma)
    const result = await service.fetchEntry(1, 2, "1")

    expect(result.entry.id).toBe(1)
    expect(result.entry).not.toHaveProperty("board")
    expect(result.entry.room).toEqual({ id: 1, name: "Studio Circle", avatar_url: null })
    expect(result.entry.previous_entry).toEqual({
      id: 9,
      created_at: "2025-12-31T00:00:00.000Z",
      published_at: "2025-12-31T00:00:00.000Z",
    })
    expect(result.entry.next_entry).toEqual({
      id: 3,
      created_at: "2026-01-02T00:00:00.000Z",
      published_at: "2026-01-02T00:00:00.000Z",
    })
    expect(findAdjacentPost).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 1 } }) }),
    )
    expect(findAdjacentPost).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 1 } }) }),
    )
    expect(result.entry.content).toEqual({ type: "doc", content: [{ type: "paragraph", content: [] }] })
  })

  it("publishes and enqueues a notification job", async () => {
    const enqueue = vi.fn()
    const prisma = makePrisma({
      entry: {
        findFirst: async () => ({ id: 80 }),
        findUnique: async () => ({ source_entry_id: 80, updated_at: new Date("2026-10-29T00:00:00Z"),
          id: 2,
          status: "draft",
          square_id: 1,
          room_id: 1,
          user_id: 9,
          published_at: null,
          content: null,
          square: { user_id: 9, room_id: 1, board_id: 3 },
        }),
        update: async () => ({ id: 2 }),
      },
      document: { findFirst: async () => ({ id: 22, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A new recording idea" }] }] } }), update: async () => null, create: async () => null },
    })

    const service = makeService({
      ...prisma,
      notificationEvent: { create: async () => ({ id: 99 }) },
    })
    service.notifications.boss.enqueueInTransaction = enqueue
    await service.publish(2, 9)

    expect(service.circleAccess.requireAccessesInTransaction).toHaveBeenCalledWith(expect.anything(), [1], 9, [1])

    expect(enqueue).toHaveBeenCalledWith(expect.anything(), "notifications.fanout", { eventId: 99 })
    expect(service.realtime.emit).toHaveBeenCalledWith("ChatChannel", "chat:1", { type: "invalidate", room_id: 1 })
  })

  it("trims trailing blank nodes when publishing a post", async () => {
    const updateDocument = vi.fn()
    const prisma = makePrisma({
      entry: {
        findFirst: async () => ({ id: 80 }),
        findUnique: async () => ({ source_entry_id: 80, updated_at: new Date("2026-10-29T00:00:00Z"),
          id: 10,
          status: "draft",
          square_id: 5,
          room_id: 1,
          user_id: 9,
          published_at: null,
          content: null,
          square: { user_id: 9, room_id: 1, board_id: null },
        }),
        update: async () => ({ id: 10 }),
      },
      square: { update: async () => null },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 22,
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
              { type: "paragraph", content: [] },
            ],
          },
        }),
        update: updateDocument,
      },
    })

    const service = makeService(prisma)
    await service.publish(10, 9)

    const updateArgs = updateDocument.mock.calls[0][0]
    expect(updateArgs.data.content).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    })
  })

  it("keeps trailing image nodes when publishing a post", async () => {
    const updateDocument = vi.fn()
    const prisma = makePrisma({
      entry: {
        findFirst: async () => ({ id: 80 }),
        findUnique: async () => ({ source_entry_id: 80, updated_at: new Date("2026-10-29T00:00:00Z"),
          id: 11,
          status: "draft",
          square_id: 5,
          room_id: 1,
          user_id: 9,
          published_at: null,
          content: null,
          square: { user_id: 9, room_id: 1, board_id: null },
        }),
        update: async () => ({ id: 11 }),
      },
      square: { update: async () => null },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 23,
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
              { type: "image", attrs: { src: "https://example.com/image.png" } },
            ],
          },
        }),
        update: updateDocument,
      },
    })

    const service = makeService(prisma)
    await service.publish(11, 9)

    const updateArgs = updateDocument.mock.calls[0][0]
    expect(updateArgs.data.content).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        { type: "image", attrs: { src: "https://example.com/image.png" } },
      ],
    })
  })

})
