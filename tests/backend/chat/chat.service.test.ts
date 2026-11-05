import { ForbiddenException } from "@nestjs/common"
import { ChatService } from "@server/api/v2/rooms/chat.service"
import { vi } from "vitest"

const NOW = new Date("2026-07-22T12:00:00.000Z")

it("returns unique reply participants and counts all their published replies", async () => {
  const { service, prisma } = makeService()
  prisma.reply.groupBy.mockResolvedValue([
    { chat_message_id: 10, user_id: 1, _count: { _all: 2 } },
    { chat_message_id: 10, user_id: 2, _count: { _all: 1 } },
  ] as never)
  const result = await service.listMessages(4, 1, {})
  expect(result.messages[0]).toMatchObject({
    reply_count: 3,
    reply_participants: [
      { id: 1, username: "Alex", avatar_url: "/alex.png" },
      { id: 2, username: "Mira", avatar_url: "/mira.png" },
    ],
  })
  expect(prisma.reply.groupBy).toHaveBeenCalledWith(expect.objectContaining({
    by: ["chat_message_id", "user_id"], where: { chat_message_id: { in: [10] }, status: "published" },
  }))
})

it("finds active and upcoming rounds belonging to the room", async () => {
  const { service, prisma } = makeService();
  const findMany = vi.fn().mockResolvedValue([]);
  const reconcileCircle = vi.fn();
  Object.assign(prisma, { round: { findMany } });
  Object.assign(service, { activityLifecycle: { reconcileCircle } });
  await service.listActivities(4, 1);
  expect(reconcileCircle).toHaveBeenCalledWith(4);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
    room_id: 4,
    status: { in: ["active", "draft"] },
  } }));
});

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    room_id: 4,
    author_id: 2,
    body: "A real message",
    masked_alias: "Pink Panda",
    client_nonce: null,
    created_at: new Date("2026-07-14T12:00:00.000Z"),
    updated_at: new Date("2026-07-14T12:00:00.000Z"),
    fire_at: new Date("2026-07-21T12:00:00.000Z"),
    expires_at: new Date("2026-07-28T12:00:00.000Z"),
    identity_grants: [],
    status: "published",
    timeline_kind: "message",
    pinned_at: null,
    pinned_by_id: null,
    _count: { replies: 0 },
    ...overrides,
  }
}

function makeService(options: {
  porosity?: "open" | "masked" | "closed"
  accessKind?: "member" | "visitor"
  rows?: ReturnType<typeof message>[]
} = {}) {
  const rows = options.rows ?? [message()]
  const notificationEvent = { create: vi.fn().mockResolvedValue({ id: 70 }) }
  const tx = {
    notificationEvent,
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    chatMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(message({ id: 11, author_id: 1, status: "draft", created_at: NOW })),
      create: vi.fn().mockResolvedValue(message({ id: 11, created_at: NOW, fire_at: new Date(NOW.getTime() + 7 * 86_400_000) })),
      update: vi.fn().mockResolvedValue(message({ id: 11, author_id: 1, status: "published", created_at: NOW })),
      findUniqueOrThrow: vi.fn().mockResolvedValue(
        message({
          id: 11,
          author_id: 1,
          created_at: NOW,
          fire_at: new Date(NOW.getTime() + 7 * 86_400_000),
          expires_at: new Date(NOW.getTime() + 14 * 86_400_000),
          identity_grants: [{ user_id: 1 }],
        }),
      ),
    },
    chatMessageIdentityGrant: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  }
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue({ owner_id: 1, participations: [] }) },
    roomMembership: {
      findFirst: vi.fn().mockResolvedValue({
        created_at: new Date("2026-07-01T00:00:00.000Z"),
        room: { porosity: options.porosity ?? "open" },
      }),
    },
    chatMessage: {
      findMany: vi.fn().mockResolvedValue(rows),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(message({ author_id: 1, fire_at: new Date("2026-07-29T12:00:00.000Z") })),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    entry: { update: vi.fn(), findFirst: vi.fn().mockResolvedValue({ id: 40 }), findMany: vi.fn().mockResolvedValue([]) },
    document: { findMany: vi.fn().mockResolvedValue([]) },
    reply: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    page: {
      findFirst: vi.fn().mockResolvedValue({ id: 75 }),
    },
    user: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? { id: 1, username: "Alex" } : { id: 2, username: "Mira" }),
      ),
    },
    chatNoteCopy: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 81 }),
    },
    square: { findFirst: vi.fn().mockResolvedValue({ id: 30 }) },
    chatMessageRead: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    activeStorageAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    chatSaveRequest: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    notificationEvent,
    chatPresenceSession: {
      findMany: vi.fn().mockResolvedValue([{ user_id: 1 }, { user_id: 2 }]),
    },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  }
  const realtime = { emit: vi.fn(), chatRoom: vi.fn((id: number) => `chat:${id}`) }
  const boss = { start: vi.fn(), enqueueInTransaction: vi.fn().mockResolvedValue("tx-job"), enqueueAfter: vi.fn().mockResolvedValue("job-1"), enqueue: vi.fn().mockResolvedValue("job-2") }
  const posts = {
    ensureChatAttachmentEntry: vi.fn().mockResolvedValue(40),
    createDraft: vi.fn().mockResolvedValue({ id: 40 }),
    saveContent: vi.fn().mockResolvedValue({ id: 40 }),

  }
  const pages = {
    createPage: vi.fn().mockResolvedValue({ page: { id: 50 } }),
    saveContent: vi.fn().mockResolvedValue({ page: { id: 50 } }),
    prependContentBlocks: vi.fn().mockResolvedValue({ page: { id: 75 } }),
  }
  const communities = {
    listMembersForChat: vi.fn().mockResolvedValue({
      members: [
        { id: 1, user_id: 1, display_username: "Alex", display_avatar_url: "/alex.png", avatar_url: "/alex.png" },
        { id: 2, user_id: 2, display_username: "Mira", display_avatar_url: "/mira.png", avatar_url: "/mira.png" },
      ],
    }),
  }
  const service = new ChatService()
  const circleAccess = {
    resolve: vi.fn().mockResolvedValue({ kind: options.accessKind ?? "member", canViewNotes: true, room: { id: 4, porosity: options.porosity ?? "open" } }),
    requireAccessesInTransaction: vi.fn().mockResolvedValue({ kind: options.accessKind ?? "member" }),
    require: vi.fn().mockResolvedValue({
      kind: options.accessKind ?? "member",
      room: { id: 4, porosity: options.porosity ?? "open" },
    }),
    requireMember: vi.fn().mockResolvedValue({ kind: "member", room: { id: 4, porosity: options.porosity ?? "open" } }),
  }
  Object.assign(service as object, { prisma, realtime, rooms: communities, boss, entries: posts, pages, circleAccess })
  return { service, prisma, realtime, tx, boss, entries: posts, pages, circleAccess }
}

describe("ChatService", () => {
  it("lets Open visitors paginate available history without granting membership", async () => {
    const { service, prisma } = makeService({ accessKind: "visitor", porosity: "open" });
    const payload = await service.listMessages(4, 1, { before: 100, limit: 20, now: NOW });
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { lt: 100 } }), take: 21,
    }));
    expect(payload.viewer_access).toEqual({ kind: "visitor", history_limit: null, can_paginate: true, can_send: true });
  });

  it.each(["masked", "closed"] as const)("does not expose presence identities to %s visitors", async porosity => {
    const { service } = makeService({ accessKind: "visitor", porosity });
    expect((await service.listMessages(4, 1, { now: NOW })).present_user_ids).toEqual([]);
  });

  it("does not broadcast when durable queue work cannot be committed", async () => {
    const { service, boss, realtime } = makeService();
    boss.enqueueInTransaction.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(service.sendMessage(4, 1, { body: "Atomic", clientNonce: "atomic", now: NOW })).rejects.toThrow("queue unavailable");
    expect(realtime.emit).not.toHaveBeenCalled();
  });

  it("loads missed messages in ascending bounded pages without widening visitor access", async () => {
    const { service, prisma } = makeService({ rows: [message({ id: 11 }), message({ id: 12 }), message({ id: 13 })] });
    const page = await service.listMessages(4, 1, { after: 10, limit: 2, now: NOW });
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { gt: 10 } }), orderBy: { id: "asc" }, take: 3,
    }));
    expect(page.messages.map(row => row.id)).toEqual([11, 12]);
    expect(page.next_cursor).toBe(12);
    const visitor = makeService({ accessKind: "visitor", porosity: "masked" });
    await visitor.service.listMessages(4, 1, { after: 10, now: NOW });
    expect(visitor.prisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { room_id: 4, status: "published", expires_at: { gt: NOW }, created_at: { gt: new Date(NOW.getTime() - 14 * 86400000) } }, orderBy: { id: "desc" }, take: 10,
    }));
  });

  it("records only requested accessible messages, idempotently", async () => {
    const { service, prisma } = makeService();
    await service.markMessagesSeen(4, 1, [10]);
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ room_id: 4, id: { in: [10] }, status: "published" }),
    }));
    expect(prisma.chatMessageRead.createMany).toHaveBeenCalledWith({
      data: [{ user_id: 1, message_id: 10, seen_at: expect.any(Date) }], skipDuplicates: true,
    });
    await expect(service.markMessagesSeen(4, 1, [-1])).rejects.toThrow();
    expect(prisma.chatMessageRead.createMany).toHaveBeenCalledTimes(1);
  });

  it("restricts visitor receipts to the visible newest ten messages", async () => {
    const { service, prisma } = makeService({ accessKind: "visitor", porosity: "masked" });
    await service.markMessagesSeen(4, 1, [9]);
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10, orderBy: { id: "desc" } }));
    expect(prisma.chatMessageRead.createMany).not.toHaveBeenCalled();
  });

  it("hydrates a linked post with its own author while retaining the chat sender", async () => {
    const linked = message({ author_id: 1, entry_id: null, timeline_kind: "post_link", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "View post", marks: [{ type: "link", attrs: { href: "/app/entries/40" } }] }] }] } })
    const { service, prisma } = makeService({ rows: [linked] })
    prisma.entry.findMany.mockResolvedValue([{
      id: 40,
      room_id: 4,
      user_id: 2,
      format: "mixed_media",
      format_data: {},
      user: { username: "Mira" },
      project: { id: 12, name: "Listening Project" },
    }])
    prisma.activeStorageAttachment.findMany.mockResolvedValue([{ record_id: 12, blob_id: 99 }])
    prisma.document.findMany.mockResolvedValue([{ docable_id: 40, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original post" }] }] } }])
    const result = await service.listMessages(4, 1, { now: NOW })
    expect(prisma.reply.findMany).not.toHaveBeenCalled()
    expect(result.messages[0]).toMatchObject({
      kind: "post_link",
      can_convert: false,
      author: { display_username: "Alex" },
      entry: {
        id: 40,
        available: true,
        author: { display_username: "Mira", avatar_url: "/mira.png" },
        project: { id: 12, name: "Listening Project", icon_url: "/api/v1/uploads/99/variants/icon160" },
      },
    })
    prisma.project.findUnique.mockResolvedValue(null)
    expect((await service.listMessages(4, 1, { now: NOW })).messages[0].entry?.project).toBeNull()
    prisma.entry.findMany.mockResolvedValue([])
    const unavailable = await service.listMessages(4, 1, { now: NOW })
    expect(unavailable.messages[0]).toMatchObject({ kind: "post_link", entry: null })
  })
  it("links a published post through normal chat delivery without reserving the post", async () => {
    const { service, prisma, tx, boss, realtime } = makeService()
    prisma.notificationEvent.create.mockResolvedValue({ id: 99 })
    await service.linkPostToChat(4, 40, 1, "link-post-40")
    expect(prisma.entry.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 40, status: "published", room_id: 4 }) }))
    const data = tx.chatMessage.create.mock.calls[0][0].data
    expect(data).toMatchObject({ author_id: 1, room_id: 4, client_nonce: "link-post-40", timeline_kind: "post_link", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "View post", marks: [{ type: "link", attrs: { href: "/app/entries/40" } }] }] }] } })
    expect(data.entry_id).toBeUndefined()
    expect(boss.enqueueInTransaction).toHaveBeenCalled()
    expect(realtime.emit).toHaveBeenCalledWith("ChatChannel", "chat:4", expect.objectContaining({ type: "message_created" }))
  })
  it("rejects unavailable posts and never sends a message", async () => {
    const { service, prisma, tx } = makeService()
    prisma.entry.findFirst.mockResolvedValue(null)
    await expect(service.linkPostToChat(4, 40, 1, "link-post-40")).rejects.toThrow("Post not found")
    expect(tx.chatMessage.create).not.toHaveBeenCalled()
  })
  it("does not promote a chat post link back into a new post", async () => {
    const { service, prisma, entries: posts } = makeService()
    prisma.chatMessage.findFirst.mockResolvedValue(message({ timeline_kind: "post_link" }))
    await expect(service.saveMessageAsPost(4, 10, 1)).rejects.toMatchObject({ status: 410 })
    expect(posts.createDraft).not.toHaveBeenCalled()
  })

  it("returns published messages without expiring historical rows", async () => {
    const { service, prisma } = makeService()

    const payload = await service.listMessages(4, 1, { now: NOW })

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ room_id: 4, status: "published" }),
      }),
    )
    expect(payload.messages).toEqual([
      expect.objectContaining({
        id: 10,
        lifecycle: "active",
        author: expect.objectContaining({ id: 2, display_username: "Mira" }),
        masked_author: null,
      }),
    ])
    expect(payload.viewer_user_id).toBe(1)
    expect(payload.viewer_access).toEqual({ kind: "member", history_limit: null, can_paginate: true, can_send: true })
  })

  it.each(["image", "audio", "video", "file"])("rejects new %s messages and preserves old pending drafts without side effects", async type => {
    const { service, tx, realtime, prisma } = makeService()
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type, attrs: { src: "/api/v1/uploads/8", audioAssetId: 8, videoAssetId: 8 } }] }] }
    for (const draftId of [undefined, 11]) {
      await expect(service.sendMessage(4, 1, { body: "Keep my text", content, draftId, now: NOW })).rejects.toThrow("Chat supports text and links")
    }
    expect(tx.chatMessage.update).not.toHaveBeenCalled()
    expect(tx.notificationEvent.create).not.toHaveBeenCalled()
    expect(realtime.emit).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a legacy draft publish even when its supplied document hides the media", async () => {
    const { service, tx } = makeService()
    await expect(service.sendMessage(4, 1, { body: "Text", draftId: 11 })).rejects.toThrow("Chat supports text and links")
    expect(tx.chatMessage.update).not.toHaveBeenCalled()
  })

  it("builds the visitor People view only from the ten messages the visitor may see", async () => {
    const pinnedAt = new Date("2026-07-20T12:00:00.000Z")
    const rows = [
      message({ id: 13, author_id: 2, body: "Newest Mira" }),
      message({ id: 12, author_id: 2, body: "Pinned Mira", pinned_at: pinnedAt }),
      message({ id: 11, author_id: 1, body: "Pinned Alex", pinned_at: pinnedAt }),
    ]
    const { service, prisma, circleAccess } = makeService({ accessKind: "visitor", porosity: "masked", rows })

    const all = await service.listPeopleMessages(4, 1)
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { room_id: 4, status: "published", expires_at: { gt: expect.any(Date) }, created_at: { gt: expect.any(Date) }, timeline_kind: "message", OR: [{ entry_origin: null }, { entry_origin: { not: "wall_publication" } }] },
      orderBy: { id: "desc" },
      take: 10,
    }))
    expect(all.messages.map(row => row.id)).toEqual([13, 11])

    expect(circleAccess.requireMember).not.toHaveBeenCalled()
  })

  it("always exposes real chat identity without consulting masking grants", async () => {
    const { service, prisma } = makeService({ porosity: "masked" })

    const payload = await service.listMessages(4, 1, { now: NOW })

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ created_at: { gt: new Date(NOW.getTime() - 14 * 86400000) }, expires_at: { gt: NOW } }) }),
    )
    expect(payload.messages[0]).toEqual(
      expect.objectContaining({
        author: expect.objectContaining({ id: 2, display_username: "Mira" }),
        masked_author: null,
      }),
    )
  })

  it("keeps the real account identity for visitor messages when the author is not a current member", async () => {
    const { service } = makeService({
      accessKind: "visitor", porosity: "masked",
      rows: [message({ author: { id: 2, username: "Mira" } })],
    })
    ;(service as any).rooms.listMembersForChat.mockResolvedValue({ members: [] })

    const payload = await service.listMessages(4, 1, { now: NOW })

    expect(payload.messages[0].author).toEqual({ id: 2, display_username: "Mira", avatar_url: null })
  })

  it("caps visitors to the latest ten messages and disables older pagination", async () => {
    const rows = Array.from({ length: 11 }, (_, index) => message({ id: 20 - index }))
    const { service, prisma } = makeService({ accessKind: "visitor", porosity: "masked", rows })

    const payload = await service.listMessages(4, 1, { before: 99, limit: 50, now: NOW })

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: "desc" }, take: 10 }),
    )
    expect(payload.messages).toHaveLength(10)
    expect(payload.next_cursor).toBeNull()
    expect(payload.viewer_access).toEqual({ kind: "visitor", history_limit: 10, can_paginate: false, can_send: true })
  })

  it("keeps durable Chat-to-Wall and Chat-to-Notes actions member-only", async () => {
    const { service, prisma } = makeService({ accessKind: "visitor", porosity: "masked" })
    ;(service as any).circleAccess.requireMember.mockRejectedValue(new ForbiddenException("Members only"))

    await expect(service.saveMessageAsPost(4, 10, 1)).rejects.toMatchObject({ status: 410 })
    await expect(service.copyMessageToNote(4, 10, 1, NOW, 75, "copy-1")).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.requestMessageSave(4, 10, 1, NOW)).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled()
  })

  it("does not generate identity grants, emits a message reference, and fans out notifications", async () => {
    const { service, prisma, realtime, tx, boss } = makeService({ porosity: "masked" })
    prisma.notificationEvent.create.mockResolvedValue({ id: 70 })

    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            {
              type: "mention",
              attrs: {
                targetType: "room",
                targetId: "4",
                label: "Circle",
                href: "/app/rooms/4",
              },
            },
          ],
        },
      ],
    }
    const payload = await service.sendMessage(4, 1, {
      body: "  Hello circle  ",
      content,
      clientNonce: "client-1",
      now: NOW,
    })

    expect(tx.chatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        room_id: 4,
        author_id: 1,
        body: "Hello circle",
        masked_alias: "",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Hello " },
                {
                  type: "mention",
                  attrs: {
                    id: "room:4",
                    targetType: "room",
                    targetId: "4",
                    label: "Circle",
                    href: "/app/rooms/4",
                    avatarUrl: null,
                    icon: null,
                  },
                },
              ],
            },
          ],
        },
        client_nonce: "client-1",
        fire_at: new Date("2026-07-29T12:00:00.000Z"),
        expires_at: new Date("2026-08-05T12:00:00.000Z"),
      }),
    })
    expect(tx.chatMessageIdentityGrant.createMany).not.toHaveBeenCalled()
    expect(realtime.emit).toHaveBeenCalledWith("ChatChannel", "chat:4", {
      type: "message_created",
      room_id: 4,
      message_id: 11,
    })
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: {
        event_type: "chat_message_created",
        actor_id: 1,
        room_id: 4,
        target_user_id: null,
        payload: { chat_message_id: 11, excerpt: "Hello circle" },
        target_path: "/app/rooms/4/chat#chat-11",
        created_at: NOW,
        updated_at: NOW,
      },
    })
    expect(boss.enqueueInTransaction).toHaveBeenCalledWith(tx, "notifications.fanout", { eventId: 70 })
    expect(boss.enqueueInTransaction).not.toHaveBeenCalledWith(tx, "chat.expire", expect.anything(), expect.anything())
    expect(payload.mine).toBe(true)
  })

  it("preserves supported text formatting while stripping arbitrary mark attributes", () => {
    const { service } = makeService()
    const marks = ["bold", "italic", "strike", "underline", "code"].map(type => ({ type, attrs: { onclick: "unsafe", style: "arbitrary" } }))
    const cleaned = (service as any).cleanContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Formatted", marks: [...marks, { type: "unknown" }] }] }] })
    expect(cleaned.content[0].content[0].marks).toEqual(marks.map(({ type }) => ({ type })))
  })

  it("accepts Activity mentions in structured chat content", () => {
    const { service } = makeService()

    expect(
      (service as any).cleanContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: {
                  targetType: "round",
                  targetId: "12",
                  label: "Summer Making",
                  href: "/app/board/4/activities/12",
                },
              },
            ],
          },
        ],
      }),
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: {
                id: "round:12",
                targetType: "round",
                targetId: "12",
                label: "Summer Making",
                href: "/app/board/4/activities/12",
                avatarUrl: null,
                icon: null,
              },
            },
          ],
        },
      ],
    })
  })

  it.each([1, 2])("rejects direct Chat-to-Room conversion without reading or allocating content for user %s", async userId => {
    const { service, prisma, entries: posts } = makeService()
    await expect(service.saveMessageAsPost(4, 10, userId)).rejects.toMatchObject({ status: 410 })
    expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled()
    expect(prisma.entry.update).not.toHaveBeenCalled()
    expect(posts.createDraft).not.toHaveBeenCalled()
    expect(posts.saveContent).not.toHaveBeenCalled()
  })

  it("allows an author to copy a message after it enters the fire", async () => {
    const { service, prisma } = makeService()
    prisma.chatMessage.findFirst.mockResolvedValue(message({ author_id: 1, fire_at: new Date("2026-07-21T12:00:00.000Z") }))

    const result = await service.copyMessageToNote(4, 10, 1, NOW)

    expect(result).toEqual(expect.objectContaining({ note_id: 50, path: "/app/note/50" }))
  })

  it("copies an active author message into an existing note in the circle", async () => {
    const { service, prisma, pages } = makeService()

    const result = await service.copyMessageToNote(4, 10, 1, NOW, 75)

    expect(prisma.page.findFirst).toHaveBeenCalledWith({
      where: { id: 75, room_id: 4, deleted_at: null },
      select: { id: true },
    })
    expect(pages.prependContentBlocks).toHaveBeenCalledWith(75, 1, {
      blocks: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A real message" }],
        },
      ],
      position: "top",
    })
    expect(result).toEqual(expect.objectContaining({ note_id: 75, path: "/app/note/75" }))
  })

  it("lets a member save another member's message as an attributed durable quote idempotently", async () => {
    const { service, prisma, pages } = makeService()
    prisma.chatMessage.findFirst.mockResolvedValue(
      message({ author_id: 2, author: { id: 2, username: "Mira" }, entry: null }),
    )
    prisma.user.findUnique.mockResolvedValue({ id: 1, username: "Alex" })

    const result = await service.copyMessageToNote(4, 10, 1, NOW, 75, "copy-1")

    const quoteBlocks = pages.prependContentBlocks.mock.calls[0][2].blocks
    expect(quoteBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "blockquote",
          attrs: expect.objectContaining({ sourceMessageId: 10, sourceHref: "/app/rooms/4/chat#chat-10" }),
        }),
      ]),
    )
    expect(JSON.stringify(quoteBlocks)).toContain("Mira said:")
    expect(JSON.stringify(quoteBlocks)).toContain("Saved from Chat by Alex")
    expect(JSON.stringify(quoteBlocks)).toContain('"type":"link"')
    expect(JSON.stringify(quoteBlocks)).toContain("/app/rooms/4/chat#chat-10")
    expect(prisma.chatNoteCopy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ message_id: 10, note_id: 75, copied_by_id: 1, idempotency_key: "copy-1" }),
    })
    expect(result).toEqual(
      expect.objectContaining({ source_message_id: 10, copied_by: { id: 1, display_username: "Alex" } }),
    )
  })

  it("does not duplicate a note copy when its idempotency key is replayed", async () => {
    const { service, prisma, pages } = makeService()
    prisma.chatNoteCopy.findUnique.mockResolvedValue({ note_id: 75, message_id: 10 })

    const result = await service.copyMessageToNote(4, 10, 1, NOW, 75, "copy-1")

    expect(pages.prependContentBlocks).not.toHaveBeenCalled()
    expect(pages.saveContent).not.toHaveBeenCalled()
    expect(prisma.chatNoteCopy.create).not.toHaveBeenCalled()
    expect(result).toEqual({ note_id: 75, path: "/app/note/75" })
  })

  it("does not apply porosity or membership-date history masking to message actions", async () => {
    const { service, prisma } = makeService({ porosity: "masked" })

    await service.copyMessageToNote(4, 10, 1, NOW)

    expect(prisma.chatMessage.findFirst).toHaveBeenCalledWith({
      where: {
        id: 10,
        room_id: 4,
        status: "published",
        expires_at: { gt: NOW },
        created_at: { gt: new Date(NOW.getTime() - 14 * 86400000) },
      },
      include: expect.objectContaining({ entry: true }),
    })
  })

  it("notifies the message owner when another member asks to save", async () => {
    const { service, prisma, boss } = makeService()
    prisma.chatMessage.findFirst.mockResolvedValue(
      message({ author_id: 2, fire_at: new Date("2026-07-29T12:00:00.000Z") }),
    )
    prisma.chatSaveRequest.create.mockResolvedValue({ id: 60, status: "pending" })
    prisma.notificationEvent.create.mockResolvedValue({ id: 70 })

    const result = await service.requestMessageSave(4, 10, 1, NOW)

    expect(prisma.chatSaveRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ message_id: 10, requester_id: 1, owner_id: 2, status: "pending" }),
    })
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "chat_save_requested",
        actor_id: 1,
        target_user_id: 2,
        target_path: "/app/rooms/4/chat",
      }),
    })
    expect(boss.enqueue).toHaveBeenCalledWith("notifications.fanout", { eventId: 70 })
    expect(result).toEqual({ request_id: 60, status: "pending" })
  })

  it("rejects invalid pagination before querying messages", async () => {
    const { service, prisma } = makeService()

    await expect(service.listMessages(4, 1, { limit: Number.NaN, now: NOW })).rejects.toThrow("limit is invalid")
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled()
  })
})
