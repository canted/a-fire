import { describe, expect, it, vi } from "vitest"
import { NotificationPreferencesService } from "@server/notifications/notification-preferences.service"

describe("NotificationPreferencesService", () => {
  it("defaults to all notifications when no preference exists", async () => {
    const prisma = {
      notificationPreference: { findMany: vi.fn(async () => []) },
    }

    const service = new NotificationPreferencesService()
    ;(service as any).prisma = prisma

    const preference = await service.resolveForUser(1, {
      id: 10,
      event_type: "post_created",
      entry_id: 5,
      square_id: null,
      board_id: null,
      room_id: 2,
      actor: { username: "alex" },
      room: { name: "A Fire" },
    } as any)

    expect(preference.notificationType).toBe("all")
    expect(preference.deliveryMode).toBe("immediate")
  })

  it("filters events based on notification type and delivery mode", () => {
    const service = new NotificationPreferencesService()
    const allAllowed = service.allowsEvent(
      { notificationType: "all", deliveryMode: "immediate", pushEnabled: true },
      "reply_created",
    )
    const postsAllowed = service.allowsEvent(
      { notificationType: "posts", deliveryMode: "immediate", pushEnabled: true },
      "post_created",
    )
    const mentionsAllowed = service.allowsEvent(
      { notificationType: "posts", deliveryMode: "immediate", pushEnabled: true },
      "mention",
    )
    const postsBlocked = service.allowsEvent(
      { notificationType: "posts", deliveryMode: "immediate", pushEnabled: true },
      "reply_created",
    )
    const muted = service.allowsEvent(
      { notificationType: "all", deliveryMode: "mute", pushEnabled: true },
      "post_created",
    )

    expect(allAllowed).toBe(true)
    expect(postsAllowed).toBe(true)
    expect(mentionsAllowed).toBe(true)
    expect(postsBlocked).toBe(false)
    expect(muted).toBe(false)
  })
})
