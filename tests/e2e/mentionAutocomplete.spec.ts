import { expect, test } from "@playwright/test";
import { faker } from "@faker-js/faker";

import { E2E_MEMBER_EMAIL } from "./config";
import { createUserCommunityFixture } from "./fixtures/factory";
import { prisma } from "./factories";

const storageStatePath = "tests/e2e/.auth/state.json";

test.describe("mention autocomplete", () => {
  test.use({ storageState: storageStatePath });

  test("inserts discoverable targets in chat and an inline post reply", async ({ page }) => {
    test.setTimeout(60_000);

    const suffix = faker.string.alphanumeric(8);
    const activityName = `Making Activity ${suffix}`;
    const noteTitle = `Field Notes ${suffix}`;
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Mentions ${suffix}`,
      boardName: `E2E Mention Board ${suffix}`,
      squareName: `E2E Mention Square ${suffix}`,
      withPage: true,
      pageTitle: noteTitle,
      pageIcon: "📝",
      skipEmailCleanup: true,
    });
    const now = new Date();
    const activity = await prisma.round.create({
      data: {

        room_id: fixture.roomId,
        host_id: fixture.userId,
        name: activityName,
        status: "active",
        started_at: now,
        created_at: now,
        updated_at: now,
      },
    });
    await prisma.room.update({
      where: { id: fixture.roomId },
      data: {
        reply_mode: "guided",
        default_feedback_types: ["idea"],
        default_idea_guidance: "open",
      },
    });
    await prisma.entry.update({
      where: { id: fixture.entryId },
      data: {
        reply_mode: "guided",
        requested_feedback_types: ["idea"],
        idea_guidance: "open",
        feedback_request_customized: true,
      },
    });

    await page.goto(`/app/rooms/${fixture.roomId}/chat`, { waitUntil: "domcontentloaded" });
    const chatComposer = page.getByRole("textbox", { name: `Message E2E Mentions ${suffix}` });
    await expect(chatComposer).toBeVisible();
    await chatComposer.pressSequentially("@Making");
    const chatMenu = page.getByLabel("Mention suggestions", { exact: true });
    await expect(chatMenu).toBeVisible();
    const menuBounds = (await chatMenu.boundingBox())!, composerBounds = (await chatComposer.boundingBox())!;
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(composerBounds.y + 1);
    await chatMenu.getByRole("button", { name: new RegExp(`^Mention ${activityName}`) }).click();
    await expect(chatComposer).toHaveValue(`@${activityName} `);

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v2/rooms/${fixture.roomId}/chat/messages`) &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Send" }).click(),
    ]);
    const chatMessage = await prisma.chatMessage.findFirstOrThrow({
      where: { room_id: fixture.roomId, author_id: fixture.userId },
      orderBy: { created_at: "desc" },
    });
    const chatContent = JSON.stringify(chatMessage.content);
    expect(chatContent).toContain('"targetType":"round"');
    expect(chatContent).toContain(`"targetId":"${activity.id}"`);

    await page.goto(`/app/entries/${fixture.entryId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Idea", exact: true }).click();
    const replyComposer = page.getByRole("textbox", { name: "Reply", exact: true });
    await replyComposer.pressSequentially("@Field");
    const replyMenu = page.getByLabel("Mention suggestions", { exact: true });
    await expect(replyMenu).toBeVisible();
    await replyMenu.getByRole("button", { name: new RegExp(`^Mention ${noteTitle}`) }).click();
    await expect(replyComposer).toHaveValue(`@${noteTitle} `);

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/entries/${fixture.entryId}/replies`) &&
          response.request().method() === "POST",
      ),
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/entries/${fixture.entryId}/replies/`) &&
          response.url().includes("/publish") &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Send" }).click(),
    ]);
    const reply = await prisma.reply.findFirstOrThrow({
      where: { entry_id: fixture.entryId, user_id: fixture.userId, status: "published" },
      orderBy: { created_at: "desc" },
    });
    const replyDocument = await prisma.document.findFirstOrThrow({
      where: { docable_type: "Reply", docable_id: reply.id },
      orderBy: { version: "desc" },
    });
    const replyContent = JSON.stringify(replyDocument.content);
    expect(replyContent).toContain('"targetType":"note"');
    expect(replyContent).toContain(`"targetId":"${fixture.pageId}"`);
  });
});
