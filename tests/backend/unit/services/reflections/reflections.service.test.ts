import { describe, expect, it, vi } from "vitest"
import { ReflectionsService } from "@server/api/v1/reflections/reflections.service"

function makePrisma(overrides: Partial<any>) {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ id: 1, room_id: 1 }]),
    page: { findUnique: async () => ({ id: 2, room_id: 1 }) },
    entry: { findUnique: async () => null },
    reply: { findUnique: async () => null },
    roomMembership: { findFirst: async () => null },
    reflection: { findFirst: async () => null, create: async () => null, deleteMany: async () => null, findMany: async () => [] },
    ...overrides,
  }
  prisma.$transaction.mockImplementation(callback => callback(prisma))
  return prisma
}

describe("ReflectionsService", () => {
  it("creates a reflection for a post", async () => {
    const prisma = makePrisma({
      entry: { findUnique: async () => ({ id: 3, status: "published", room_id: 1, square: { room_id: 1 } }) },
      roomMembership: { findFirst: async () => ({ id: 1 }) },
      reflection: {
        findFirst: async () => null,
        create: async () => ({ id: 10 }),
        findMany: async () => [
          { page_id: 2, page: { title: "Note", icon: "📌" }, user_id: 1 },
        ],
      },
    })

    const service = new ReflectionsService()
    ;(service as any).prisma = prisma
    ;(service as any).boss = { enqueueInTransaction: async () => null }
    ;(service as any).realtime = { emit: () => null, entryRoom: () => "" }
    const result = await service.createForPost(3, 1, 2)

    expect(result).toEqual([{ page_id: 2, page_title: "Note", page_icon: "📌", count: 1, mine: true }])
  })
})
