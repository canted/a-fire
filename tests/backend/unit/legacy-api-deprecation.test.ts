import { successorPath } from "@server/api/legacy-api-deprecation.interceptor"

describe("legacy API deprecation successor paths", () => {
  it("maps v1 page routes to v2 note routes", () => {
    expect(successorPath("/api/v1/pages/tree?room_id=12")).toBe("/api/v2/notes/tree?room_id=12")
    expect(successorPath("/api/v1/pages/7/content/blocks")).toBe("/api/v2/notes/7/content/blocks")
  })

  it("maps v1 community routes to v2 circle routes", () => {
    expect(successorPath("/api/v1/rooms/4/members")).toBe("/api/v2/rooms/4/members")
    expect(successorPath("/api/v1/rooms/4/menu")).toBe("/api/v2/rooms/4/menu")
  })

  it("maps old unversioned app routes to v2", () => {
    expect(successorPath("/api/profile/avatar")).toBe("/api/v2/profile/avatar")
    expect(successorPath("/api/notification_preferences")).toBe("/api/v2/notification-preferences")
    expect(successorPath("/api/push_subscriptions")).toBe("/api/v2/push-subscriptions")
    expect(successorPath("/api/push_subscriptions/unsubscribe")).toBe("/api/v2/push-subscriptions/unsubscribe")
  })
})
