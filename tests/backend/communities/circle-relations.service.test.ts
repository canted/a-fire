import { withTestDependencies } from "@tests/backend/helpers/service"
import { RoomRelationshipsService } from "@server/api/v1/rooms/room-relationships.service"
import { ForbiddenException } from "@nestjs/common"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { vi } from "vitest"

const NOW = new Date("2026-09-02T12:00:00.000Z")

function makeService() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        { id: 7, username: "Will" },
        { id: 8, username: "Alex" },
      ]),
    },
    room: {
      create: vi.fn().mockResolvedValue({ id: 20, name: "Will, Alex", owner_id: 7, parent_id: 1, porosity: "masked" }),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    roomMembershipReconciliation: { findUnique: vi.fn().mockResolvedValue(null) },
  roomMembership: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: 41 }),
    },
    board: {
      create: vi.fn().mockResolvedValue({ id: 30 }),
      findFirst: vi.fn().mockResolvedValue({ id: 30 }),
      findMany: vi.fn().mockResolvedValue([{ id: 30 }]),
    },
    square: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    roomJoinRequest: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    roomMemberInvitation: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    roomKnock: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    chatPresenceSession: { findMany: vi.fn().mockResolvedValue([]) },
    activeStorageAttachment: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    notificationEvent: { create: vi.fn().mockResolvedValue({ id: 500 }) },
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ id: 20 }]),
    roomVisit: { updateMany: vi.fn() },
  }
  const access = {
    require: vi.fn(),
    findCircle: vi.fn(),
    requireMember: vi.fn().mockResolvedValue({ kind: "member", room: { id: 1 } }),
    requireManager: vi.fn().mockResolvedValue({ kind: "member", canManage: true, room: { id: 20 } }),
    resolve: vi.fn(),
    resolveAdmission: vi.fn(),
  }
  prisma.$transaction.mockImplementation((callback: (client: typeof prisma) => unknown) => callback(prisma))
  const boss = { enqueue: vi.fn().mockResolvedValue("job-1"), enqueueInTransaction: vi.fn().mockResolvedValue("job-1") }
  const service = withTestDependencies(new RoomsService(), {
    prisma,
    circleAccess: access,
    uploadsService: { createAttachmentUpload: vi.fn(), removeAttachment: vi.fn() },
    relationships: withTestDependencies(new RoomRelationshipsService(), { prisma, circleAccess: access, boss }),
  })
  return { service, prisma, access, boss }
}

describe("CommunitiesService circle relationships", () => {
  it("creates a full masked side circle with creator membership and invitations", async () => {
    const { service, prisma } = makeService()
    prisma.roomMembership.findMany.mockResolvedValue([
      { user_id: 7, username_override: "Will here", user: { id: 7, username: "Will" } },
      { user_id: 8, username_override: "Alex here", user: { id: 8, username: "Alex" } },
    ])
    prisma.roomMemberInvitation.create.mockResolvedValue({ id: 50, room_id: 20, user_id: 8, status: "pending" })

    const result = await service.createSideRoom(1, 7, { userIds: [8] }, NOW)

    expect(prisma.room.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ parent_id: 1, owner_id: 7, porosity: "masked", name: "Will here, Alex here" }),
    })
    expect(prisma.roomMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ room_id: 20, user_id: 7, disabled: false }),
    })
    expect(prisma.board.create).not.toHaveBeenCalled()
    expect(prisma.square.create).not.toHaveBeenCalled()

    expect(result.room).not.toHaveProperty("memberBoard")
    expect(result).toEqual(expect.objectContaining({ room: expect.objectContaining({ id: 20, parent_id: 1, porosity: "masked" }) }))
  })

  it("surfaces an invitation alongside independently eligible parent-member access", async () => {
    const { service, prisma, access } = makeService()
    access.require.mockResolvedValue({ kind: "member", room: { id: 1 } })
    access.resolveAdmission.mockResolvedValue({ kind: "visitor", source: "porosity" })
    prisma.room.findMany.mockResolvedValue([
      { id: 20, name: "Garden", porosity: "masked", created_at: NOW },
    ])
    prisma.roomJoinRequest.findUnique.mockResolvedValue(null)
    prisma.roomKnock.findUnique.mockResolvedValue(null)
    prisma.roomMemberInvitation.findUnique.mockResolvedValue({
      id: 90,
      room_id: 20,
      user_id: 8,
      invited_by_id: 7,
      status: "pending",
      created_at: NOW,
      responded_at: null,
      user: { id: 8, username: "Alex" },
      invited_by: { id: 7, username: "Will" },
    })

    const result = await service.listAdjacentRooms(1, 8, NOW)

    expect(result.adjacent_rooms[0]).toEqual(expect.objectContaining({
      viewer_state: "invited",
      viewer_invitation: expect.objectContaining({ id: 90, room_id: 20 }),
      actions: expect.objectContaining({ enter: true, request_join: false, knock: false }),
    }))
  })

  it("rejects selected side-circle invitees who are not active parent members", async () => {
    const { service, prisma } = makeService()
    prisma.roomMembership.findMany.mockResolvedValue([
      { user_id: 7, username_override: null, user: { id: 7, username: "Will" } },
    ])

    await expect(service.createSideRoom(1, 7, { userIds: [8] }, NOW)).rejects.toThrow(
      "Selected users must be active parent-circle members",
    )
    expect(prisma.room.create).not.toHaveBeenCalled()
  })

  it("makes join-freely membership immediate without provisioning a square", async () => {
    const { service, prisma, access } = makeService()
    access.require.mockResolvedValue({ kind: "visitor", room: { id: 20, porosity: "open" } })
    prisma.user.findUnique.mockResolvedValue({ id: 8, username: "Alex" })

    await expect(service.joinRoom(20, 8, NOW)).resolves.toEqual({ state: "member" })

    expect(prisma.roomMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ room_id: 20, user_id: 8, disabled: false }),
    })
    expect(prisma.square.create).not.toHaveBeenCalled()
  })

  it("keeps pending and declined visit-only requests opaque and prevents re-request", async () => {
    const { service, prisma, access } = makeService()
    access.require.mockResolvedValue({ kind: "visitor", room: { id: 20, porosity: "masked" } })
    prisma.roomJoinRequest.findUnique.mockResolvedValue({ id: 70, status: "declined" })

    await expect(service.joinRoom(20, 8, NOW)).resolves.toEqual({ state: "requested" })
    expect(prisma.roomJoinRequest.create).not.toHaveBeenCalled()
    expect(prisma.roomJoinRequest.update).not.toHaveBeenCalled()
  })

  it("notifies the circle manager when a visit-only join request arrives", async () => {
    const { service, prisma, access, boss } = makeService()
    access.require.mockResolvedValue({
      kind: "visitor",
      room: { id: 20, owner_id: 7, parent_id: 1, porosity: "masked" },
    })
    prisma.roomJoinRequest.findUnique.mockResolvedValue(null)
    prisma.roomJoinRequest.create.mockResolvedValue({ id: 70 })

    await service.joinRoom(20, 8, NOW)

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ event_type: "circle_join_requested", target_user_id: 7, actor_id: 8 }),
    })
    expect(boss.enqueue).toHaveBeenCalledWith("notifications.fanout", { eventId: 500 })
  })

  it("lets a manager reverse a declined request and approve it into membership", async () => {
    const { service, prisma } = makeService()
    prisma.room.findFirst.mockResolvedValue({ id: 20 })
    prisma.roomJoinRequest.findUnique.mockResolvedValue({ id: 70, room_id: 20, user_id: 8, status: "declined" })
    prisma.roomJoinRequest.update.mockResolvedValue({
      id: 70,
      room_id: 20,
      user_id: 8,
      status: "approved",
      created_at: NOW,
      reviewed_at: NOW,
      user: { id: 8, username: "Alex" },
    })
    prisma.user.findUnique.mockResolvedValue({ id: 8, username: "Alex" })

    const result = await service.reviewJoinRequest(20, 70, 7, "approved", NOW)

    expect(prisma.roomMembership.create).toHaveBeenCalled()
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ event_type: "circle_join_approved", target_user_id: 8, actor_id: 7 }),
    })
    expect(result.join_request.status).toBe("approved")
  })

  it("reverses an approval back to visitor access when a manager declines it", async () => {
    const { service, prisma } = makeService()
    prisma.room.findFirst.mockResolvedValue({ id: 20 })
    prisma.roomJoinRequest.findUnique.mockResolvedValue({ id: 70, room_id: 20, user_id: 8, status: "approved" })
    prisma.roomJoinRequest.update.mockResolvedValue({
      id: 70,
      room_id: 20,
      user_id: 8,
      status: "declined",
      created_at: NOW,
      reviewed_at: NOW,
      user: { id: 8, username: "Alex" },
    })
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 41 })

    await service.reviewJoinRequest(20, 70, 7, "declined", NOW)

    expect(prisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 41 },
      data: { disabled: true, revoked_at: NOW, updated_at: NOW },
    })
  })

  it("requires target membership to invite into knock-only circles", async () => {
    const { service, access } = makeService()
    access.require.mockResolvedValue({ kind: "visitor", room: { id: 20, parent_id: 1, porosity: "closed" } })

    await expect(service.inviteExistingUser(20, 8, 9, NOW)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("accepts an existing-user invitation with one tap", async () => {
    const { service, prisma } = makeService()
    prisma.roomMemberInvitation.findUnique.mockResolvedValue({
      id: 90,
      room_id: 20,
      user_id: 8,
      invited_by_id: 7,
      status: "pending",
    })
    prisma.roomMemberInvitation.update.mockResolvedValue({
      id: 90,
      room_id: 20,
      user_id: 8,
      invited_by_id: 7,
      status: "accepted",
      created_at: NOW,
      responded_at: NOW,
      user: { id: 8, username: "Alex" },
      invited_by: { id: 7, username: "Will" },
    })
    prisma.user.findUnique.mockResolvedValue({ id: 8, username: "Alex" })

    const result = await service.acceptMemberInvitation(20, 90, 8, NOW)

    expect(prisma.roomMembership.create).toHaveBeenCalled()
    expect(result.invitation.status).toBe("accepted")
  })

  it("notifies an existing user when invited to a side circle", async () => {
    const { service, prisma, access } = makeService()
    access.require.mockResolvedValue({ kind: "member", room: { id: 20, parent_id: 1, porosity: "masked" } })
    access.requireMember.mockResolvedValue({ kind: "member", room: { id: 1 } })
    prisma.user.findUnique.mockResolvedValue({ id: 8 })
    prisma.roomMembership.findFirst
      .mockResolvedValueOnce({ id: 12 })
      .mockResolvedValueOnce(null)
    prisma.roomMemberInvitation.findUnique.mockResolvedValue(null)
    prisma.roomMemberInvitation.create.mockResolvedValue({
      id: 90,
      room_id: 20,
      status: "pending",
      created_at: NOW,
      responded_at: null,
      user: { id: 8, username: "Alex" },
      invited_by: { id: 7, username: "Will" },
    })

    await service.inviteExistingUser(20, 8, 7, NOW)

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ event_type: "circle_member_invited", target_user_id: 8, actor_id: 7 }),
    })
  })

  it("rejects invitations when the target is not an active parent-circle member", async () => {
    const { service, prisma, access } = makeService()
    access.require.mockResolvedValue({ kind: "member", room: { id: 20, parent_id: 1, porosity: "closed" } })
    prisma.user.findUnique.mockResolvedValue({ id: 8 })
    prisma.roomMembership.findFirst.mockResolvedValue(null)

    await expect(service.inviteExistingUser(20, 8, 7, NOW)).rejects.toBeInstanceOf(ForbiddenException)

    expect(prisma.roomMemberInvitation.create).not.toHaveBeenCalled()
  })

  it("suggests that a parent-circle member knock on a closed side circle", async () => {
    const { service, prisma, access, boss } = makeService()
    access.requireMember.mockResolvedValue({
      kind: "member",
      room: { id: 20, parent_id: 1, porosity: "closed" },
    })
    prisma.user.findUnique.mockResolvedValue({ id: 8 })
    prisma.roomMembership.findFirst
      .mockResolvedValueOnce({ id: 12 })
      .mockResolvedValueOnce(null)

    await expect(service.suggestKnock(20, 8, 7, NOW)).resolves.toEqual({ state: "suggested" })

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "circle_knock_suggested",
        target_user_id: 8,
        actor_id: 7,
        room_id: 20,
        target_path: "/app/rooms/1/adjacent-rooms",
      }),
    })
    expect(boss.enqueue).toHaveBeenCalledWith("notifications.fanout", { eventId: 500 })
  })

  it("does not suggest a knock for a non-closed circle", async () => {
    const { service, prisma, access } = makeService()
    access.requireMember.mockResolvedValue({
      kind: "member",
      room: { id: 20, parent_id: 1, porosity: "masked" },
    })

    await expect(service.suggestKnock(20, 8, 7, NOW)).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled()
  })

  it("exposes the viewer's pending membership invitation on circle show", async () => {
    const { service, prisma, access } = makeService()
    access.require.mockResolvedValue({
      kind: "visitor",
      source: "porosity",
      canManage: false,
      canCreateSideCircle: false,
      canViewNotes: false,
      canWriteWall: false,
      canParticipateActivities: false,
      room: { id: 20, name: "Quiet", owner_id: 7, parent_id: 1, porosity: "closed" },
    })
    prisma.board.findFirst.mockResolvedValue(null)
    prisma.room.findUnique.mockResolvedValue({ id: 1, name: "Parent" })
    prisma.roomJoinRequest.findUnique.mockResolvedValue(null)
    prisma.roomMemberInvitation.findUnique.mockResolvedValue({
      id: 90,
      room_id: 20,
      user_id: 8,
      invited_by_id: 7,
      status: "pending",
      created_at: NOW,
      responded_at: null,
      user: { id: 8, username: "Alex" },
      invited_by: { id: 7, username: "Will" },
    })

    const result = await service.fetchRoom(20, 8)

    expect(result.viewer_invitation).toEqual({
      id: 90,
      room_id: 20,
      user: { id: 8, display_username: "Alex", avatar_url: null },
      invited_by: { id: 7, display_username: "Will" },
      status: "pending",
      created_at: NOW.toISOString(),
      responded_at: null,
    })
  })

  it("serializes an admitted knock as persistent visitor access, never membership", async () => {
    const { service, prisma, access } = makeService()
    access.require.mockResolvedValue({
      kind: "visitor",
      source: "knock",
      canManage: false,
      canCreateSideCircle: false,
      canViewNotes: false,
      canWriteWall: false,
      canParticipateActivities: false,
      room: { id: 20, name: "Quiet", owner_id: 7, parent_id: 1, porosity: "closed" },
    })
    prisma.board.findFirst.mockResolvedValue(null)
    prisma.room.findUnique.mockResolvedValue({ id: 1, name: "Parent" })
    prisma.roomJoinRequest.findUnique.mockResolvedValue(null)

    const result = await service.fetchRoom(20, 8)

    expect(result.membership_state).toBe("admitted_visitor")
    expect(result.access).toEqual(expect.objectContaining({ kind: "visitor", can_view_notes: false, can_write_wall: false }))
  })

  it("preserves an admitted knock until a manager revokes it", async () => {
    const { service, prisma, access } = makeService()
    access.requireManager.mockResolvedValue({ kind: "member", canManage: true, room: { id: 20 } })
    prisma.roomKnock.findUnique.mockResolvedValue({ id: 100, room_id: 20, user_id: 8, status: "admitted" })
    prisma.roomKnock.update.mockResolvedValue({
      id: 100,
      room_id: 20,
      user_id: 8,
      status: "revoked",
      created_at: NOW,
      reviewed_at: NOW,
      user: { id: 8, username: "Alex" },
    })

    const result = await service.reviewKnock(20, 100, 7, "revoked", NOW)

    expect(result.knock.status).toBe("revoked")
  })
})


const doorCases = [
  ["open", "open", "visit"], ["open", "masked", "visit"], ["open", "closed", "knock"],
  ["masked", "open", "visit"], ["masked", "masked", "knock"], ["masked", "closed", "hidden"],
  ["closed", "open", "knock"], ["closed", "masked", "hidden"], ["closed", "closed", "hidden"],
] as const
it.each(doorCases)("uses the same visitor discovery and knock policy for %s parent / %s child", async (parent, child, expected) => {
  const { service, prisma, access } = makeService()
  access.require.mockResolvedValue({ kind: "visitor", room: { id: 1, porosity: parent } })
  access.findCircle.mockResolvedValue({ id: 20, parent_id: 1, porosity: child })
  access.resolveAdmission.mockResolvedValue(expected === "visit" ? { kind: "visitor", source: "porosity" } : null)
  prisma.room.findMany.mockResolvedValue([{ id: 20, parent_id: 1, porosity: child }])
  const result = await service.listAdjacentRooms(1, 9, NOW)
  if (expected === "hidden") expect(result.adjacent_rooms).toEqual([])
  else expect(result.adjacent_rooms[0].actions).toMatchObject({ enter: expected === "visit", knock: expected === "knock" })
  const request = service.relationships.knock(20, 9, NOW)
  if (expected === "knock") {
    await expect(request).resolves.toEqual({ state: "requested" })
    expect(prisma.roomKnock.create).toHaveBeenCalledOnce()
  } else {
    await expect(request).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.roomKnock.create).not.toHaveBeenCalled()
  }
})
it.each(["open", "masked", "closed"] as const)("treats parent members as Open for a %s parent", async parent => {
  const { service, prisma, access } = makeService()
  access.require.mockResolvedValue({ kind: "member", room: { id: 1, porosity: parent } })
  access.findCircle.mockResolvedValue({ id: 20, parent_id: 1, porosity: "closed" })
  access.resolveAdmission.mockResolvedValue(null)
  prisma.room.findMany.mockResolvedValue([{ id: 20, parent_id: 1, porosity: "closed" }])
  expect((await service.listAdjacentRooms(1, 9, NOW)).adjacent_rooms[0].actions.knock).toBe(true)
  await expect(service.relationships.knock(20, 9, NOW)).resolves.toEqual({ state: "requested" })
})
