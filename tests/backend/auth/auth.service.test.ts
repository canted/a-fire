import { ForbiddenException, UnauthorizedException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { vi } from "vitest";

const { captureInviteAcceptedMock } = vi.hoisted(() => ({
  captureInviteAcceptedMock: vi.fn(),
}));

vi.mock("@server/runtime/posthog", () => ({
  captureInviteAccepted: captureInviteAcceptedMock,
}));

import { AuthService } from "@server/api/v1/auth/auth.service";

const mockPrisma = () => {
  const prisma = {
  $transaction: vi.fn(),
  $queryRaw: vi.fn().mockResolvedValue([{ id: 10 }]),
  oneTimeToken: {
    count: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  invite: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  roomMembershipReconciliation: { findUnique: vi.fn().mockResolvedValue(null) },
  roomMembership: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  room: {
    findUnique: vi.fn(),
  },
  board: {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([{ id: 77 }]),
  },
  square: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  };
  prisma.$transaction.mockImplementation((callback: (client: typeof prisma) => unknown) => callback(prisma));
  return prisma;
};

const mockMailer = () => ({
  sendOtpEmail: vi.fn(),
});

describe("AuthService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test", JWT_SECRET: "secret" };
    captureInviteAcceptedMock.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("rate limits OTP requests", async () => {
    const prisma = mockPrisma();
    prisma.oneTimeToken.count.mockResolvedValueOnce(1);
    const mailer = mockMailer();

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mailer;

    const result = await service.requestOtp("test@example.com");

    expect(result.rateLimited).toBe(true);
    expect(prisma.oneTimeToken.create).not.toHaveBeenCalled();
    expect(mailer.sendOtpEmail).not.toHaveBeenCalled();
  });

  it("skips OTP when no user or invite", async () => {
    const prisma = mockPrisma();
    prisma.oneTimeToken.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.invite.findFirst.mockResolvedValue(null);
    const mailer = mockMailer();

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mailer;

    const result = await service.requestOtp("test@example.com");

    expect(result.rateLimited).toBe(false);
    expect(prisma.oneTimeToken.create).not.toHaveBeenCalled();
    expect(mailer.sendOtpEmail).not.toHaveBeenCalled();
  });

  it("creates OTP and emails when user exists", async () => {
    const prisma = mockPrisma();
    prisma.oneTimeToken.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.user.findFirst.mockResolvedValue({ id: 1, email: "test@example.com" });
    prisma.invite.findFirst.mockResolvedValue(null);
    const mailer = mockMailer();

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mailer;

    const result = await service.requestOtp("test@example.com");

    expect(result.rateLimited).toBe(false);
    expect(prisma.oneTimeToken.create).toHaveBeenCalled();
    expect(mailer.sendOtpEmail).toHaveBeenCalledWith("test@example.com", expect.any(String));
    const token = (mailer.sendOtpEmail as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(token).toHaveLength(6);
  });

  it("rejects invalid OTP", async () => {
    const prisma = mockPrisma();
    prisma.oneTimeToken.findFirst.mockResolvedValue(null);
    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    await expect(service.verifyOtp("test@example.com", "000000")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("verifies OTP and returns redirect", async () => {
    const prisma = mockPrisma();
    prisma.oneTimeToken.findFirst.mockResolvedValue({
      id: 1,
      token: "123456",
      email: "test@example.com",
      user_id: 7,
      invite_id: null,
      expires_at: new Date(Date.now() + 10000),
      consumed_at: null,
      attempt_count: 0,
    });
    prisma.oneTimeToken.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ id: 7, email: "test@example.com", username: "test" });
    prisma.roomMembership.findFirst.mockResolvedValue(null);

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    const result = await service.verifyOtp("test@example.com", "123456");

    expect(result.userId).toBe(7);
    expect(result.redirect).toBe("/app");
  });

  it("issues and verifies access tokens", () => {
    const prisma = mockPrisma();
    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    const token = service.issueAccessToken(42);
    const verified = service.verifyAccessToken(token);

    expect(verified.userId).toBe(42);
    expect(verified.sessionId).toBeTruthy();
  });

  it("issues refresh tokens", async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 1, email: "test@example.com" });
    prisma.oneTimeToken.create.mockResolvedValue({});

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    const token = await service.issueRefreshToken(1);

    expect(typeof token).toBe("string");
    expect(prisma.oneTimeToken.create).toHaveBeenCalled();
  });

  it("rotates refresh tokens", async () => {
    const prisma = mockPrisma();
    prisma.oneTimeToken.findFirst.mockResolvedValue({
      id: 1,
      token: "refresh",
      purpose: "refresh",
      user_id: 2,
      expires_at: new Date(Date.now() + 10000),
      consumed_at: null,
      created_at: new Date(),
    });
    prisma.oneTimeToken.update.mockResolvedValue({});

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    const refreshSpy = vi.spyOn(service, "issueRefreshToken").mockResolvedValue("new-refresh");
    const accessSpy = vi.spyOn(service, "issueAccessToken").mockReturnValue("access");

    const result = await service.rotateRefreshToken("refresh");

    expect(result.accessToken).toBe("access");
    expect(result.refreshToken).toBe("new-refresh");
    expect(refreshSpy).toHaveBeenCalledWith(2, prisma);
    expect(accessSpy).toHaveBeenCalledWith(2);
  });

  it.each([undefined, 11])("rejects an existing recipient's invite without their session (%s)", async (userId) => {
    const prisma = mockPrisma();
    prisma.invite.findFirst.mockResolvedValue({ id: 1, token: "leaked-token", email: "victim@example.com", expires_at: new Date(Date.now() + 60000) });
    prisma.user.findFirst.mockResolvedValue({ id: 22, email: "victim@example.com" });
    const service = new AuthService();
    (service as any).prisma = prisma;
    await expect(service.acceptInvite("leaked-token", userId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.invite.update).not.toHaveBeenCalled();
    expect(prisma.roomMembership.create).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("accepts invite with non-community type", async () => {
    const prisma = mockPrisma();
    prisma.invite.findFirst.mockResolvedValue({
      id: 1,
      token: "invite",
      email: "test@example.com",
      used_at: null,
      expires_at: new Date(Date.now() + 10000),
      invite_type: 1,
      room_id: null,
    });
    prisma.user.findFirst.mockResolvedValue({ id: 5, email: "test@example.com", username: "test" });
    prisma.invite.update.mockResolvedValue({});

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    const result = await service.acceptInvite("invite", 5);

    expect(result.success).toBe(true);
    expect(result.redirect).toBe("/app/profile");
    expect(result.userId).toBe(5);
    expect(captureInviteAcceptedMock).toHaveBeenCalledWith({
      userId: 5,
      inviteId: 1,
      inviteType: "new_room_invite",
      roomId: null,
      boardId: null,
      isNewUser: false,
    });
  });

  it("accepts invite and provisions community", async () => {
    const prisma = mockPrisma();
    prisma.invite.findFirst.mockResolvedValue({
      id: 1,
      token: "invite",
      email: "new@example.com",
      used_at: null,
      expires_at: new Date(Date.now() + 10000),
      invite_type: 0,
      room_id: 10,
    });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 9, email: "new@example.com", username: "new" });
    prisma.room.findUnique.mockResolvedValue({ id: 10, name: "Circle" });
    prisma.roomMembership.findFirst.mockResolvedValue(null);
    prisma.roomMembership.create.mockResolvedValue({});
    prisma.board.findFirst.mockResolvedValue({ id: 77, room_id: 10, name: "Latest Posts" });
    prisma.square.findFirst.mockResolvedValue(null);
    prisma.square.create.mockResolvedValue({});
    prisma.invite.update.mockResolvedValue({});

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    const result = await service.acceptInvite("invite");

    expect(result.notice).toBe("Welcome to Circle!");
    expect(result.redirect).toBe("/app/rooms/10");
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
    expect(prisma.roomMembership.create).toHaveBeenCalledWith({
      data: {
        room_id: 10,
        user_id: 9,
        disabled: false,
        notify: true,
        created_at: expect.any(Date),
        updated_at: expect.any(Date),
      },
    });
    expect(prisma.square.create).not.toHaveBeenCalled();
    expect(captureInviteAcceptedMock).toHaveBeenCalledWith({
      userId: 9,
      inviteId: 1,
      inviteType: "room_invite",
      roomId: 10,
      boardId: null,
      isNewUser: true,
    });
  });

  it("accepts invite for an existing user and adds them to the invited community", async () => {
    const prisma = mockPrisma();
    prisma.invite.findFirst.mockResolvedValue({
      id: 1,
      token: "invite",
      email: "existing@example.com",
      used_at: null,
      expires_at: new Date(Date.now() + 10000),
      invite_type: 0,
      room_id: 10,
    });
    prisma.user.findFirst.mockResolvedValue({ id: 9, email: "existing@example.com", username: "existing" });
    prisma.room.findUnique.mockResolvedValue({ id: 10, name: "Circle" });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 88 });
    prisma.roomMembership.update.mockResolvedValue({});
    prisma.board.findFirst.mockResolvedValue({ id: 77, room_id: 10, name: "Latest Posts" });
    prisma.square.findFirst.mockResolvedValue({ id: 12 });
    prisma.invite.update.mockResolvedValue({});

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    const result = await service.acceptInvite("invite", 9);

    expect(result.notice).toBe("Welcome to Circle!");
    expect(result.redirect).toBe("/app/rooms/10");
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.roomMembership.findFirst).toHaveBeenCalledWith({
      where: { room_id: 10, user_id: 9 },
      select: { id: true, revoked_at: true },
    });
    expect(prisma.roomMembership.update).toHaveBeenCalledWith({
      where: { id: 88, revoked_at: null },
      data: { disabled: false, revoked_at: null, updated_at: expect.any(Date) },
    });
    expect(captureInviteAcceptedMock).toHaveBeenCalledWith({
      userId: 9,
      inviteId: 1,
      inviteType: "room_invite",
      roomId: 10,
      boardId: null,
      isNewUser: false,
    });
  });

  it("redirects the authenticated recipient when they reopen an already used community invite", async () => {
    const prisma = mockPrisma();
    prisma.invite.findFirst.mockResolvedValue({
      id: 1,
      token: "invite",
      email: "existing@example.com",
      used_at: new Date(),
      expires_at: new Date(Date.now() + 10000),
      invite_type: 0,
      room_id: 10,
    });
    prisma.user.findUnique.mockResolvedValue({ id: 9, email: "existing@example.com", username: "existing" });
    prisma.room.findUnique.mockResolvedValue({ id: 10, name: "Circle" });
    prisma.roomMembership.findFirst.mockResolvedValue({ id: 88 });
    prisma.board.findFirst.mockResolvedValue({ id: 77, room_id: 10, name: "Latest Posts" });
    prisma.square.findFirst.mockResolvedValue({ id: 12 });

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    const result = await service.acceptInvite("invite", 9);

    expect(result.success).toBe(true);
    expect(result.notice).toBe("Welcome to Circle!");
    expect(result.redirect).toBe("/app/rooms/10");
    expect(prisma.board.findFirst).not.toHaveBeenCalled();
    expect(result.userId).toBe(9);
    expect(prisma.roomMembership.findFirst).toHaveBeenCalledWith({
      where: { room_id: 10, user_id: 9, disabled: false },
      select: { id: true },
    });
    expect(prisma.invite.update).not.toHaveBeenCalled();
    expect(captureInviteAcceptedMock).not.toHaveBeenCalled();
  });

  it("does not let a different authenticated user reuse an already used invite", async () => {
    const prisma = mockPrisma();
    prisma.invite.findFirst.mockResolvedValue({
      id: 1,
      token: "invite",
      email: "existing@example.com",
      used_at: new Date(),
      expires_at: new Date(Date.now() + 10000),
      invite_type: 0,
      room_id: 10,
    });
    prisma.user.findUnique.mockResolvedValue({ id: 12, email: "other@example.com", username: "other" });

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    await expect(service.acceptInvite("invite", 12)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.invite.update).not.toHaveBeenCalled();
  });

  it("throws when invite missing or invalid", async () => {
    const prisma = mockPrisma();
    prisma.invite.findFirst.mockResolvedValue(null);

    const service = new AuthService();
    (service as any).prisma = prisma;
    (service as any).mailer = mockMailer();

    await expect(service.acceptInvite("missing")).rejects.toBeInstanceOf(NotFoundException);

    prisma.invite.findFirst.mockResolvedValue({
      id: 1,
      token: "invite",
      email: "test@example.com",
      used_at: new Date(),
      expires_at: new Date(Date.now() + 10000),
      invite_type: 1,
      room_id: null,
    });
    await expect(service.acceptInvite("invite")).rejects.toBeInstanceOf(UnprocessableEntityException);

    prisma.invite.findFirst.mockResolvedValue({
      id: 1,
      token: "invite",
      email: "test@example.com",
      used_at: null,
      expires_at: new Date(Date.now() - 10000),
      invite_type: 1,
      room_id: null,
    });
    await expect(service.acceptInvite("invite")).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
