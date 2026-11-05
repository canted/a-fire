import { describe, expect, it, vi } from "vitest"
import { fetchNotices, mapNoticeRecord, type NotificationInboxRecord } from "../../../frontend/src/lib/api/notices"
import type { ApiClient } from "../../../frontend/site/lib/api/client"

describe("mapNoticeRecord", () => {
  it("maps Round lifecycle events without treating them as posts", () => {
    const notice = mapNoticeRecord({
      id: "activity-1",
      deliveryState: "sent",
      notificationEvent: {
        id: "event-1",
        eventType: "round_phase_changed",
        actorUsername: "Host",
        roomName: "Field Notes",
        targetPath: "/app/board/3/activities/9",
        payload: { activity_name: "Sleeve Exchange", milestone: "round_completed", excerpt: "Open Sleeve Exchange to see the results." },
        createdAt: "2026-09-03T12:00:00.000Z",
      },
    });

    expect(notice).toEqual(expect.objectContaining({
      type: "activity",
      activityName: "Sleeve Exchange",
      activityMilestone: "round_completed",
      message: "Open Sleeve Exchange to see the results.",
    }));
  });

  it("maps room relationship events to Room notices", () => {
    const notice = mapNoticeRecord({
      id: "circle-1",
      deliveryState: "sent",
      notificationEvent: {
        id: "event-1",
        eventType: "circle_knock_suggested",
        actorUsername: "Mara",
        roomName: "Field Notes",
        targetPath: "/app/rooms/3/chat",
        payload: {},
        createdAt: "2026-09-03T12:00:00.000Z",
      },
    });

    expect(notice).toEqual(expect.objectContaining({
      type: "circle",
      eventType: "circle_knock_suggested",
      targetUrl: "/app/rooms/3/chat",
    }));
  });

  it("maps reply notices to post reply anchors", () => {
    const record: NotificationInboxRecord = {
      id: "1",
      deliveryState: "delivered",
      contentSeen: true,
      notificationEvent: {
        id: "9",
        eventType: "reply_created",
        actorUsername: "Alt",
        actorAvatarUrl: "/avatar.png",
        roomName: "Room",
        roomAvatarUrl: "/circle.png",
        targetPath: "/app/entries/4",
        entryId: "4",
        replyId: "7",
        postAuthorUsername: "Poster",
        postCreatedAt: "2026-05-26T12:00:00.000Z",
        postPublishedAt: "2026-05-27T12:00:00.000Z",
        payload: { excerpt: "hello" },
        replyContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] },
        createdAt: "2026-05-28T12:00:00.000Z",
      },
    }

    const notice = mapNoticeRecord(record)

    expect(notice).toMatchObject({
      type: "reply",
      source: "Alt",
      sourceAvatarUrl: "/avatar.png",
      roomName: "Room",
      roomAvatarUrl: "/circle.png",
      entryId: "4",
      replyId: "7",
      postAuthorName: "Poster",
      targetUrl: "/app/entries/4#reply-7",
      message: "hello",
      contentSeen: true,
    })
    expect(notice.postCreatedAt?.toISOString()).toBe("2026-05-26T12:00:00.000Z")
    expect(notice.postPublishedAt?.toISOString()).toBe("2026-05-27T12:00:00.000Z")
    expect(notice.replyContent).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    })
  })

  it("maps bundled reply metadata for grouped reply notices", () => {
    const record: NotificationInboxRecord = {
      id: "10",
      deliveryState: "delivered",
      contentSeen: false,
      bundle: {
        type: "reply",
        key: "reply-post:4",
        itemIds: ["10", "9", "8"],
        replyCount: 5,
        actors: [
          { username: "Mira", avatarUrl: "/mira.png" },
          { username: "Lin", avatarUrl: "/lin.png" },
        ],
      },
      notificationEvent: {
        id: "10",
        eventType: "reply_created",
        actorUsername: "Ada",
        actorAvatarUrl: "/ada.png",
        roomName: "Room",
        roomAvatarUrl: "/circle.png",
        targetPath: "/app/entries/4#reply-8",
        entryId: "4",
        replyId: "8",
        postAuthorUsername: "Poster",
        payload: { excerpt: "latest reply" },
        replyContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "latest reply" }] }] },
        createdAt: "2026-05-28T12:00:00.000Z",
      },
    }

    const notice = mapNoticeRecord(record)

    expect(notice).toMatchObject({
      id: "10",
      type: "reply",
      source: "Mira",
      sourceAvatarUrl: "/mira.png",
      bundleKey: "reply-post:4",
      bundledNoticeIds: ["10", "9", "8"],
      replyCount: 5,
      replyActors: [
        { name: "Mira", avatarUrl: "/mira.png" },
        { name: "Lin", avatarUrl: "/lin.png" },
      ],
      targetUrl: "/app/entries/4#reply-8",
      message: "latest reply",
      contentSeen: false,
    })
  })
})

describe("fetchNotices", () => {
  it("requests the first inbox page with the default limit", async () => {
    const client = { get: vi.fn().mockResolvedValue({ items: [], highlightAfter: "2026-01-01T00:00:00.000Z", visitSeenThroughAt: "2026-01-01T00:00:00.000Z", nextCursor: null }) } as unknown as ApiClient

    const result = await fetchNotices(client)

    expect(client.get).toHaveBeenCalledWith("/v1/notices?limit=10")
    expect(result.items).toEqual([])
    expect(result.nextCursor).toBeNull()
  })

  it("requests the next inbox page with a cursor", async () => {
    const client = { get: vi.fn().mockResolvedValue({ items: [], highlightAfter: "2026-01-01T00:00:00.000Z", visitSeenThroughAt: "2026-01-01T00:00:00.000Z", nextCursor: "4" }) } as unknown as ApiClient

    await fetchNotices(client, { cursor: "7" })

    expect(client.get).toHaveBeenCalledWith("/v1/notices?limit=10&cursor=7")
  })
})
