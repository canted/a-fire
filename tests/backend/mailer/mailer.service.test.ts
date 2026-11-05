import { vi } from "vitest";

const sendMailMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
  },
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
}));

import { MailerService } from "@server/mailer/mailer.service";

describe("MailerService", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    process.env.BREVO_SENDER = "no-reply@example.com";
    process.env.APP_BASE_URL = "https://example.test";
  });

  it("sends otp email", async () => {
    const service = new MailerService();
    await service.sendOtpEmail("test@example.com", "123456");

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@example.com",
        subject: "Your login code",
      }),
    );
  });

  it("sends invite email", async () => {
    const service = new MailerService();
    await service.sendInviteEmail("test@example.com", "token", "Circle");

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@example.com",
        subject: "You've been invited for Circle",
        text: "Use this link to join for Circle: https://example.test/auth/invite/token",
        html: expect.stringContaining("https://example.test/auth/invite/token"),
      }),
    );
    expect(sendMailMock.mock.calls[0]?.[0]?.html).not.toContain("Use this token");
  });
});
