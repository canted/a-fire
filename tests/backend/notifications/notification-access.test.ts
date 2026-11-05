import { expect, it, vi } from "vitest"
import { canReadContentNotice, postIdFor, replyIdFor } from "@server/notifications/notification-access"

it.each([
  { event_type: "mention" },
  { event_type: "post_created", entry_id: -1 },
  { event_type: "post_created", entry_id: 1.5 },
  { event_type: "reply_created", target_path: "/app/entries/not-an-id#reply-2" },
  { event_type: "mention", entry_id: 1, target_path: "/app/entries/2" },
  { event_type: "post_created", entry_id: 1, target_path: "/app/entries/broken" },
])("withholds malformed or conflicting Entry notice targets before database reads: %j", async event => {
  const findUnique = vi.fn()
  expect(await canReadContentNotice({} as never, { entry: { findUnique } } as never, 1, event)).toBe(false)
  expect(findUnique).not.toHaveBeenCalled()
})

it("resolves equivalent legacy targets but rejects inconsistent Reply references", () => {
  expect(postIdFor(null, "/app/posts/42#reply-7")).toBe(42)
  expect(postIdFor(42, "/app/entries/42")).toBe(42)
  expect(replyIdFor({ replyId: 7, reply_id: "7" }, "/app/entries/42#reply-7")).toBe("7")
  expect(replyIdFor({ replyId: 7 }, "/app/entries/42#reply-8")).toBe("")
  expect(replyIdFor({ replyId: 7, reply_id: 8 })).toBe("")
  expect(replyIdFor({ replyId: "invalid" })).toBe("")
})

it.each([
  {}, { round_id: "bad" }, { round_id: -1 }, { activity_id: 2, round_id: 3 },
])("withholds Round notices with invalid identity: %j", async payload => {
  const findUnique = vi.fn()
  expect(await canReadContentNotice({} as never, { round: { findUnique } } as never, 1,
    { event_type: "round_reminder", payload })).toBe(false)
  expect(findUnique).not.toHaveBeenCalled()
})

it.each([
  {}, { introductionId: "bad" }, { introductionId: 1, introduction_id: 2 },
])("withholds malformed introduction targets: %j", async payload => {
  const findUnique = vi.fn()
  expect(await canReadContentNotice({} as never, { introduction: { findUnique } } as never, 1,
    { event_type: "introduction_created", payload })).toBe(false)
  expect(findUnique).not.toHaveBeenCalled()
})

it.each(["/app/rounds/3", "/app/rounds/broken", "/app/rounds/-2"])("rejects conflicting current Round links: %s", async target_path => {
  const findUnique = vi.fn()
  expect(await canReadContentNotice({} as never, { round: { findUnique } } as never, 1,
    { event_type: "round_reminder", payload: { round_id: 2 }, target_path })).toBe(false)
  expect(findUnique).not.toHaveBeenCalled()
})

it("authorizes a stable Round link through the current Room and revokes it on access loss", async () => {
  const database = { round: { findUnique: vi.fn().mockResolvedValue({ room_id: 4, board_id: null, board: null, status: "active" }) } }
  const access = { resolve: vi.fn().mockResolvedValue({ kind: "member" }) }
  const event = { event_type: "round_reminder", room_id: 4, payload: { round_id: 2 }, target_path: "/app/rounds/2" }
  expect(await canReadContentNotice(access as never, database as never, 1, event)).toBe(true)
  expect(access.resolve).toHaveBeenCalledWith(4, 1, expect.any(Date), database)
  access.resolve.mockResolvedValue(null)
  expect(await canReadContentNotice(access as never, database as never, 1, event)).toBe(false)
})

it("rejects Round/Room and route mismatches and propagates access failures", async () => {
  const database = { round: { findUnique: vi.fn().mockResolvedValue({ room_id: 4, status: "active" }) } }
  const access = { resolve: vi.fn().mockRejectedValue(new Error("Database unavailable")) }
  const event = { event_type: "round_reminder", payload: { round_id: 2 }, room_id: 4, target_path: "/app/rounds/2" }
  for (const override of [{ room_id: 7 }, { target_path: "/app/rounds/3" }]) {
    expect(await canReadContentNotice(access as never, database as never, 1, { ...event, ...override })).toBe(false)
  }
  expect(access.resolve).not.toHaveBeenCalled()
  await expect(canReadContentNotice(access as never, database as never, 1, event)).rejects.toThrow("Database unavailable")
})

it("keeps pending invitations actionable without membership and revokes stale notices", async () => {
  const invitation = { user_id: 1, room_id: 3, status: "pending", room: { deleted_at: null as Date | null } }
  const database = { roomMemberInvitation: { findUnique: vi.fn().mockImplementation(async () => invitation) } }
  const access = { resolve: vi.fn().mockResolvedValue(null) }
  const event = { event_type: "circle_member_invited", room_id: 3, payload: { invitation_id: 7 }, target_path: "/app/rooms/3" }
  const readable = () => canReadContentNotice(access as never, database as never, 1, event)
  expect(await readable()).toBe(true)
  expect(access.resolve).not.toHaveBeenCalled()
  expect(await canReadContentNotice(access as never, database as never, 2, event)).toBe(false)
  expect(await canReadContentNotice(access as never, database as never, 1, { ...event, target_path: "/app/rooms/4" })).toBe(false)
  for (const status of ["declined", "revoked", "accepted"]) {
    invitation.status = status
    expect(await readable()).toBe(false)
  }
  access.resolve.mockResolvedValue({ kind: "member" })
  expect(await readable()).toBe(true)
  invitation.room.deleted_at = new Date()
  expect(await readable()).toBe(false)
})

it("checks current management rights and applicant membership for join notices", async () => {
  const request = { room_id: 3, user_id: 2, status: "approved" }
  const database = { roomJoinRequest: { findUnique: vi.fn().mockResolvedValue(request) } }
  const context = { kind: "member", canManage: true }
  const access = { resolve: vi.fn().mockResolvedValue(context) }
  const event = { event_type: "circle_join_requested", target_user_id: 1, room_id: 3, payload: { join_request_id: 7 }, target_path: "/app/rooms/3" }
  expect(await canReadContentNotice(access as never, database as never, 1, event)).toBe(true)
  context.canManage = false
  expect(await canReadContentNotice(access as never, database as never, 1, event)).toBe(false)
  const approval = { ...event, event_type: "circle_join_approved", target_user_id: 2 }
  expect(await canReadContentNotice(access as never, database as never, 2, approval)).toBe(true)
  expect(await canReadContentNotice(access as never, database as never, 1, approval)).toBe(false)
  request.status = "declined"
  expect(await canReadContentNotice(access as never, database as never, 2, approval)).toBe(false)
  request.status = "approved"
  context.kind = "visitor"
  expect(await canReadContentNotice(access as never, database as never, 2, approval)).toBe(false)
})

it("requires a pending Chat save request and a currently visible source message", async () => {
  const request = { message_id: 7, owner_id: 1, status: "pending", message: { room_id: 3, author_id: 1 } }
  const database = { chatSaveRequest: { findUnique: vi.fn().mockResolvedValue(request) } }
  const access = { canReadPublishedChatMessage: vi.fn().mockResolvedValue(true) }
  const event = { event_type: "chat_save_requested", target_user_id: 1, room_id: 3, payload: { chat_save_request_id: 4, chat_message_id: 7 }, target_path: "/app/rooms/3/chat" }
  const readable = () => canReadContentNotice(access as never, database as never, 1, event)
  expect(await readable()).toBe(true)
  expect(access.canReadPublishedChatMessage).toHaveBeenCalledWith(7, 1, expect.any(Date), database)
  access.canReadPublishedChatMessage.mockResolvedValue(false)
  expect(await readable()).toBe(false)
  access.canReadPublishedChatMessage.mockRejectedValueOnce(new Error("Database unavailable"))
  await expect(readable()).rejects.toThrow("Database unavailable")
  access.canReadPublishedChatMessage.mockClear()
  for (const override of [{ target_user_id: 2 }, { room_id: 9 }, { target_path: "/app/rooms/9/chat" }, { payload: { chat_save_request_id: 4, chat_message_id: 8 } }]) {
    expect(await canReadContentNotice(access as never, database as never, 1, { ...event, ...override })).toBe(false)
  }
  request.status = "declined"
  expect(await readable()).toBe(false)
  expect(access.canReadPublishedChatMessage).not.toHaveBeenCalled()
})

it.each(["unrecognized_notice", "chat_message_saved_as_post"])("withholds targetless %s notices", async event_type => {
  expect(await canReadContentNotice({} as never, {} as never, 1, { event_type })).toBe(false)
})

it("requires a published legacy Chat reply attached to its accessible message", async () => {
  const reply = { chat_message_id: 7, status: "published" }
  const database = { reply: { findUnique: vi.fn().mockResolvedValue(reply) }, chatMessage: { findUnique: vi.fn().mockResolvedValue({ room_id: 3 }) } }
  const access = { canReadPublishedChatMessage: vi.fn().mockResolvedValue(true) }
  const event = { event_type: "chat_reply_created", room_id: 3, payload: { chat_message_id: 7, replyId: 4 }, target_path: "/app/rooms/3/chat/messages/7#reply-4" }
  const readable = () => canReadContentNotice(access as never, database as never, 1, event)
  expect(await readable()).toBe(true)
  access.canReadPublishedChatMessage.mockResolvedValue(false)
  expect(await readable()).toBe(false)
  access.canReadPublishedChatMessage.mockClear()
  reply.chat_message_id = 8
  expect(await readable()).toBe(false)
  reply.chat_message_id = 7
  reply.status = "deleted"
  expect(await readable()).toBe(false)
  expect(access.canReadPublishedChatMessage).not.toHaveBeenCalled()
})
