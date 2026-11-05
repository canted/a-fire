import { describe, expect, it } from "vitest"
import { PagesWriteService } from "@server/api/v1/pages/pages.write.service"

function makePrisma(overrides: Partial<any>) {
  return {
    roomMembership: { findFirst: async () => null },
    page: { create: async () => null, findUnique: async () => null, update: async () => null, delete: async () => null },
    document: { create: async () => null, findFirst: async () => null, update: async () => null, deleteMany: async () => null },
    room: { findFirst: async () => null },
    ...overrides,
  }
}

describe("PagesWriteService", () => {
  it("creates a page with default content", async () => {
    const prisma = makePrisma({
      roomMembership: { findFirst: async () => ({ id: 1 }) },
      page: {
        create: async () => ({ id: 9, title: "Docs", icon: null, room_id: 1 }),
        findUnique: async () => ({ id: 9, title: "Docs", icon: null, room_id: 1 }),
      },
      document: { create: async () => null, findFirst: async () => ({ content: { type: "doc", content: [] } }) },
    })

    const service = new PagesWriteService()
    ;(service as any).prisma = prisma
    ;(service as any).realtime = { emit: () => null, noteRoom: () => "" }
    const result = await service.createPage(1, { room_id: 1, title: "Docs" })

    expect(result.page.id).toBe(9)
    expect(result.page.content).toEqual({ type: "doc", content: [] })
  })
})
