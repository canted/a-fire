import { activateRoomMembership } from "../rooms/room-membership";
import type { Prisma } from "@prisma/client";
import { withActiveRoomTransaction } from "../rooms/room-membership-transaction";
import {
  Inject,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHmac, randomInt, randomUUID } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { MailerService } from "../../../mailer/mailer.service";
import { captureInviteAccepted } from "../../../runtime/posthog";

const TOKEN_LENGTH = 6;
const TOKEN_EXPIRATION_MINUTES = 5;
const MAX_PER_HOUR = 5;
const MIN_INTERVAL_SECONDS = 30;
const INVITE_PURPOSE = "invite";
const LOGIN_PURPOSE = "login";
const REFRESH_PURPOSE = "refresh";

const DEFAULT_JWT_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90;

function nowPlusMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = base64Url(JSON.stringify({ ...payload, exp }));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token: string, secret: string): { payload: Record<string, unknown> } {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) throw new UnauthorizedException("Invalid token");
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (expected !== signature) throw new UnauthorizedException("Invalid token");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException("Token expired");
  }
  return { payload };
}

@Injectable()
export class AuthService {
  @Inject(PrismaService)
  private readonly prisma!: PrismaService;

  @Inject(MailerService)
  private readonly mailer!: MailerService;

  async requestOtp(email: string): Promise<{ rateLimited: boolean }> {
    const normalized = email.toLowerCase().trim();
    if (process.env.NODE_ENV === "test") {
      // eslint-disable-next-line no-console
      console.info(
        `[OTP][check] email=${normalized} node_env=${process.env.NODE_ENV}`,
      );
    }
    const recent = await this.prisma.oneTimeToken.count({
      where: {
        email: normalized,
        purpose: { in: [INVITE_PURPOSE, LOGIN_PURPOSE] },
        created_at: {
          gt: new Date(Date.now() - MIN_INTERVAL_SECONDS * 1000),
        },
      },
    });
    if (recent > 0) return { rateLimited: true };

    const hourly = await this.prisma.oneTimeToken.count({
      where: {
        email: normalized,
        purpose: { in: [INVITE_PURPOSE, LOGIN_PURPOSE] },
        created_at: {
          gt: new Date(Date.now() - 60 * 60 * 1000),
        },
      },
    });
    if (hourly >= MAX_PER_HOUR) return { rateLimited: true };

    const user = await this.prisma.user.findFirst({ where: { email: normalized } });
    const invite = await this.prisma.invite.findFirst({
      where: {
        email: normalized,
        used_at: null,
        expires_at: { gt: new Date() },
      },
    });

    if (process.env.NODE_ENV === "test") {
      // eslint-disable-next-line no-console
      console.info(`[OTP][lookup] email=${normalized} user=${user ? "yes" : "no"} invite=${invite ? "yes" : "no"}`)
    }

    if (!user && !invite) return { rateLimited: false };

    const token = randomInt(0, 10 ** TOKEN_LENGTH)
      .toString()
      .padStart(TOKEN_LENGTH, "0");

    await this.prisma.oneTimeToken.create({
      data: {
        email: normalized,
        token,
        user_id: user?.id ?? null,
        invite_id: invite?.id ?? null,
        purpose: invite ? INVITE_PURPOSE : LOGIN_PURPOSE,
        expires_at: nowPlusMinutes(TOKEN_EXPIRATION_MINUTES),
        sent_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.info(`[OTP] email=${normalized} code=${token}`);
    }

    await this.mailer.sendOtpEmail(normalized, token);

    return { rateLimited: false };
  }

  async verifyOtp(email: string, token: string): Promise<{ userId: number; redirect: string | null }> {
    const normalized = this.normalizeEmail(email);
    const lookup = { token, email: normalized, purpose: { in: [INVITE_PURPOSE, LOGIN_PURPOSE] } };
    const hint = await this.prisma.oneTimeToken.findFirst({ where: lookup, orderBy: [{ created_at: "desc" }, { id: "desc" }] });
    if (!hint) throw new UnauthorizedException("Invalid or expired code.");
    const inviteHint = !hint.user_id && hint.invite_id
      ? await this.prisma.invite.findUnique({ where: { id: hint.invite_id } }) : null;
    const verify = async (transaction: Prisma.TransactionClient) => {
      // Match invitation acceptance's Room -> invitation order before locking the code.
      if (inviteHint) await transaction.$queryRaw`SELECT id FROM invites WHERE id = ${inviteHint.id} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM one_time_tokens WHERE id = ${hint.id} FOR UPDATE`;
      const record = await transaction.oneTimeToken.findFirst({ where: { ...lookup, id: hint.id } });
      if (!record || record.expires_at <= new Date() || record.consumed_at ||
          record.user_id !== hint.user_id || record.invite_id !== hint.invite_id) {
        throw new UnauthorizedException("Invalid or expired code.");
      }
      let user: { id: number; email: string; username: string } | null = record.user_id ? await transaction.user.findUnique({ where: { id: record.user_id } }) : null;
      if (!user && record.invite_id && inviteHint) {
        const invite = await transaction.invite.findUnique({ where: { id: record.invite_id } });
        if (!invite || invite.used_at || invite.expires_at <= new Date() ||
            this.normalizeEmail(invite.email) !== normalized || invite.room_id !== inviteHint.room_id ||
            invite.invite_type !== inviteHint.invite_type) {
          throw new UnauthorizedException("Invalid or expired invitation.");
        }
        user = (await this.findOrCreateUserForInvite(invite.email, transaction)).user;
      }
      if (!user || this.normalizeEmail(user.email) !== normalized) throw new UnauthorizedException("Unable to sign in with that code.");
      await transaction.oneTimeToken.update({
        where: { id: record.id },
        data: { attempt_count: { increment: 1 }, consumed_at: new Date(), updated_at: new Date() },
      });
      return user.id;
    };
    const userId = inviteHint?.invite_type === 0 && inviteHint.room_id
      ? await withActiveRoomTransaction(this.prisma, inviteHint.room_id, verify)
      : await this.prisma.$transaction(verify);
    return { userId, redirect: await this.defaultRedirect(userId) };
  }

  issueAccessToken(userId: number): string {
    const secret = process.env.JWT_SECRET || "dev-secret";
    return signToken({ sub: String(userId), jti: randomUUID() }, secret, DEFAULT_JWT_TTL_SECONDS);
  }

  verifyAccessToken(token: string): { userId: number; sessionId: string | null; exp: number | null } {
    const secret = process.env.JWT_SECRET || "dev-secret";
    const { payload } = verifyToken(token, secret);
    const subject = payload.sub;
    const userId = typeof subject === "string" ? Number(subject) : null;
    if (!userId || Number.isNaN(userId)) throw new UnauthorizedException("Invalid token");
    const sessionId = typeof payload.jti === "string" ? payload.jti : null;
    const exp = typeof payload.exp === "number" ? payload.exp : null;
    return { userId, sessionId, exp };
  }

  async issueRefreshToken(userId: number, database: Prisma.TransactionClient = this.prisma): Promise<string> {
    const user = await database.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("Invalid token");

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

    await database.oneTimeToken.create({
      data: {
        email: user.email,
        token,
        user_id: user.id,
        invite_id: null,
        purpose: REFRESH_PURPOSE,
        expires_at: expiresAt,
        sent_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    return token;
  }

  async rotateRefreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return this.prisma.$transaction(async transaction => {
      const candidates = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM one_time_tokens WHERE token = ${refreshToken} AND purpose = ${REFRESH_PURPOSE}
        ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE
      `;
      if (!candidates.length) throw new UnauthorizedException("Invalid token");
      const record = await transaction.oneTimeToken.findFirst({
        where: { id: candidates[0].id, token: refreshToken, purpose: REFRESH_PURPOSE },
      });
      if (!record || !record.user_id || record.consumed_at) throw new UnauthorizedException("Invalid token");
      if (record.expires_at <= new Date()) throw new UnauthorizedException("Token expired");
      await transaction.oneTimeToken.update({
        where: { id: record.id },
        data: { consumed_at: new Date(), updated_at: new Date() },
      });
      const newRefreshToken = await this.issueRefreshToken(record.user_id, transaction);
      const accessToken = this.issueAccessToken(record.user_id);
      return { accessToken, refreshToken: newRefreshToken };
    });
  }

  async acceptInvite(
    token: string,
    authenticatedUserId?: number | null,
  ): Promise<{ success: boolean; redirect: string; notice?: string | null; userId: number }> {
    // Lock ordering matches Room deletion: Room first, then its invitation.
    const hint = await this.prisma.invite.findFirst({ where: { token } });
    if (!hint) throw new NotFoundException("Invite not found.");
    const accept = async (transaction: Prisma.TransactionClient) => {
      const locked = await transaction.$queryRaw<Array<{ id: number }>>`SELECT id FROM invites WHERE id = ${hint.id} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException("Invite not found.");
      const invite = await transaction.invite.findFirst({ where: { id: hint.id, token } });
      if (!invite) throw new NotFoundException("Invite not found.");
      if (invite.room_id !== hint.room_id || invite.invite_type !== hint.invite_type) {
        throw new UnprocessableEntityException("Invitation changed. Reopen the invitation.");
      }
      if (invite.used_at || invite.expires_at <= new Date()) {
        const existingRecipientRedirect = await this.redirectForAuthenticatedInviteRecipient(invite, authenticatedUserId, transaction);
        if (existingRecipientRedirect) return { response: existingRecipientRedirect, accepted: null };
        if (invite.used_at) throw new UnprocessableEntityException("This invitation has already been used.");
        throw new UnprocessableEntityException("This invitation has expired.");
      }

      const result = await this.findOrCreateUserForInvite(invite.email, transaction);
      const user = result.user;
      if (!result.created && user.id !== authenticatedUserId) {
        throw new ForbiddenException("Sign in with the email that received this invitation, then reopen the invite link.");
      }

      let redirect = "/app/profile";
      let notice: string | null = null;

      if (invite.invite_type === 0 && invite.room_id) {
        const community = await transaction.room.findUnique({ where: { id: invite.room_id, deleted_at: null } });
        if (!community) throw new UnprocessableEntityException("Community not found");

        await activateRoomMembership(transaction, community.id, user, new Date());

        redirect = `/app/rooms/${community.id}`;

        notice = `Welcome to ${community.name ?? "your circle"}!`;
      }

      await transaction.invite.update({
        where: { id: invite.id },
        data: { used_at: new Date(), updated_at: new Date() },
      });

      return {
        response: { success: true, redirect, notice, userId: user.id },
        accepted: {
          userId: user.id, inviteId: invite.id,
          inviteType: invite.invite_type === 1 ? "new_room_invite" as const : "room_invite" as const,
          roomId: invite.room_id ?? null, boardId: null, isNewUser: result.created,
        },
      };
    };
    const result = hint.invite_type === 0 && hint.room_id
      ? await withActiveRoomTransaction(this.prisma, hint.room_id, accept)
      : await this.prisma.$transaction(accept);
    if (result.accepted) captureInviteAccepted(result.accepted);
    return result.response;
  }

  private async redirectForAuthenticatedInviteRecipient(
    invite: { email: string; invite_type: number; room_id: number | null },
    authenticatedUserId?: number | null,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<{ success: boolean; redirect: string; notice?: string | null; userId: number } | null> {
    if (!authenticatedUserId) return null;

    const user = await database.user.findUnique({ where: { id: authenticatedUserId } });
    if (!user || this.normalizeEmail(user.email) !== this.normalizeEmail(invite.email)) return null;

    if (invite.invite_type !== 0 || !invite.room_id) {
      return {
        success: true,
        redirect: (await this.defaultRedirect(user.id)) ?? "/app/profile",
        notice: "You're already signed in.",
        userId: user.id,
      };
    }

    const community = await database.room.findUnique({ where: { id: invite.room_id, deleted_at: null } });
    if (!community) return null;

    const activeMembership = await database.roomMembership.findFirst({
      where: { room_id: community.id, user_id: user.id, disabled: false },
      select: { id: true },
    });
    if (!activeMembership) return null;

    return {
      success: true,
      redirect: `/app/rooms/${community.id}`,
      notice: `Welcome to ${community.name ?? "your circle"}!`,
      userId: user.id,
    };
  }

  private async defaultRedirect(_userId: number): Promise<string | null> {
    return "/app";
  }

  private normalizeEmail(email: string | null | undefined): string {
    return (email ?? "").toLowerCase().trim();
  }

  private async findOrCreateUserForInvite(
    email: string,
    database: Prisma.TransactionClient,
  ): Promise<{ user: { id: number; email: string; username: string }; created: boolean }> {
    const normalized = this.normalizeEmail(email);
    const existing = await database.user.findFirst({ where: { email: normalized } });
    if (existing) return { user: existing, created: false };

    // Distinct invitations/OTP codes have different row locks but can create the
    // same account. Hold this email-scoped lock through the caller's transaction.
    await database.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`invite-account:${normalized}`}, 0))`;
    const concurrent = await database.user.findFirst({ where: { email: normalized } });
    if (concurrent) return { user: concurrent, created: false };

    const base = normalized.split("@")[0]?.replace(/[^a-z0-9]/gi, "") || "user";
    let username = base.toLowerCase();
    let counter = 1;
    while (await database.user.findFirst({ where: { username } })) {
      username = `${base}${counter}`;
      counter += 1;
    }

    const created = await database.user.create({
      data: {
        email: normalized,
        username,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    return { user: created, created: true };
  }
}
