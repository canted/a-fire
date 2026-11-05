import { expect, test, type Browser, type Page } from "@playwright/test";
import { faker } from "@faker-js/faker";
import { createUserCommunityFixture } from "../fixtures/factory";
import { prisma } from "../factories";
import { latestOtp } from "../fixtures/otp";
import { E2E_MEMBER_EMAIL } from "../config";

const storageStatePath = "tests/e2e/.auth/state.json";

test.describe("invited member onboarding (Playwright)", () => {
  test.use({ storageState: storageStatePath });
  test.setTimeout(60_000);

  async function sendInviteFromCommunity(page: Page, contextRoomId: number, email: string) {
    await page.goto(`/app/rooms/${contextRoomId}/invites`, { waitUntil: "domcontentloaded" });

    const emailInput = page.getByRole("textbox", { name: "Invite email or person" });
    await emailInput.fill(email);
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/v1/invites") && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Send invite" }).click(),
    ]);

    await expect(page.getByText("Invitation created. Email delivery is pending.")).toBeVisible();

    const invitesBlock = page;
    const recipientUser = await prisma.user.findUnique({
      where: { email },
      select: { username: true },
    });
    const visibleRecipient = recipientUser?.username ?? email;
    await expect(invitesBlock.getByText(visibleRecipient)).toBeVisible();
    if (recipientUser) {
      await expect(invitesBlock.getByText(email)).toBeHidden();
    }

    const invite = await prisma.invite.findFirst({
      where: { email, room_id: contextRoomId },
      orderBy: { created_at: "desc" },
    });
    expect(invite?.token).toBeTruthy();
    return invite?.token ?? "";
  }

  async function openInviteLink(browser: Browser, baseURL: string | undefined, token: string) {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(new URL(`/auth/invite/${token}`, baseURL ?? "http://127.0.0.1:5174").toString(), {
      waitUntil: "domcontentloaded",
    });
    return { context, page };
  }

  test("accepts a new invitee into the circle with one click", async ({ browser, page, baseURL }) => {
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Invite Circle ${faker.string.alphanumeric(6)}`,
      boardName: "Latest Posts",
      skipEmailCleanup: true,
    });
    const inviteeEmail = faker.internet.email().toLowerCase();
    const token = await sendInviteFromCommunity(page, fixture.roomId, inviteeEmail);

    const invitee = await openInviteLink(browser, baseURL, token);
    try {
      await Promise.all([
        invitee.page.waitForURL(new RegExp(`/app/rooms/${fixture.roomId}`), { timeout: 15_000 }),
        invitee.page.getByRole("button", { name: "Accept invitation" }).click(),
      ]);
      await expect(invitee.page.getByRole("heading", { name: "Set up your account" })).toBeHidden();
      await expect(invitee.page.getByRole("button", { name: "Add entry" })).toBeVisible({ timeout: 10_000 });
      await expect(invitee.page.getByRole("region", { name: "Wall toolbar" })).toHaveCount(0);
      await expect(invitee.page.getByRole("button", { name: "Open Room details" })).toBeVisible({ timeout: 10_000 });
      await expect(invitee.page.getByText(fixture.postText, { exact: false })).toBeVisible();
    } finally {
      await invitee.context.close();
    }
  });

  test("requires recipient sign-in before accepting an existing user", async ({
    browser,
    page,
    baseURL,
  }) => {
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Existing Invite Circle ${faker.string.alphanumeric(6)}`,
      boardName: "Latest Posts",
      skipEmailCleanup: true,
    });
    const inviteeEmail = faker.internet.email().toLowerCase();
    await createUserCommunityFixture({
      email: inviteeEmail,
      roomName: `E2E Invitee Existing Circle ${faker.string.alphanumeric(6)}`,
      boardName: "Latest Posts",
      skipEmailCleanup: true,
    });
    const token = await sendInviteFromCommunity(page, fixture.roomId, inviteeEmail);

    const invitee = await openInviteLink(browser, baseURL, token);
    try {
      await invitee.page.getByRole("button", { name: "Accept invitation" }).click();
      await expect(invitee.page.getByText(/sign in with the email that received this invitation/i)).toBeVisible();
      await invitee.page.getByRole("button", { name: "Sign in", exact: true }).click();
      await invitee.page.getByPlaceholder("you@example.com").fill(inviteeEmail);
      await invitee.page.getByRole("button", { name: /continue/i }).click();
      await invitee.page.waitForURL(/\/auth\/verify/);
      await invitee.page.getByRole("textbox").first().fill(await latestOtp(inviteeEmail));
      await invitee.page.getByRole("button", { name: /sign in/i }).click();
      await invitee.page.waitForURL(/\/app(?:\/|$)/);
      await invitee.page.goto(new URL(`/auth/invite/${token}`, baseURL ?? "http://127.0.0.1:5174").toString());
      const boardUrl = new RegExp(`/app/rooms/${fixture.roomId}`);
      await Promise.all([
        invitee.page.waitForURL(boardUrl, { timeout: 15_000 }),
        invitee.page.getByRole("button", { name: "Accept invitation" }).click(),
      ]);
      await expect(invitee.page.getByRole("button", { name: "Use default appearance" })).toBeHidden();
      await expect(invitee.page.getByRole("button", { name: "Add entry" })).toBeVisible({ timeout: 10_000 });
      await expect(invitee.page.getByRole("region", { name: "Wall toolbar" })).toHaveCount(0);
      await expect(invitee.page.getByRole("button", { name: "Open Room details" })).toBeVisible({
        timeout: 10_000,
      });
      await expect(invitee.page.getByText(fixture.postText, { exact: false })).toBeVisible();
    } finally {
      await invitee.context.close();
    }
  });
});
