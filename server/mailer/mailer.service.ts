import { Injectable } from "@nestjs/common"
import nodemailer from "nodemailer"

type SmtpConfig = {
  host: string
  port: number
  auth: {
    user: string
    pass: string
  }
}

@Injectable()
export class MailerService {
  private readonly transport = nodemailer.createTransport(this.smtpConfig())

  async sendOtpEmail(email: string, token: string) {
    const html = this.renderOtpTemplate(token)
    await this.transport.sendMail({
      from: this.fromAddress(),
      to: email,
      subject: "Your login code",
      text: `Your login code is ${token}. It expires soon.`,
      html,
    })
  }

  async sendInviteEmail(email: string, token: string, communityName?: string | null) {
    const label = communityName ? ` for ${communityName}` : ""
    const inviteUrl = this.inviteUrl(token)
    const html = this.renderInviteTemplate(inviteUrl, communityName ?? null)
    await this.transport.sendMail({
      from: this.fromAddress(),
      to: email,
      subject: `You've been invited${label}`,
      text: `Use this link to join${label}: ${inviteUrl}`,
      html,
    })
  }

  private smtpConfig(): SmtpConfig {
    return {
      host: process.env.BREVO_SMTP_SERVER ?? "",
      port: Number(process.env.BREVO_SMTP_PORT ?? 587),
      auth: {
        user: process.env.BREVO_SMTP_LOGIN ?? "",
        pass: process.env.BREVO_SMTP_PASSWORD ?? "",
      },
    }
  }

  private fromAddress() {
    return process.env.BREVO_SENDER || process.env.BREVO_SMTP_LOGIN || "no-reply@example.com"
  }

  private appOrigin() {
    return (
      process.env.APP_BASE_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.PLAYWRIGHT_BASE_URL ||
      "https://afire.app"
    ).replace(/\/+$/, "")
  }

  private inviteUrl(token: string) {
    return `${this.appOrigin()}/auth/invite/${encodeURIComponent(token)}`
  }

  private renderOtpTemplate(token: string) {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #f6f4ef; padding: 24px;">
        <div style="max-width: 520px; margin: 0 auto; background: #fffdf7; border: 1px solid #e3ded6; padding: 24px;">
          <h1 style="margin: 0 0 16px; color: #1a2527;">Your login code</h1>
          <p style="margin: 0 0 16px; color: #2f3b3d;">Use this code to sign in. It expires soon.</p>
          <div style="font-size: 32px; letter-spacing: 6px; font-weight: 600; color: #1a2527; margin: 16px 0;">${token}</div>
          <p style="margin: 0; color: #6b726f; font-size: 14px;">If you did not request this, you can ignore this email.</p>
        </div>
      </div>
    `.trim()
  }

  private renderInviteTemplate(inviteUrl: string, communityName: string | null) {
    const label = communityName ? ` to ${communityName}` : ""
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #f6f4ef; padding: 24px;">
        <div style="max-width: 520px; margin: 0 auto; background: #fffdf7; border: 1px solid #e3ded6; padding: 24px;">
          <h1 style="margin: 0 0 16px; color: #1a2527;">You're invited${label}</h1>
          <p style="margin: 0 0 16px; color: #2f3b3d;">Use this link to accept your invite.</p>
          <p style="margin: 16px 0;"><a href="${inviteUrl}" style="color: #b84a1b; font-weight: 600;">Accept invitation</a></p>
          <p style="margin: 0; color: #6b726f; font-size: 14px;">If you weren’t expecting this, you can ignore this email.</p>
        </div>
      </div>
    `.trim()
  }
}
