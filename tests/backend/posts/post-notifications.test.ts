import { describe, expect, it, vi } from "vitest"
import { EntryNotificationsService } from "@server/api/v1/entries/entry-notifications.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

describe("Entry notification content authority", () => {
  it.each([
    { type: "doc", content: [] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: "user:2", targetType: "user", targetId: "2", label: "Ada" } }] }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Current body" }] }] },
  ])("uses only the published Document for excerpts: %j", async (content) => {
    const prisma = {
      notificationEvent: { create: vi.fn().mockResolvedValue({ id: 1 }) },
      roomMembership: { findMany: vi.fn().mockResolvedValue([{ user_id: 2 }]) },
    }
    const service = withTestDependencies(new EntryNotificationsService(), { prisma })
    const post = { id: 1, user_id: 1, room_id: 1, content: "Obsolete private body" }
    await service.createPostNotification(post, content)
    await service.createMentionNotifications(post, content)
    const expected = JSON.stringify(content).includes("Current body") ? "Current body" : ""
    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(JSON.stringify(content).includes("user:2") ? 2 : 1)
    for (const [input] of prisma.notificationEvent.create.mock.calls) {
      expect(input.data.payload.excerpt).toBe(expected)
    }
  })
})
