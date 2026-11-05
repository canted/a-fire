import { inviteTokenDigest } from "@server/mailer/invite-email.processor";
import { withTestDependencies } from "@tests/backend/helpers/service";
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { InvitesService } from "@server/api/v1/invites/invites.service";
import { vi } from "vitest";

const { captureInviteCreatedMock } = vi.hoisted(() => ({
  captureInviteCreatedMock: vi.fn(),
}));

vi.mock("@server/runtime/posthog", () => ({
  captureInviteCreated: captureInviteCreatedMock,
}));

const makePrisma = () => {
  const prisma = {
  roomMembership: { findMany: vi.fn(), findFirst: vi.fn() },
  invite: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  room: { findUnique: vi.fn() },
  user: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]),
  $transaction: vi.fn(),
};
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  return prisma;
};

const makeMailer = () => ({ sendInviteEmail: vi.fn() });

describe("InvitesService", () => {
  beforeEach(() => {
    captureInviteCreatedMock.mockClear();
  });

  const makeService = (prisma = makePrisma()) => {
    return withTestDependencies(new InvitesService(), {
      prisma,
      mailer: makeMailer(),
      boss: { enqueueInTransaction: vi.fn().mockResolvedValue("job") },
    });
  };

  it("forbids listing when community not in membership", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    await expect(service.listInvites(1, { roomId: 2 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lists invites with filters", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.invite.findMany.mockResolvedValue([
      {
        id: 1,
        email: "test@example.com",
        invite_type: 0,
        token: "tok",
        room: { id: 1, name: "C" },
        invited_by: { id: 2, username: "u" },
        expires_at: new Date(Date.now() + 1000),
        used_at: null,
        created_at: new Date(),
      },
    ]);

    const result = await service.listInvites(1, { status: "active", search: "test" });

    expect(result.invites).toHaveLength(1);
    expect(result.invites[0].status).toBe("active");
    expect(service.prisma.invite.findMany).toHaveBeenCalled();
  });

  it("hides registered user emails when listing invites", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.invite.findMany.mockResolvedValue([
      {
        id: 1,
        email: "jason@example.com",
        invite_type: 0,
        token: "tok",
        room: { id: 1, name: "C" },
        invited_by: { id: 2, username: "u" },
        expires_at: new Date(Date.now() + 1000),
        used_at: null,
        created_at: new Date(),
      },
    ]);
    service.prisma.user.findMany.mockResolvedValue([{ email: "jason@example.com", username: "jason" }]);

    const result = await service.listInvites(1, { roomId: 1 });

    expect(result.invites[0].email).toBeNull();
    expect(result.invites[0].recipient_label).toBe("jason");
    expect(JSON.stringify(result)).not.toContain("jason@example.com");
  });

  it("suggests members from other circles and excludes target circle members", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany
      .mockResolvedValueOnce([
        { id: 1, room_id: 1, room: { id: 1, name: "Target" } },
        { id: 2, room_id: 2, room: { id: 2, name: "Knitting club" } },
        { id: 3, room_id: 3, room: { id: 3, name: "Glassblowers 261" } },
      ])
      .mockResolvedValueOnce([
        {
          id: 10,
          room_id: 2,
          user_id: 8,
          username_override: "Jason",
          room: { id: 2, name: "Knitting club" },
          user: { id: 8, email: "jason@example.com", username: "jason" },
        },
        {
          id: 11,
          room_id: 3,
          user_id: 8,
          username_override: null,
          room: { id: 3, name: "Glassblowers 261" },
          user: { id: 8, email: "jason@example.com", username: "jason" },
        },
        {
          id: 12,
          room_id: 2,
          user_id: 9,
          username_override: null,
          room: { id: 2, name: "Knitting club" },
          user: { id: 9, email: "sarah@example.com", username: "sarah" },
        },
      ])
      .mockResolvedValueOnce([{ user_id: 9 }]);

    const result = await service.listInviteSuggestions(1, { roomId: 1, query: "jason@example.com" });

    expect(result.suggestions).toEqual([
      {
        invitee_membership_id: 10,
        display_name: "Jason",
        shared_communities: [
          { id: 2, name: "Knitting club" },
          { id: 3, name: "Glassblowers 261" },
        ],
      },
    ]);
    expect(service.prisma.roomMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { room_id: { in: [2, 3] }, disabled: false, user_id: { not: 1 } },
      }),
    );
  });

  it("does not expose stored emails in invite suggestions", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany
      .mockResolvedValueOnce([
        { id: 1, room_id: 1, room: { id: 1, name: "Target" } },
        { id: 2, room_id: 2, room: { id: 2, name: "Knitting club" } },
      ])
      .mockResolvedValueOnce([
        {
          id: 10,
          room_id: 2,
          user_id: 8,
          username_override: "Jason",
          room: { id: 2, name: "Knitting club" },
          user: { id: 8, email: "jason@example.com", username: "jason" },
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.listInviteSuggestions(1, { roomId: 1, query: "jason@example.com" });

    expect(result.suggestions).toEqual([
      {
        invitee_membership_id: 10,
        display_name: "Jason",
        shared_communities: [{ id: 2, name: "Knitting club" }],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("jason@example.com");
  });

  it("forbids invite suggestions when the target circle is not a membership", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ id: 2, room_id: 2 }]);

    await expect(service.listInviteSuggestions(1, { roomId: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("creates invites and sends email", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.room.findUnique.mockResolvedValue({ id: 1, name: "C" });
    service.prisma.invite.findFirst.mockResolvedValue(null);
    service.prisma.invite.create.mockResolvedValue({
      id: 1,
      email: "test@example.com",
      invite_type: 0,
      token: "tok",
      room: { id: 1, name: "C" },
      invited_by: { id: 2, username: "u" },
      expires_at: new Date(Date.now() + 1000),
      used_at: null,
      created_at: new Date(),
    });

    const result = await service.createInvite(1, { email: "test@example.com", room_id: 1 });

    expect(result.email).toBe("test@example.com");
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "mail.invite", expect.objectContaining({ tokenDigest: inviteTokenDigest("tok") }));
    expect(captureInviteCreatedMock).toHaveBeenCalledWith({
      userId: 1,
      inviteId: 1,
      inviteType: "room_invite",
      roomId: 1,
    });
  });

  it("creates an invite for an existing user in another community", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.room.findUnique.mockResolvedValue({ id: 1, name: "C" });
    service.prisma.user.findFirst.mockResolvedValue({ id: 8, email: "test@example.com", username: "Jason" });
    service.prisma.roomMembership.findFirst.mockResolvedValue(null);
    service.prisma.invite.findFirst.mockResolvedValue(null);
    service.prisma.invite.create.mockResolvedValue({
      id: 2,
      email: "test@example.com",
      invite_type: 0,
      token: "tok",
      room: { id: 1, name: "C" },
      invited_by: { id: 2, username: "u" },
      expires_at: new Date(Date.now() + 1000),
      used_at: null,
      created_at: new Date(),
    });

    const result = await service.createInvite(1, { email: " Test@Example.com ", room_id: 1 });

    expect(result.email).toBeNull();
    expect(result.recipient_label).toBe("Jason");
    expect(service.prisma.roomMembership.findFirst).toHaveBeenCalledWith({
      where: { room_id: 1, user_id: 8, disabled: false },
    });
    expect(service.prisma.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "test@example.com", room_id: 1 }),
      }),
    );
  });

  it("creates an invite from a suggested membership without exposing the resolved email", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }, { room_id: 2 }]);
    service.prisma.room.findUnique.mockResolvedValue({ id: 1, name: "C" });
    service.prisma.roomMembership.findFirst
      .mockResolvedValueOnce({
        id: 10,
        room_id: 2,
        user_id: 8,
        username_override: "Jason",
        room: { id: 2, name: "Knitting club" },
        user: { id: 8, email: "jason@example.com", username: "jason" },
      })
      .mockResolvedValueOnce(null);
    service.prisma.invite.findFirst.mockResolvedValue(null);
    service.prisma.invite.create.mockResolvedValue({
      id: 2,
      email: "jason@example.com",
      invite_type: 0,
      token: "tok",
      room: { id: 1, name: "C" },
      invited_by: { id: 2, username: "u" },
      expires_at: new Date(Date.now() + 1000),
      used_at: null,
      created_at: new Date(),
    });

    const result = await service.createInvite(1, { invitee_membership_id: 10, room_id: 1 });

    expect(result.email).toBeNull();
    expect(result.recipient_label).toBe("jason");
    expect(JSON.stringify(result)).not.toContain("jason@example.com");
    expect(service.prisma.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "jason@example.com", room_id: 1 }),
      }),
    );
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "mail.invite", expect.objectContaining({ tokenDigest: inviteTokenDigest("tok") }));
  });

  it("rejects invalid invite payloads", async () => {
    const service = makeService();
    await expect(service.createInvite(1, { email: "x", invite_type: "new_room_invite" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.createInvite(1, { email: "x" })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("rejects createInvite when community missing or not member", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 2 }]);
    await expect(service.createInvite(1, { email: "x", room_id: 1 })).rejects.toBeInstanceOf(ForbiddenException);

    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.room.findUnique.mockResolvedValue(null);
    await expect(service.createInvite(1, { email: "x", room_id: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("resends and returns an active duplicate invite for the same community", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.room.findUnique.mockResolvedValue({ id: 1, name: "C" });
    service.prisma.invite.findFirst.mockResolvedValue({
      id: 9,
      email: "x@example.com",
      invite_type: 0,
      token: "tok",
      room: { id: 1, name: "C" },
      invited_by: { id: 2, username: "u" },
      expires_at: new Date(Date.now() + 1000),
      used_at: null,
      created_at: new Date(),
    });

    const result = await service.createInvite(1, { email: "x@example.com", room_id: 1 });

    expect(result.id).toBe(9);
    expect(service.prisma.invite.create).not.toHaveBeenCalled();
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "mail.invite", expect.objectContaining({ tokenDigest: inviteTokenDigest("tok") }));
    expect(captureInviteCreatedMock).not.toHaveBeenCalled();
  });

  it("refreshes expired duplicate invites for the same community", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.room.findUnique.mockResolvedValue({ id: 1, name: "C" });
    service.prisma.invite.findFirst
      .mockResolvedValueOnce({
        id: 9,
        email: "x@example.com",
        invite_type: 0,
        token: "old",
        room: { id: 1, name: "C" },
        invited_by: { id: 2, username: "u" },
        expires_at: new Date(Date.now() - 1000),
        used_at: null,
        created_at: new Date(),
      })
      .mockResolvedValueOnce(null);
    service.prisma.invite.update.mockResolvedValue({
      id: 9,
      email: "x@example.com",
      invite_type: 0,
      token: "new",
      room: { id: 1, name: "C" },
      invited_by: { id: 1, username: "sender" },
      expires_at: new Date(Date.now() + 1000),
      used_at: null,
      created_at: new Date(),
    });

    const result = await service.createInvite(1, { email: "x@example.com", room_id: 1 });

    expect(result.status).toBe("active");
    expect(service.prisma.invite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        data: expect.objectContaining({ used_at: null, invited_by_id: 1 }),
      }),
    );
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "mail.invite", expect.objectContaining({ tokenDigest: inviteTokenDigest("new") }));
  });

  it("rejects invites for existing active members of the target community", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.room.findUnique.mockResolvedValue({ id: 1, name: "C" });
    service.prisma.user.findFirst.mockResolvedValue({ id: 8, email: "member@example.com" });
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 99 });

    await expect(service.createInvite(1, { email: "member@example.com", room_id: 1 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(service.prisma.invite.create).not.toHaveBeenCalled();
  });

  it("propagates unexpected insert conflicts without queuing a delivery", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.room.findUnique.mockResolvedValue({ id: 1, name: "C" });
    service.prisma.invite.findFirst.mockResolvedValue(null);
    service.prisma.invite.create.mockRejectedValue({ code: "P2002" });
    await expect(service.createInvite(1, { email: "race@example.com", room_id: 1 })).rejects.toMatchObject({ code: "P2002" });
    expect(service.boss.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it("expires invites", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);
    service.prisma.invite.findFirst.mockResolvedValue({
      id: 3,
      email: "x",
      invite_type: 0,
      token: "tok",
      room: { id: 1, name: "C" },
      invited_by: { id: 2, username: "u" },
      expires_at: new Date(Date.now() + 100000),
      used_at: null,
      created_at: new Date(),
    });
    service.prisma.invite.update.mockResolvedValue({
      id: 3,
      email: "x",
      invite_type: 0,
      token: "tok",
      room: { id: 1, name: "C" },
      invited_by: { id: 2, username: "u" },
      expires_at: new Date(),
      used_at: null,
      created_at: new Date(),
    });

    const current = await service.prisma.invite.findFirst();
    current.room_id = 1;
    service.prisma.invite.findUnique.mockResolvedValue(current);
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    const result = await service.expireInvite(1, 3);
    expect(result.status).toBe("expired");
  });

  it("resends active invites and blocks expired", async () => {
    const service = makeService();
    service.prisma.roomMembership.findMany.mockResolvedValue([{ room_id: 1 }]);

    service.prisma.invite.findFirst.mockResolvedValue({
      id: 3,
      email: "x",
      invite_type: 0,
      token: "tok",
      room: { id: 1, name: "C" },
      invited_by: { id: 2, username: "u" },
      expires_at: new Date(Date.now() - 1000),
      used_at: null,
      created_at: new Date(),
    });
    const current = await service.prisma.invite.findFirst();
    current.room_id = 1;
    service.prisma.invite.findUnique.mockResolvedValue(current);
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    await expect(service.resendInvite(1, 3)).rejects.toBeInstanceOf(UnprocessableEntityException);

    service.prisma.invite.findFirst.mockResolvedValue({
      id: 3,
      email: "x",
      invite_type: 0,
      token: "tok",
      room: { id: 1, name: "C" },
      invited_by: { id: 2, username: "u" },
      expires_at: new Date(Date.now() + 1000),
      used_at: null,
      created_at: new Date(),
    });

    const fresh = await service.prisma.invite.findFirst();
    fresh.room_id = 1;
    service.prisma.invite.findUnique.mockResolvedValue(fresh);
    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 1 });
    const result = await service.resendInvite(1, 3);
    expect(service.boss.enqueueInTransaction).toHaveBeenCalledWith(service.prisma, "mail.invite", expect.objectContaining({ inviteId: 3 }));
    expect(service.mailer.sendInviteEmail).not.toHaveBeenCalled();
    expect(result.status).toBe("active");
  });
});
