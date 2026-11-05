import { Inject, Injectable } from "@nestjs/common"
import { createHash } from "node:crypto"
import { PrismaService } from "../prisma/prisma.service"
import { MailerService } from "./mailer.service"

export type InviteEmailJob = { inviteId: number; tokenDigest: string }
export const inviteTokenDigest = (token: string) => createHash("sha256").update(token).digest("hex")

@Injectable()
export class InviteEmailProcessor {
  @Inject(PrismaService) private readonly prisma!: PrismaService
  @Inject(MailerService) private readonly mailer!: MailerService

  async process(data: InviteEmailJob): Promise<void> {
    const invite = await this.prisma.invite.findUnique({ where: { id: data.inviteId }, include: { room: true } })
    // Reissue, acceptance, expiry or Room removal can overtake a queued send.
    if (!invite || invite.used_at || invite.expires_at <= new Date() ||
        (invite.room_id && (!invite.room || invite.room.deleted_at)) ||
        inviteTokenDigest(invite.token) !== data.tokenDigest) return
    // Failures propagate to Boss; never mark an unsuccessful SMTP send complete.
    await this.mailer.sendInviteEmail(invite.email, invite.token, invite.room?.name)
  }
}
