import { describe, expect, it, vi } from "vitest"
import { BossWorkers } from "@server/queue/boss.workers"

describe("BossWorkers", () => {
  it("fans out notifications for published posts", async () => {
    const prisma = {
      notificationEvent: {
        findUnique: vi.fn(async () => ({
          id: 10,
          room_id: 5,
          actor_id: 2,
          entry_id: 1,
          event_type: "post_created",
          actor: { username: "alex" },
          room: { name: "A Fire" },
        })),
      },
      entry: {
        findUnique: vi.fn(async () => ({ user_id: 2 })),
      },
      roomMembership: {
        findMany: vi.fn(async () => [{ user_id: 2 }, { user_id: 3 }, { user_id: 4 }]),
        findFirst: vi.fn(async () => null),
      },
      reply: {
        findMany: vi.fn(async () => [{ user_id: 4 }]),
      },
    }

    const notificationPreferences = {
      resolveForUser: vi.fn(async () => ({
        notificationType: "all",
        deliveryMode: "immediate",
        pushEnabled: true,
      })),
      allowsEvent: vi.fn(() => true),
    }

    const notificationDelivery = {
      deliverImmediately: vi.fn(async () => null),
    }

    const worker = new BossWorkers()
    ;(worker as any).prisma = prisma
    ;(worker as any).notificationPreferences = notificationPreferences
    ;(worker as any).notificationDelivery = notificationDelivery
    await worker.handleNotificationFanout({ eventId: 10 })
    expect(notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ id: 10 }),
      expect.objectContaining({ notificationType: "all" }),
    )
  })

  it("fans out mention notifications to the target user only", async () => {
    const prisma = {
      notificationEvent: {
        findUnique: vi.fn(async () => ({
          id: 10,
          room_id: 5,
          actor_id: 2,
          target_user_id: 3,
          entry_id: 1,
          event_type: "mention",
          actor: { username: "alex" },
          room: { name: "A Fire" },
        })),
      },
      entry: {
        findUnique: vi.fn(async () => ({ user_id: 2 })),
      },
      roomMembership: {
        findMany: vi.fn(async () => [{ user_id: 2 }, { user_id: 3 }, { user_id: 4 }]),
        findFirst: vi.fn(async () => null),
      },
      reply: {
        findMany: vi.fn(async () => [{ user_id: 4 }]),
      },
    }

    const notificationPreferences = {
      resolveForUser: vi.fn(async () => ({
        notificationType: "posts",
        deliveryMode: "immediate",
        pushEnabled: true,
      })),
      allowsEvent: vi.fn(() => true),
    }

    const notificationDelivery = {
      deliverImmediately: vi.fn(async () => null),
    }

    const worker = new BossWorkers()
    ;(worker as any).prisma = prisma
    ;(worker as any).notificationPreferences = notificationPreferences
    ;(worker as any).notificationDelivery = notificationDelivery
    await worker.handleNotificationFanout({ eventId: 10 })

    expect(prisma.entry.findUnique).not.toHaveBeenCalled()
    expect(prisma.reply.findMany).not.toHaveBeenCalled()
    expect(notificationDelivery.deliverImmediately).toHaveBeenCalledTimes(1)
    expect(notificationDelivery.deliverImmediately).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ event_type: "mention" }),
      expect.objectContaining({ notificationType: "posts" }),
    )
  })

  it("applies reflections by merging source content into page document", async () => {
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 2, room_id: 5 }]),
      reflection: { findUnique: vi.fn(async () => ({ id: 1, page_id: 2, user_id: 7, reflectable_type: "Post", reflectable_id: 9 })) },
      page: { findUnique: vi.fn(async () => ({ id: 2, room_id: 5 })) },
      entry: {
        findUnique: vi.fn(async () => ({
          id: 9,
          status: "published",
          user_id: 4,
          room_id: 5,
          square: null,
          user: { username: "alex" },
        })),
      },
      roomMembership: { findFirst: vi.fn(async () => ({ id: 1 })) },
      document: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ content: { type: "doc", content: [{ type: "paragraph", content: [{ text: "Source", type: "text" }] }] } })
          .mockResolvedValueOnce({ id: 11, content: { type: "doc", content: [{ type: "paragraph", content: [{ text: "Existing", type: "text" }] }] } }),
        update: vi.fn(async () => null),
        create: vi.fn(async () => null),
      },
    }

    prisma.$transaction.mockImplementation(callback => callback(prisma))
    const worker = new BossWorkers()
    ;(worker as any).prisma = prisma
    await worker.handleReflectionApply({ reflectionId: 1 })

    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({
          content: {
            type: "doc",
            content: [
              expect.objectContaining({ type: "paragraph" }),
              expect.objectContaining({
                type: "contentSource",
                attrs: expect.objectContaining({
                  sourceType: "Post",
                  sourceId: 9,
                  sourcePath: "/app/entries/9",
                  authorName: "alex",
                }),
              }),
              expect.objectContaining({ type: "paragraph" }),
            ],
          },
        }),
      }),
    )
  })
})
