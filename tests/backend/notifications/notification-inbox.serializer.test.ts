import { describe, expect, it, vi } from "vitest"
import { NotificationInboxSerializer } from "@server/notifications/notification-inbox.serializer"
import { UnseenContentService } from "@server/api/v1/unseen/unseen-content.service"

describe("NotificationInboxSerializer", () => {
  it("bounds authorization work across a full inbox page without truncating checks", async () => {
    const serializer = new NotificationInboxSerializer()
    const pending: Array<() => void> = []
    let active = 0, peak = 0
    const checked: number[] = []
    const canReadPublishedChatMessage = vi.fn((id: number) => {
      checked.push(id)
      active++
      peak = Math.max(peak, active)
      return new Promise<boolean>(resolve => pending.push(() => { active--; resolve(false) }))
    })
    Object.assign(serializer, { circleAccess: { canReadPublishedChatMessage } })
    const items = Array.from({ length: 250 }, (_, index) => ({ id: index + 1, user_id: 4, delivery_state: "delivered", notification_event: {
      id: index + 1, event_type: "chat_message_created", actor_id: 3, room_id: 5, created_at: new Date(), payload: { chat_message_id: index + 1 },
    } }))
    const result = serializer.serialize(items)
    while (checked.length < items.length || pending.length) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
      expect(active).toBeLessThanOrEqual(8)
      pending.splice(0).reverse().forEach(resolve => resolve())
    }
    expect(await result).toEqual([])
    expect(peak).toBe(8)
    expect(checked).toEqual(items.map(item => item.id))
  })

  it("does not start another authorization batch or hydrate after a lookup failure", async () => {
    const serializer = new NotificationInboxSerializer()
    const canReadPublishedChatMessage = vi.fn().mockRejectedValue(new Error("Access lookup failed"))
    Object.assign(serializer, { circleAccess: { canReadPublishedChatMessage } })
    const items = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, user_id: 4, delivery_state: "delivered", notification_event: {
      id: index + 1, event_type: "chat_message_created", actor_id: 3, room_id: 5, created_at: new Date(), payload: { chat_message_id: index + 1 },
    } }))
    await expect(serializer.serialize(items)).rejects.toThrow("Access lookup failed")
    expect(canReadPublishedChatMessage).toHaveBeenCalledTimes(8)
  })

  it("omits inaccessible Chat notices before loading snapshot identities or content", async () => {
    const serializer = new NotificationInboxSerializer()
    const canReadPublishedChatMessage = vi.fn().mockResolvedValue(false)
    const prisma = {}
    Object.assign(serializer, { prisma, circleAccess: { canReadPublishedChatMessage } })
    const item = { id: 1, user_id: 4, delivery_state: "delivered", notification_event: {
      id: 2, event_type: "chat_message_created", actor_id: 3, room_id: 5, created_at: new Date(),
      payload: { chat_message_id: 6, excerpt: "Retained private text" },
    } }
    expect(await serializer.serialize([item])).toEqual([])
    expect(canReadPublishedChatMessage).toHaveBeenCalledWith(6, 4, expect.any(Date), prisma)
    canReadPublishedChatMessage.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(serializer.serialize([item])).rejects.toThrow("database unavailable")
  })

  it("uses the recipient introduction seen state for introduction notices", async () => {
    const introductionRecipient = {
      findMany: vi.fn().mockResolvedValue([
        { introduction_id: 51, user_id: 1, seen_at: null },
      ]),
    }
    const prisma = {
      introduction: { findUnique: vi.fn().mockResolvedValue({ room_id: 3, entry_id: null, retracted_at: null, recipients: [{ hidden_at: null }] }) },
      document: { findMany: vi.fn().mockResolvedValue([]) },
      entry: { findMany: vi.fn().mockResolvedValue([]) },
      reply: { findMany: vi.fn().mockResolvedValue([]) },
      entryViewState: { findMany: vi.fn().mockResolvedValue([]) },
      roomMembership: { findMany: vi.fn().mockResolvedValue([]) },
      activeStorageAttachment: { findMany: vi.fn().mockResolvedValue([]) },
      chatMessage: { findMany: vi.fn().mockResolvedValue([]) },
      chatPresenceSession: { findMany: vi.fn().mockResolvedValue([]) },
      introductionRecipient,
    }
    const serializer = new NotificationInboxSerializer()
    ;(serializer as any).circleAccess = { canReadPublishedChatMessage: vi.fn().mockResolvedValue(true), resolve: vi.fn().mockResolvedValue({ kind: "member" }) }
    ;(serializer as any).prisma = prisma
    const item = {
      id: 3,
      user_id: 1,
      delivery_state: "delivered",
      delivered_at: new Date("2026-08-11T12:00:00Z"),
      notification_event: {
        id: 12,
        event_type: "introduction_created",
        actor_id: 2,
        room_id: 3,
        entry_id: null,
        payload: { introductionId: "51", note: "You both work with field recordings." },
        target_path: "/app/square/4/introductions?introduction=51",
        created_at: new Date("2026-08-11T12:00:00Z"),
        actor: { id: 2, username: "Mara" },
        room: { id: 3, name: "Circle", porosity: "open" },
      },
    }

    const [unseenRecord] = await serializer.serialize([item])
    const badges = new UnseenContentService()
    Object.assign(badges, {
      prisma: { notificationInboxItem: { findMany: vi.fn().mockResolvedValue([item]) } },
      inboxSerializer: serializer,
    })
    await expect(badges.countForUser(1)).resolves.toEqual({ total: 1, entries: 1, replies: 0 })

    expect(unseenRecord.contentSeen).toBe(false)
    expect(introductionRecipient.findMany).toHaveBeenCalledWith({
      where: { introduction_id: { in: [51] }, user_id: { in: [1] } },
      select: { introduction_id: true, user_id: true, seen_at: true },
    })

    introductionRecipient.findMany.mockResolvedValue([
      { introduction_id: 51, user_id: 1, seen_at: new Date("2026-08-11T12:01:00Z") },
    ])

    const [seenRecord] = await serializer.serialize([item])

    expect(seenRecord.contentSeen).toBe(true)
    await expect(badges.countForUser(1)).resolves.toEqual({ total: 0, entries: 0, replies: 0 })
  })

  it("serializes notice records with display identity, avatars, content, and reply anchors", async () => {
    const content = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "/api/v1/uploads/99" } }],
    }
    const prisma = {
      document: {
        findMany: vi.fn(async ({ where }: { where: { docable_type: string } }) => {
          if (where.docable_type === "Post") return [{ docable_id: 4, content }]
          if (where.docable_type === "Reply") {
            return [
              {
                docable_id: 7,
                content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "reply" }] }] },
              },
            ]
          }
          return []
        }),
      },
      entry: {
        findUnique: vi.fn().mockResolvedValue({ id: 4, status: "published", room_id: 3 }),
        findMany: vi.fn(async () => [
          {
            id: 4,
            user_id: 8,
            created_at: new Date("2026-05-26T12:00:00Z"),
            published_at: new Date("2026-05-27T12:00:00Z"),
            user: { id: 8, username: "PostAuthor" },
          },
        ]),
      },
      reply: {
        findUnique: vi.fn().mockResolvedValue({ entry_id: 4, status: "published" }),
        findMany: vi.fn(async () => [
          {
            id: 7,
            entry_id: 4,
            created_at: new Date("2026-05-28T12:00:00Z"),
            published_at: new Date("2026-05-28T12:00:00Z"),
          },
        ]),
      },
      entryViewState: {
        findMany: vi.fn(async () => [
          {
            user_id: 1,
            entry_id: 4,
            entry_seen_at: null,
            reply_seen_through_at: new Date("2026-05-28T12:00:00Z"),
            reply_seen_through_id: 7,
          },
        ]),
      },
      roomMembership: {
        findMany: vi.fn(async () => [
          { id: 5, user_id: 2, room_id: 3, username_override: "Alt" },
          { id: 6, user_id: 8, room_id: 3, username_override: "Poster" },
        ]),
      },
      activeStorageAttachment: {
        findMany: vi.fn(async ({ where }: { where: { record_type: string } }) => {
          if (where.record_type === "Circle") return [{ record_id: 3, blob_id: 30 }]
          if (where.record_type === "User") return [{ record_id: 2, blob_id: 20 }]
          if (where.record_type === "CircleMembership") return [{ record_id: 5, blob_id: 50 }]
          return []
        }),
      },
    }
    const serializer = new NotificationInboxSerializer()
    ;(serializer as any).circleAccess = { canReadPublishedChatMessage: vi.fn().mockResolvedValue(true), resolve: vi.fn().mockResolvedValue({ kind: "member" }) }
    ;(serializer as any).prisma = prisma

    const [record] = await serializer.serialize([
      {
        id: 1,
        user_id: 1,
        delivery_state: "delivered",
        delivered_at: new Date("2026-05-28T12:00:00Z"),
        notification_event: {
          id: 9,
          event_type: "reply_created",
          actor_id: 2,
          room_id: 3,
          entry_id: null,
          payload: { excerpt: "hello", replyId: 7 },
          target_path: "/app/entries/4#reply-7",
          created_at: new Date("2026-05-28T12:00:00Z"),
          actor: { id: 2, username: "global" },
          room: { id: 3, name: "Circle" },
        },
      },
    ])

    expect(record.contentSeen).toBe(true)
    expect(record.notificationEvent).toMatchObject({
      actorUsername: "Alt",
      actorAvatarUrl: "/api/v1/uploads/50/variants/avatarStripe40",
      roomName: "Circle",
      roomAvatarUrl: "/api/v1/uploads/30/variants/icon160",
      entryId: "4",
      replyId: "7",
      postAuthorUsername: "Poster",
      postCreatedAt: "2026-05-26T12:00:00.000Z",
      postPublishedAt: "2026-05-27T12:00:00.000Z",
    })
    expect((record.notificationEvent.postContent as any).content[0].attrs.src).toBe("/api/v1/uploads/99/variants/w600")
    expect((record.notificationEvent.replyContent as any).content[0].content[0].text).toBe("reply")
  })

  it("uses durable message receipts rather than chat presence to mark notices seen", async () => {
    const eventCreatedAt = new Date("2026-08-11T12:00:00Z")
    const chatPresenceSession = {
      findMany: vi.fn().mockResolvedValue([
        { user_id: 1, room_id: 3, last_seen_at: new Date("2026-08-11T11:59:00Z") },
      ]),
    }
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([]) },
      entry: { findMany: vi.fn().mockResolvedValue([]) },
      reply: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ chat_message_id: 11, status: "published" }) },
      entryViewState: { findMany: vi.fn().mockResolvedValue([]) },
      roomMembership: { findMany: vi.fn().mockResolvedValue([]) },
      activeStorageAttachment: { findMany: vi.fn().mockResolvedValue([]) },
      chatMessage: {
        findUnique: vi.fn().mockResolvedValue({ room_id: 3 }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 11,
            fire_at: new Date("2026-08-18T12:00:00Z"),
            masked_alias: "Pink Panda",
            identity_grants: [{ user_id: 1 }],
          },
        ]),
      },
      chatPresenceSession,
    }
    const serializer = new NotificationInboxSerializer()
    ;(serializer as any).circleAccess = { canReadPublishedChatMessage: vi.fn().mockResolvedValue(true), resolve: vi.fn().mockResolvedValue({ kind: "member" }) }
    ;(serializer as any).prisma = prisma
    const item = {
      id: 2,
      user_id: 1,
      delivery_state: "delivered",
      delivered_at: eventCreatedAt,
      notification_event: {
        id: 10,
        event_type: "chat_message_created",
        actor_id: 2,
        room_id: 3,
        entry_id: null,
        payload: { chat_message_id: 11, excerpt: "hello" },
        target_path: "/app/rooms/3/chat#chat-11",
        created_at: eventCreatedAt,
        actor: { id: 2, username: "Mara" },
        room: { id: 3, name: "Circle", porosity: "open" },
      },
    }

    const [unseenRecord] = await serializer.serialize([item])

    expect(unseenRecord.contentSeen).toBe(false)
    expect(unseenRecord.notificationEvent.targetPath).toBe("/app/rooms/3/chat#chat-11")

    chatPresenceSession.findMany.mockResolvedValue([
      { user_id: 1, room_id: 3, last_seen_at: new Date("2026-08-11T12:01:00Z") },
    ])

    const [stillUnseen] = await serializer.serialize([item])
    expect(stillUnseen.contentSeen).toBe(false)
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 11, fire_at: new Date("2026-08-18T12:00:00Z"), masked_alias: "Pink Panda", identity_grants: [{ user_id: 1 }], read_receipts: [{ user_id: 1 }] } as any,
    ])
    const [seenRecord] = await serializer.serialize([item])
    expect(seenRecord.contentSeen).toBe(true)
    prisma.reply.findMany.mockResolvedValue([{ id: 51, created_at: eventCreatedAt }] as any)
    const replyItem = { ...item, notification_event: { ...item.notification_event,
      event_type: "chat_reply_created", payload: { chat_message_id: 11, replyId: 51 },
      target_path: "/app/rooms/3/chat/messages/11#reply-51",
    } }
    const [unseenReply] = await serializer.serialize([replyItem])
    expect(unseenReply.contentSeen).toBe(false)
    const [seenReply] = await serializer.serialize([{ ...replyItem, seen_at: new Date() }])
    expect(seenReply.contentSeen).toBe(true)
    const badges = new UnseenContentService()
    Object.assign(badges, {
      prisma: { notificationInboxItem: { findMany: vi.fn().mockResolvedValue([replyItem]) } },
      inboxSerializer: serializer,
    })
    expect((await badges.countForUser(1)).total).toBe(1)
    Object.assign(badges, {
      prisma: { notificationInboxItem: { findMany: vi.fn().mockResolvedValue([{ ...replyItem, seen_at: new Date() }]) } },
    })
    expect((await badges.countForUser(1)).total).toBe(0)
    prisma.chatMessage.findMany.mockResolvedValue([])
    const [openedNotice] = await serializer.serialize([{ ...item, seen_at: new Date() } as any])
    expect(openedNotice.contentSeen).toBe(true)
  })
})
