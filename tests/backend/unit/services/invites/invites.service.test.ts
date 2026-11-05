import { describe, expect, it, vi } from "vitest"
import { InvitesService } from "@server/api/v1/invites/invites.service"

describe("InvitesService", () => {
  it("lists invites for a community", async () => {
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 4 }]),
      roomMembership: { findMany: vi.fn().mockResolvedValue([{ room_id: 3 }]) },
      invite: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 9,
            email: "test@example.com",
            invite_type: 0,
            token: "token",
            room: { id: 3, name: "Test" },
            invited_by: { id: 2, username: "owner" },
            expires_at: new Date(Date.now() + 1000),
            used_at: null,
            created_at: new Date("2026-01-01T00:00:00Z"),
          },
        ]),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    }

    prisma.$transaction.mockImplementation(callback => callback(prisma))
    const service = new InvitesService()
    ;(service as any).boss = { enqueueInTransaction: vi.fn().mockResolvedValue("job") }
    ;(service as any).prisma = prisma
    ;(service as any).mailer = { sendInviteEmail: vi.fn() }

    const result = await service.listInvites(2, { roomId: 3 })
    expect(prisma.invite.findMany).toHaveBeenCalled()
    expect(result.permissions.new_room_invite_allowed).toBe(false)
    expect(result.invites[0]?.invite_type).toBe("room_invite")
  })

  it("creates a community invite", async () => {
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 4 }]),
      roomMembership: {
        findMany: vi.fn().mockResolvedValue([{ room_id: 4 }]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      room: { findUnique: vi.fn().mockResolvedValue({ id: 4, name: "Test" }) },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      invite: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 10,
          email: "test@example.com",
          invite_type: 0,
          token: "token",
          room: { id: 4, name: "Test" },
          invited_by: { id: 2, username: "owner" },
          expires_at: new Date(Date.now() + 1000),
          used_at: null,
          created_at: new Date("2026-01-01T00:00:00Z"),
        }),
      },
    }

    prisma.$transaction.mockImplementation(callback => callback(prisma))
    const service = new InvitesService()
    ;(service as any).boss = { enqueueInTransaction: vi.fn().mockResolvedValue("job") }
    ;(service as any).prisma = prisma
    ;(service as any).mailer = { sendInviteEmail: vi.fn() }

    const invite = await service.createInvite(2, {
      email: "test@example.com",
      invite_type: "room_invite",
      room_id: 4,
    })

    expect(prisma.invite.create).toHaveBeenCalled()
    expect(invite.room?.id).toBe(4)
  })
})
