import { ForbiddenException } from "@nestjs/common"
import { describe, expect, it } from "vitest"
import { MentionsService } from "@server/api/v1/mentions/mentions.service"

function makePrisma(overrides: Partial<any>) {
  return {
    roomMembership: { findFirst: async () => null, findMany: async () => [] },
    room: { findMany: async () => [] },
    page: { findMany: async () => [] },
    round: { findMany: async () => [] },
    square: { findMany: async () => [] },
    $queryRaw: async () => [],
    ...overrides,
  }
}

describe("MentionsService", () => {
  it("rejects users outside the community", async () => {
    const service = new MentionsService()
    ;(service as any).prisma = makePrisma({})
    ;(service as any).circleAccess = { require: async () => { throw new ForbiddenException("Forbidden") } }

    await expect(service.listTargets(1, 2)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("returns users, notes, activities, and only same-tree circles available to the member", async () => {
    const service = new MentionsService()
    ;(service as any).prisma = makePrisma({
      roomMembership: {
        findFirst: async () => ({ id: 1 }),
        findMany: async () => [
          { id: 2, room_id: 7, user_id: 20, username_override: "Baker", user: { username: "ben" } },
          { id: 1, room_id: 7, user_id: 10, username_override: null, user: { username: "ada" } },
        ],
      },
      page: {
        findMany: async () => [
          { id: 31, title: "Roadmap", icon: "R" },
          { id: 32, title: null, icon: null },
        ],
      },
      square: {
        findMany: async () => [
          { id: 101, user_id: 10 },
          { id: 102, user_id: 20 },
        ],
      },
      $queryRaw: async () => [{ record_id: 10, blob_id: 900 }],
      room: {
        findMany: async () => [
          { id: 7, name: "Campfire", parent_id: null },
          { id: 8, name: "Side Circle", parent_id: 7 },
          { id: 9, name: "Unrelated Circle", parent_id: null },
        ],
      },
      round: {
        findMany: async () => [
          { id: 41, board_id: null, name: "Summer Making Activity", status: "active" },
        ],
      },
    })

    ;(service as any).circleAccess = { require: async () => ({ kind: "member", canViewNotes: true, room: { porosity: "open" } }) }
    const result = await service.listTargets(7, 10)

    expect(result.room_id).toBe(7)
    expect(result.targets).toEqual([
      {
        id: "user:10",
        target_type: "user",
        target_id: "10",
        label: "ada",
        subtitle: "User",
        avatar_url: "/api/v1/uploads/900/variants/avatarStripe40",
        icon: null,
        href: "/app/rooms/7/members/10",
      },
      {
        id: "user:20",
        target_type: "user",
        target_id: "20",
        label: "Baker",
        subtitle: "User",
        avatar_url: null,
        icon: null,
        href: "/app/rooms/7/members/20",
      },
      {
        id: "page:31",
        target_type: "note",
        target_id: "31",
        label: "Roadmap",
        subtitle: "Note",
        avatar_url: null,
        icon: "R",
        href: "/app/note/31",
      },
      {
        id: "page:32",
        target_type: "note",
        target_id: "32",
        label: "Untitled page",
        subtitle: "Note",
        avatar_url: null,
        icon: null,
        href: "/app/note/32",
      },
      {
        id: "activity:41",
        target_type: "round",
        target_id: "41",
        label: "Summer Making Activity",
        subtitle: "Round",
        avatar_url: null,
        icon: null,
        href: "/app/rounds/41",
      },
      {
        id: "circle:7",
        target_type: "room",
        target_id: "7",
        label: "Campfire",
        subtitle: "Circle",
        avatar_url: null,
        icon: null,
        href: "/app/rooms/7",
      },
      {
        id: "circle:8",
        target_type: "room",
        target_id: "8",
        label: "Side Circle",
        subtitle: "Circle",
        avatar_url: null,
        icon: null,
        href: "/app/rooms/8",
      },
    ])
  })
})
