import { RoomAccessService } from "@server/api/v1/rooms/room-access.service"
import { MembershipsService } from "@server/api/v1/memberships/memberships.service"
import "reflect-metadata"
import { expect, it } from "vitest"
import { PrismaService } from "@server/prisma/prisma.service"
import { RoomRelationshipsService } from "@server/api/v1/rooms/room-relationships.service"
import { RoomsService } from "@server/api/v1/rooms/rooms.service"
import { AuthService } from "@server/api/v1/auth/auth.service"
import { withTestDependencies } from "@tests/backend/helpers/service"

it.each(["activation-first", "deletion-first"])("serializes admission retries and deletion (%s)", async order => {
  const prisma = new PrismaService()
  const now = new Date()
  const user = await prisma.user.create({ data: { email: `${crypto.randomUUID()}@membership.test`, username: "Member", created_at: now, updated_at: now } })
  const room = await prisma.room.create({ data: { name: "Room", owner_id: user.id, created_at: now, updated_at: now } })
  try {
    const invitation = await prisma.roomMemberInvitation.create({ data: { room_id: room.id, user_id: user.id, invited_by_id: user.id, status: "pending", created_at: now, updated_at: now } })
    const invite = await prisma.invite.create({ data: { email: user.email!, room_id: room.id, invite_type: 0, token: crypto.randomUUID(), invited_by_id: user.id, expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })
    const relationships = withTestDependencies(new RoomRelationshipsService(), { prisma })
    const auth = withTestDependencies(new AuthService(), { prisma })
    const failedAcceptance = prisma.$extends({ query: { roomMemberInvitation: { async update() { throw new Error("invitation write failed") } } } })
    const failedAcceptanceService = withTestDependencies(new RoomRelationshipsService(), { prisma: failedAcceptance })
    await expect(failedAcceptanceService.acceptMemberInvitation(room.id, invitation.id, user.id)).rejects.toThrow("invitation write failed")
    expect(await prisma.roomMembership.count({ where: { room_id: room.id } })).toBe(0)
    expect((await prisma.roomMemberInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("pending")
    await Promise.all([
      ...Array.from({ length: 4 }, () => relationships.acceptMemberInvitation(room.id, invitation.id, user.id)),
      ...Array.from({ length: 4 }, () => auth.acceptInvite(invite.token, user.id)),
    ])
    expect(await prisma.roomMembership.count({ where: { room_id: room.id, user_id: user.id } })).toBe(1)
    const membership = await prisma.roomMembership.findFirstOrThrow({ where: { room_id: room.id, user_id: user.id } })
    const memberships = withTestDependencies(new MembershipsService(), { prisma })
    const memberRemoval = withTestDependencies(new RoomsService(), { prisma })
    const removalRace = await Promise.allSettled([
      memberships.enable(user.id, membership.id),
      memberRemoval.removeMember(room.id, user.id, membership.id),
    ])
    expect(removalRace[1].status).toBe("fulfilled")
    expect(await prisma.roomMembership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ disabled: true, revoked_at: expect.any(Date) })
    await expect(memberships.enable(user.id, membership.id)).rejects.toThrow("removed by its owner")
    // Pause enable after its initial read, then remove before its locked recheck.
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: false, revoked_at: null } })
    let readComplete!: () => void
    let resumeRead!: () => void
    const readObserved = new Promise<void>(resolve => { readComplete = resolve })
    const resume = new Promise<void>(resolve => { resumeRead = resolve })
    const staleClient = prisma.$extends({ query: { roomMembership: { async findFirst({ args, query }) {
      const result = await query(args)
      if (args.include?.room) { readComplete(); await resume }
      return result
    } } } })
    const staleMemberships = withTestDependencies(new MembershipsService(), { prisma: staleClient })
    const staleEnable = staleMemberships.enable(user.id, membership.id)
    try {
      await readObserved
      await memberRemoval.removeMember(room.id, user.id, membership.id)
      const denied = expect(staleEnable).rejects.toThrow("removed by its owner")
      resumeRead()
      await denied
    } finally { resumeRead() }
    // Restore this synthetic fixture for the independent reconciliation/deletion cases.
    await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: false, revoked_at: null } })

    await prisma.roomMembershipReconciliation.create({ data: { room_id: room.id, user_id: user.id, canonical_membership_id: membership.id, source_records: [], conflicting_fields: ["access"], review_status: "pending" } })
    await expect(memberships.enable(user.id, membership.id)).rejects.toThrow("requires reconciliation")
    await expect(relationships.acceptMemberInvitation(room.id, invitation.id, user.id)).rejects.toThrow("requires reconciliation")
    await prisma.invite.update({ where: { id: invite.id }, data: { used_at: null } })
    await expect(auth.acceptInvite(invite.token, user.id)).rejects.toThrow("requires reconciliation")
    // Explicit conflict resolution is required before ordinary admission can resume.
    await prisma.roomMembershipReconciliation.updateMany({ where: { room_id: room.id }, data: { review_status: "reviewed" } })
    let release!: () => void
    let locked!: () => void
    let competing!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const acquired = new Promise<void>(resolve => { locked = resolve })
    const attempted = new Promise<void>(resolve => { competing = resolve })
    const coordinated = prisma.$extends({ query: {
      async $queryRaw({ args, query }) {
        if (order === "deletion-first") competing()
        const result = await query(args)
        if (order === "activation-first") { locked(); await held }
        return result
      },
      room: { async updateMany({ args, query }) {
        // Only the deletion marker write participates in the barrier.
        if (!args.data.deleted_at) return query(args)
        if (order === "activation-first") competing()
        const result = await query(args)
        if (order === "deletion-first") { locked(); await held }
        return result
      } },
    } })
    const racingRelationships = withTestDependencies(new RoomRelationshipsService(), { prisma: coordinated })
    const communities = withTestDependencies(new RoomsService(), { prisma: coordinated })
    const activate = () => racingRelationships.acceptMemberInvitation(room.id, invitation.id, user.id)
    const remove = () => communities.deleteRoom(room.id, user.id)
    const first = (order === "activation-first" ? activate() : remove())
    try {
      await acquired
      const second = (order === "activation-first" ? remove() : activate())
      const outcomes = Promise.allSettled([first, second])
      await attempted
      release()
      const results = await outcomes
      expect(results[0].status).toBe("fulfilled")
      expect(results[1].status).toBe(order === "activation-first" ? "fulfilled" : "rejected")
    } finally { release() }
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).deleted_at).not.toBeNull()
    expect(await prisma.roomMembership.count({ where: { room_id: room.id, disabled: false } })).toBe(0)
    await expect(memberships.enable(user.id, membership.id)).rejects.toThrow("Community not found")
    await expect(relationships.acceptMemberInvitation(room.id, invitation.id, user.id)).rejects.toThrow("Community not found")
  } finally {
    await prisma.roomMembershipReconciliation.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMemberInvitation.deleteMany({ where: { room_id: room.id } })
    await prisma.invite.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
})

it("commits manager invitation approval with admission and honors revoked invitations", async () => {
  const prisma = new PrismaService()
  const now = new Date()
  const users = await Promise.all(["Owner", "Invitee"].map(username => prisma.user.create({ data: { email: `${crypto.randomUUID()}@invitation-atomic.test`, username, created_at: now, updated_at: now } })))
  const [owner, target] = users
  const room = await prisma.room.create({ data: { name: "Room", owner_id: owner.id, created_at: now, updated_at: now } })
  try {
    await prisma.roomMembership.create({ data: { room_id: room.id, user_id: owner.id, created_at: now, updated_at: now } })
    const invitation = await prisma.roomMemberInvitation.create({ data: { room_id: room.id, user_id: target.id, invited_by_id: owner.id, status: "pending", created_at: now, updated_at: now } })
    const circleAccess = withTestDependencies(new RoomAccessService(), { prisma })
    const failing = prisma.$extends({ query: { roomMemberInvitation: { async update() { throw new Error("approval write failed") } } } })
    const failedReview = withTestDependencies(new RoomRelationshipsService(), { prisma: failing, circleAccess })
    await expect(failedReview.reviewMemberInvitation(room.id, invitation.id, owner.id, "accepted")).rejects.toThrow("approval write failed")
    expect(await prisma.roomMembership.count({ where: { room_id: room.id, user_id: target.id } })).toBe(0)
    expect((await prisma.roomMemberInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("pending")
    const relationships = withTestDependencies(new RoomRelationshipsService(), { prisma, circleAccess })
    await relationships.reviewMemberInvitation(room.id, invitation.id, owner.id, "revoked")
    await expect(relationships.acceptMemberInvitation(room.id, invitation.id, target.id)).rejects.toThrow("Invitation is not active")
    await relationships.reviewMemberInvitation(room.id, invitation.id, owner.id, "accepted")
    expect(await prisma.roomMembership.count({ where: { room_id: room.id, user_id: target.id, disabled: false } })).toBe(1)
    expect((await prisma.roomMemberInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("accepted")
    const staleManager = withTestDependencies(new RoomRelationshipsService(), { prisma, circleAccess: {
      async requireManager(id: number, actorId: number) {
        const access = await circleAccess.requireManager(id, actorId)
        await prisma.roomMembership.updateMany({ where: { room_id: room.id, user_id: owner.id }, data: { disabled: true } })
        return access
      },
    } })
    await expect(staleManager.reviewMemberInvitation(room.id, invitation.id, owner.id, "revoked")).rejects.toThrow("Circle manager only")
    expect((await prisma.roomMemberInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("accepted")
  } finally {
    await prisma.roomMemberInvitation.deleteMany({ where: { room_id: room.id } })
    await prisma.roomMembership.deleteMany({ where: { room_id: room.id } })
    await prisma.room.delete({ where: { id: room.id } })
    await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await prisma.$disconnect()
  }
})
