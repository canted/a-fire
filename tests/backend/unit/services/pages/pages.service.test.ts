import { describe, expect, it } from "vitest"
import { PagesService } from "@server/api/v1/pages/pages.service"
import { NotFoundException } from "@nestjs/common"

function makePrisma(overrides: Partial<any>) {
  return {
    page: { findUnique: async () => null },
    roomMembership: { findFirst: async () => null },
    document: { findFirst: async () => null },
    room: { findFirst: async () => null },
    ...overrides,
  }
}

describe("PagesService", () => {
  it("returns page payload with can_manage when user owns community", async () => {
    const prisma = makePrisma({
      page: { findUnique: async () => ({ id: 7, title: "Docs", icon: "📄", room_id: 2, parent_id: 5 }) },
      roomMembership: { findFirst: async () => ({ id: 1 }) },
      document: { findFirst: async () => ({ content: { type: "doc", content: [] }, version: 2 }) },
      room: { findFirst: async () => ({ id: 2 }) },
    })

    const service = new PagesService()
    ;(service as any).prisma = prisma
    const result = await service.fetchPage(7, 1)

    expect(result.id).toBe(7)
    expect(result.can_manage).toBe(true)
    expect(result.version).toBe(2)
    expect(result.parent_id).toBe(5)
  })

  it("treats soft-deleted pages as missing", async () => {
    const prisma = makePrisma({
      page: { findUnique: async () => ({ id: 7, title: "Docs", icon: null, room_id: 2, deleted_at: new Date() }) },
    })

    const service = new PagesService()
    ;(service as any).prisma = prisma

    await expect(service.fetchPage(7, 1)).rejects.toBeInstanceOf(NotFoundException)
  })

  it("builds a page tree for a community", async () => {
    const prisma = makePrisma({
      roomMembership: { findFirst: async () => ({ id: 1 }) },
      page: {
        findMany: async () => [
          { id: 1, title: "Root", icon: "R", parent_id: null, updated_at: new Date("2026-06-17T12:00:00.000Z") },
          { id: 2, title: "Child", icon: "C", parent_id: 1, updated_at: new Date("2026-06-16T12:00:00.000Z") },
          { id: 3, title: "Orphan", icon: null, parent_id: 999, updated_at: new Date("2026-06-15T12:00:00.000Z") },
        ],
      },
    })

    const service = new PagesService()
    ;(service as any).prisma = prisma
    const result = await service.fetchTree(2, 1)

    expect(result.room_id).toBe(2)
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0].updated_at).toBe("2026-06-17T12:00:00.000Z")
    expect(result.pages[0].children).toHaveLength(1)
  })
})
