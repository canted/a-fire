import { describe, expect, it } from "vitest"
import { NavigationService } from "@server/api/v1/navigation/navigation.service"

describe("NavigationService", () => {
  it("builds slide menu payload with current community", async () => {
    const prisma = {
      roomMembership: {
        findMany: async () => [
          { room_id: 1, room: { id: 1, name: "One" } },
          { room_id: 2, room: { id: 2, name: "Two" } },
        ],
      },
      room: {
        findMany: async () => [
          { id: 1, name: "One" },
          { id: 2, name: "Two" },
        ],
      },
      board: {
        findMany: async () => [
          { id: 10, name: "Latest Posts", room_id: 1 },
          { id: 20, name: "Latest Posts", room_id: 2 },
        ],
      },
      page: {
        findMany: async () => [
          { id: 3, title: "Alpha", icon: "A" },
          { id: 4, title: "Beta", icon: "B" },
        ],
      },
      $queryRaw: async () => [],
    }

    const service = new NavigationService()
    ;(service as any).prisma = prisma
    const result = await service.slideMenu(1, 2)

    expect(result.rooms).toHaveLength(2)
    expect(result.currentRoom?.id).toBe("2")
    expect(result.currentRoom?.pages.map((page) => page.id)).toEqual(["3", "4"])
  })
})
