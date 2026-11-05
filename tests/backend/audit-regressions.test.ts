import { InviteEmailProcessor } from "@server/mailer/invite-email.processor";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { AuthService } from "@server/api/v1/auth/auth.service";
import { AuthController } from "@server/api/v1/auth/auth.controller";
import { InvitesService } from "@server/api/v1/invites/invites.service";
import { MembershipsService } from "@server/api/v1/memberships/memberships.service";
import { RoomsService } from "@server/api/v1/rooms/rooms.service";
import { HocuspocusService } from "@server/realtime/hocuspocus.service";
import { BossWorkers } from "@server/queue/boss.workers";
import { Hocuspocus } from "@hocuspocus/server";

function inject<T extends object>(service: T, dependencies: object): T {
  return Object.assign(service, dependencies);
}

describe("audit security regressions across service boundaries", () => {
  it("does not return email credentials to the inviter or exchange a previously leaked token for the recipient's account", async () => {
    let storedInvite: any;
    const recipient = { id: 22, username: "recipient", email: "recipient@example.com" };
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 100 }]),
      roomMembership: { findMany: vi.fn(async () => [{ room_id: 100 }]), findFirst: vi.fn(async ({ where }) => where.user_id === 11 ? { id: 4 } : null), create: vi.fn() },
      room: { findUnique: vi.fn(async () => ({ id: 100, name: "Circle" })) },
      user: { findFirst: vi.fn(async () => recipient), findMany: vi.fn(async () => [recipient]) },
      invite: {
        findUnique: vi.fn(async () => storedInvite),
        findFirst: vi.fn(async ({ where }) => where.token && storedInvite?.token === where.token ? storedInvite : null),
        findMany: vi.fn(async () => [storedInvite]),
        create: vi.fn(async ({ data }) => (storedInvite = { id: 1, ...data, used_at: null, room: { id: 100, name: "Circle" }, invited_by: { id: 11, username: "inviter" } })),
        update: vi.fn(),
      },
      oneTimeToken: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) => callback(prisma));
    const mailer = { sendInviteEmail: vi.fn() };
    const boss = { enqueueInTransaction: vi.fn().mockResolvedValue("job") };
    const invites = inject(new InvitesService(), { prisma, boss });
    const created = await invites.createInvite(11, { email: recipient.email, room_id: 100 });
    expect(created).not.toHaveProperty("token");
    expect(mailer.sendInviteEmail).not.toHaveBeenCalled();
    const job = boss.enqueueInTransaction.mock.calls[0][2];
    expect(JSON.stringify(job)).not.toContain(storedInvite.token);
    await inject(new InviteEmailProcessor(), { prisma, mailer }).process(job);
    expect(mailer.sendInviteEmail).toHaveBeenCalledWith(recipient.email, storedInvite.token, "Circle");
    expect((await invites.listInvites(11, {})).invites[0]).not.toHaveProperty("token");
    prisma.invite.findFirst.mockResolvedValue(storedInvite);
    expect(await invites.resendInvite(11, 1)).not.toHaveProperty("token");
    const auth = inject(new AuthService(), { prisma });
    const controller = inject(new AuthController(), { authService: auth });
    for (const headers of [{}, { authorization: `Bearer ${auth.issueAccessToken(11)}` }]) {
      await expect(controller.acceptInvite({ token: storedInvite.token }, { headers } as any, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.oneTimeToken.create).not.toHaveBeenCalled();
    expect(prisma.roomMembership.create).not.toHaveBeenCalled();
    expect(prisma.invite.update).not.toHaveBeenCalled();
  });

  it("owner removal cannot be undone through self-disable followed by self-enable", async () => {
    const membership = { id: 2, user_id: 22, room_id: 100, disabled: false, revoked_at: null as Date | null };
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 100 }]),
      roomMembershipReconciliation: { findUnique: vi.fn().mockResolvedValue(null) },
      room: { findFirst: vi.fn(async () => ({ id: 100, owner_id: 11 })) },
      roomMembership: {
        findFirst: vi.fn(async () => membership),
        update: vi.fn(async ({ data }) => Object.assign(membership, data)),
      },
    };
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) => callback(prisma));
    await inject(new RoomsService(), { prisma }).removeMember(100, 11, 2);
    expect(membership.revoked_at).toBeInstanceOf(Date);
    const memberships = inject(new MembershipsService(), { prisma });
    await expect(memberships.disable(22, 2)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(memberships.enable(22, 2)).rejects.toBeInstanceOf(ForbiddenException);
    expect(membership.disabled).toBe(true);
    expect(prisma.roomMembership.update).toHaveBeenCalledTimes(1);
  });

  it("allows a voluntarily disabled membership to be enabled", async () => {
    const membership = { id: 2, user_id: 22, room_id: 100, disabled: false, revoked_at: null };
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 100 }]),
      roomMembershipReconciliation: { findUnique: vi.fn().mockResolvedValue(null) },
      roomMembership: {
        findFirst: vi.fn(async () => membership),
        update: vi.fn(async ({ data }) => Object.assign(membership, data)),
      },
      activeStorageAttachment: { findFirst: vi.fn(async () => null) },
    };
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) => callback(prisma));
    const memberships = inject(new MembershipsService(), { prisma });
    await memberships.disable(22, 2);
    expect(membership.disabled).toBe(true);
    await memberships.enable(22, 2);
    expect(membership.disabled).toBe(false);
  });

  it("authorizes every connection even when the installed Hocuspocus instance has cached the note", async () => {
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 100, room_id: 100 }]),
      page: { findUnique: vi.fn(async () => ({ id: 1, room_id: 100 })) },
      roomMembership: { findFirst: vi.fn(async ({ where }) => where.user_id === 11 ? { id: 1 } : null) },
      document: { findFirst: vi.fn(async () => null), create: vi.fn() },
    };
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) => callback(prisma));
    const service = inject(new HocuspocusService(), { prisma, authService: { verifyAccessToken: (token: string) => ({ userId: Number(token) }) } });
    service.attach({ on: vi.fn() } as any);
    const server = (service as any).server as Hocuspocus;
    const onAuthenticate = server.configuration.onAuthenticate;
    if (!onAuthenticate) throw new Error("Hocuspocus authentication hook is missing");
    const connect = async (userId: number) => {
      const context = await onAuthenticate({ documentName: "note:1", token: String(userId) } as any);
      return server.createDocument("note:1", {}, String(userId), { isAuthenticated: true, readOnly: false }, context);
    };
    try {
      const first = await connect(11);
      expect(server.documents.get("note:1")).toBe(first);
      await expect(connect(22)).rejects.toThrow("Forbidden");
      expect(prisma.document.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.roomMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { room_id: 100, user_id: 22, disabled: false, room: { deleted_at: null } } }));
      await expect(service.prependPageContentBlocks(1, 22, [{ type: "paragraph" }])).rejects.toThrow("Forbidden");
    } finally {
      for (const document of server.documents.values()) document.destroy();
      server.documents.clear();
      (service as any).wsServer.close();
    }
  });

  it.each(["Post", "Reply"])("rechecks destination and membership before the %s reflection worker writes", async (type) => {
    let destinationCircle = 999;
    let active = true;
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn(async () => [{ id: destinationCircle, room_id: destinationCircle }]),
      reflection: { findUnique: vi.fn(async () => ({ id: 1, page_id: 2, user_id: 11, reflectable_type: type, reflectable_id: 3 })) },
      page: { findUnique: vi.fn(async () => ({ id: 2, room_id: destinationCircle })) },
      entry: { findUnique: vi.fn(async () => ({ id: 3, room_id: 100, user_id: 11, user: { username: "Member" } })) },
      reply: { findUnique: vi.fn(async () => ({ id: 3, entry_id: 3, user_id: 11, user: { username: "Member" }, entry: { room_id: 100 } })) },
      roomMembership: { findFirst: vi.fn(async () => active ? { id: 1 } : null) },
      document: { findFirst: vi.fn(async () => ({ id: 4, content: { type: "doc", content: [{ type: "paragraph" }] } })), update: vi.fn(), create: vi.fn() },
    };
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) => callback(prisma));
    const workers = inject(new BossWorkers(), { prisma });
    await expect(workers.handleReflectionApply({ reflectionId: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    destinationCircle = 100;
    active = false;
    await expect(workers.handleReflectionApply({ reflectionId: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });
});
