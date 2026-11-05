import { describe, expect, it, vi } from "vitest"
import { RepliesService } from "@server/api/v1/replies/replies.service"

function makePrisma(overrides: Partial<any>) {
  return {
    $queryRaw: async () => [{ status: "draft", published_at: null }],
    $transaction: function(this: unknown, callback: (database: unknown) => unknown) { return callback(this) },
    entry: { findUnique: async () => null },
    reply: { create: async () => null, findUnique: async () => null, update: async () => null, count: async () => 1 },
    roomMembership: { findFirst: async () => null, findMany: async () => [] },
    document: { findFirst: async () => null, create: async () => null, update: async () => null },
    reflection: { findMany: async () => [] },
    notificationEvent: { create: async () => ({ id: 55 }) },
    ...overrides,
  }
}

function attachDependencies(service: RepliesService) {
  ;(service as any).circleAccess = { requireAccessesInTransaction: async () => ({ kind: "member" }), require: async () => ({ kind: "member" }), resolve: async () => ({ kind: "member" }) }
  ;(service as any).boss = { enqueue: async () => {}, enqueueInTransaction: async () => {} }
  ;(service as any).realtime = {
    emit: () => null,
    entryRoom: () => "",
    boardRoom: () => "",
    chatRoom: () => "",
  }
  ;(service as any).linkPreviews = {
    upsertAttachment: async () => null,
    prepareAttachment: async () => null,
    applyPreparedAttachment: async () => null,
    serializeAttachment: async () => null,
  }
}

describe("RepliesService", () => {
  it("enqueues notification when creating a published reply", async () => {
    const enqueue = vi.fn()
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ status: "published", id: 1, room_id: 1, square: { room_id: 1 } }) },
      roomMembership: { findFirst: async () => ({ id: 1 }) },
      reply: {
        create: async () => ({ id: 5, entry_id: 1, user_id: 2, created_at: new Date(), published_at: new Date() }),
        findUnique: async () => ({ id: 5, user_id: 2, created_at: new Date(), published_at: new Date() }),
        count: async () => 1,
      },
      document: { findFirst: async () => null, create: async () => null },
    })

    const service = new RepliesService()
    ;(service as any).prisma = {
      ...prisma,
      notificationEvent: { create: async () => ({ id: 55 }) },
    }
    attachDependencies(service)
    ;(service as any).boss = { enqueue, enqueueInTransaction: async (_database: unknown, name: string, payload: unknown) => enqueue(name, payload) }
    await service.create(1, 2, { status: "published", content: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/uploads/42" } }] } })

    expect(enqueue).toHaveBeenCalledWith("notifications.fanout", { eventId: 55 })
  })

  it("trims trailing blank nodes when publishing a reply", async () => {
    const updateDocument = vi.fn()
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ status: "published", id: 1, room_id: 1, square: { room_id: 1 } }) },
      reply: {
        findUnique: async () => ({ id: 7, entry_id: 1, user_id: 2, created_at: new Date(), published_at: null }),
        update: async () => ({ id: 7 }),
        count: async () => 1,
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 33,
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Thanks!" }] },
              { type: "paragraph", content: [] },
              { type: "paragraph", content: [] },
            ],
          },
        }),
        update: updateDocument,
      },
    })

    const service = new RepliesService()
    ;(service as any).prisma = prisma
    attachDependencies(service)
    await service.publish(1, 7, 2)

    const updateArgs = updateDocument.mock.calls[0][0]
    expect(updateArgs.data.content).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Thanks!" }] }],
    })
  })

  it("keeps trailing image nodes when publishing a reply", async () => {
    const updateDocument = vi.fn()
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ status: "published", id: 1, room_id: 1, square: { room_id: 1 } }) },
      reply: {
        findUnique: async () => ({ id: 8, entry_id: 1, user_id: 2, created_at: new Date(), published_at: null }),
        update: async () => ({ id: 8 }),
        count: async () => 1,
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 34,
          content: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Thanks!" }] },
              { type: "image", attrs: { src: "https://example.com/reply.png" } },
            ],
          },
        }),
        update: updateDocument,
      },
    })

    const service = new RepliesService()
    ;(service as any).prisma = prisma
    attachDependencies(service)
    await service.publish(1, 8, 2)

    const updateArgs = updateDocument.mock.calls[0][0]
    expect(updateArgs.data.content).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Thanks!" }] },
        { type: "image", attrs: { src: "https://example.com/reply.png" } },
      ],
    })
  })
})
