import { describe, expect, it, vi } from "vitest"
import { InboxService } from "@server/api/v1/inbox/inbox.service"

const tiptapDoc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

describe("InboxService", () => {
  it.each([
    { current: tiptapDoc("first draft"), excerpt: "first draft" },
    { current: { type: "doc", content: [] }, excerpt: "" },
    { current: { type: "doc", content: [{ type: "audio", attrs: { audioAssetId: 42 } }] }, excerpt: "" },
  ])("uses the current Document for task content and excerpt ($excerpt)", async ({ current, excerpt }) => {
    const now = Date.now()
    const posts = [
      {
        id: 1,

        user_id: 2,
        content: JSON.stringify(tiptapDoc("Obsolete body")),
        blocks: tiptapDoc("Obsolete blocks"),
        created_at: new Date(now - 12 * 60 * 60 * 1000),
        published_at: new Date(now - 12 * 60 * 60 * 1000),
        room_id: 1,
        user: { username: "Jordan" },

        replies: [],
      },
      {
        id: 2,
        user_id: 1,
        content: null,
        blocks: [],
        created_at: new Date(now - 2 * 24 * 60 * 60 * 1000),
        published_at: new Date(now - 2 * 24 * 60 * 60 * 1000),
        room_id: 1,
        user: { username: "Me" },

        replies: [{ id: 20, user_id: 3, created_at: new Date(now - 60 * 60 * 1000), published_at: new Date(now - 60 * 60 * 1000) }],
      },
      {
        id: 3,
        user_id: 4,
        content: null,
        blocks: [],
        created_at: new Date(now - 3 * 24 * 60 * 60 * 1000),
        published_at: new Date(now - 3 * 24 * 60 * 60 * 1000),
        room_id: 1,
        user: { username: "Riley" },

        replies: [
          { id: 29, user_id: 1, created_at: new Date(now - 25 * 60 * 60 * 1000), published_at: new Date(now - 25 * 60 * 60 * 1000) },
          { id: 30, user_id: 5, created_at: new Date(now - 24 * 60 * 60 * 1000), published_at: new Date(now - 24 * 60 * 60 * 1000) },
          { id: 31, user_id: 6, created_at: new Date(now - 23 * 60 * 60 * 1000), published_at: new Date(now - 23 * 60 * 60 * 1000) },
        ],
      },
    ]
    const prisma = {
      $queryRaw: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]),
      roomMembership: {
        findMany: vi.fn(async (args: { select?: { username_override?: boolean } }) =>
          args.select?.username_override
            ? []
            : [{ room_id: 1 }],
        ),
      },
      entry: {
        findMany: vi.fn(async () => posts),
      },
      document: {
        findMany: vi.fn(async () => [
          { docable_id: 1, content: current },
          { docable_id: 2, content: tiptapDoc("my rough mix") },
          { docable_id: 3, content: tiptapDoc("needs synthesis") },
        ]),
      },
      notificationEvent: {
        findMany: vi.fn(async () => []),
      },
      reflection: {
        findMany: vi.fn(async () => []),
      },
      entryViewState: {
        findMany: vi.fn(async () => [
          {
            entry_id: 3,
            reply_seen_through_at: posts[2].replies[2].published_at,
            reply_seen_through_id: 31,
          },
        ]),
      },
    }

    const service = new InboxService()
    ;(service as any).prisma = prisma

    const result = await service.inbox(1)

    expect(result.respond[0]).toMatchObject({
      bucket: "respond",
      entryId: "1",
      authorName: "Jordan",
      excerpt,
      content: current,
    })
    expect(result.respond[0].reasons).toContain("no replies yet")
    expect(result.respond[0].reasons).toContain("current work")

    expect(result.review[0]).toMatchObject({
      bucket: "review",
      entryId: "2",
      authorName: "Me",
    })
    expect(result.review[0].reasons).toContain("on your post")

    expect(result.remember[0]).toMatchObject({
      bucket: "remember",
      entryId: "3",
      authorName: "Riley",
    })
    expect(result.remember[0].reasons).toContain("not saved yet")
  })

  it("does not keep a post-level mention in review after the post has been seen", async () => {
    const now = Date.now()
    const mentionAt = new Date(now - 60 * 60 * 1000)
    const post = {
      id: 4,
      user_id: 1,
      content: null,
      blocks: [],
      created_at: new Date(now - 2 * 60 * 60 * 1000),
      published_at: new Date(now - 2 * 60 * 60 * 1000),
      room_id: 1,
      user: { username: "Me" },

      replies: [],
    }
    const prisma = {
      $queryRaw: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]),
      roomMembership: {
        findMany: vi.fn(async (args: { select?: { username_override?: boolean } }) =>
          args.select?.username_override ? [] : [{ room_id: 1 }],
        ),
      },
      entry: {
        findMany: vi.fn(async () => [post]),
      },
      document: {
        findMany: vi.fn(async () => [{ docable_id: 4, content: tiptapDoc("mentioned me") }]),
      },
      notificationEvent: {
        findMany: vi.fn(async () => [
          {
            entry_id: 4,
            target_path: "/app/entries/4",
            created_at: mentionAt,
          },
        ]),
      },
      reflection: {
        findMany: vi.fn(async () => []),
      },
      entryViewState: {
        findMany: vi.fn(async () => [
          {
            entry_id: 4,
            entry_seen_at: new Date(now),
            reply_seen_through_at: null,
            reply_seen_through_id: null,
          },
        ]),
      },
    }

    const service = new InboxService()
    ;(service as any).prisma = prisma

    const result = await service.inbox(1)

    expect(result.review).toEqual([])
  })

  it("asks for posts with recent replies or mentions even when the post is old", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]),
      roomMembership: {
        findMany: vi.fn(async (args: { select?: { username_override?: boolean } }) =>
          args.select?.username_override ? [] : [{ room_id: 1 }],
        ),
      },
      entry: {
        findMany: vi.fn(async (_query: { where: { AND: Array<{ OR: unknown[] }> } }) => []),
      },
    }

    const service = new InboxService()
    ;(service as any).prisma = prisma

    await service.inbox(1)

    const query = prisma.entry.findMany.mock.calls[0][0]
    expect(query.where.AND[1].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ replies: expect.any(Object) }),
        expect.objectContaining({ notification_events: expect.any(Object) }),
      ]),
    )
  })
})
