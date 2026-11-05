import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { prisma } from "../fixtures/database";
import { faker } from "@faker-js/faker";
import { createUserCommunityFixture } from "../fixtures/factory";
import { E2E_MEMBER_EMAIL } from "../config";

const storageStatePath = "tests/e2e/.auth/state.json";

test.describe("replies (Playwright)", () => {
  test.use({ storageState: storageStatePath });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("full-page reply blocks publication during upload and recovers after failure", async ({ page }) => {
    test.slow();
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL, roomName: "E2E Upload Recovery",
      boardName: "E2E Upload Board", squareName: "E2E Upload Square", skipEmailCleanup: true,
    });
    let releaseUpload!: () => void;
    const gate = new Promise<void>(resolve => { releaseUpload = resolve; });
    let uploadStarted = false;
    let publications = 0;
    page.on("request", request => {
      if (request.url().includes(`/entries/${fixture.entryId}/replies/`) && request.url().endsWith("/publish")) publications++;
    });
    await page.route("**/api/v1/uploads", async route => {
      uploadStarted = true;
      await gate;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Upload temporarily unavailable" }) });
    });
    try {
      await page.goto(`/app/entries/${fixture.entryId}/new-reply`);
      const editor = page.getByRole("textbox", { name: "Reply", exact: true });
      await expect(editor).toBeVisible();
      const replyText = "Keep this reply when the attachment fails.";
      await editor.fill(replyText);
      const publish = page.getByRole("button", { name: /^(Send|Retry send)$/ });
      await page.getByRole("button", { name: "Add attachment", exact: true }).click();
      const picker = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Choose photo or file", exact: true }).click();
      await (await picker).setFiles(resolve("frontend/.storybook/assets/wall-study.jpg"));
      await publish.click();
      await expect.poll(() => uploadStarted).toBe(true);
      await expect(publish).toBeDisabled();
      expect(publications).toBe(0);
      expect(await prisma.reply.count({ where: { entry_id: fixture.entryId, status: "published" } })).toBe(0);
      releaseUpload();
      await expect(page.getByRole("alert")).toContainText("Upload temporarily unavailable");
      await expect(publish).toBeEnabled();
      await expect(editor).toHaveValue(replyText);
      await page.unroute("**/api/v1/uploads");
      await publish.click();
      await expect(editor).toHaveValue("");
      expect(publications).toBe(1);
      await expect(page.locator('[id^="reply-"]').getByText(replyText, { exact: true })).toBeVisible();
    } finally { releaseUpload(); }
  });

  test("full-page publication retries a lost response without duplicating the reply", async ({ page }) => {
    test.slow();
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: "E2E Reply Recovery Community",
      boardName: "E2E Reply Recovery Board",
      squareName: "E2E Reply Recovery Square",
      skipEmailCleanup: true,
    });
    const replyText = faker.lorem.sentence();
    const attempts: unknown[] = [];
    await page.route(`**/api/v1/entries/${fixture.entryId}/replies/*/publish`, async route => {
      attempts.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      // The server commits, but the first response never reaches the editor.
      if (attempts.length === 1) await route.abort("connectionreset");
      else await route.fulfill({ response });
    });
    await page.goto(`/app/entries/${fixture.entryId}/new-reply`);
    const editor = page.getByRole("textbox", { name: "Reply", exact: true });
    await expect(editor).toBeVisible();
    await editor.fill(replyText);
    const publish = page.getByRole("button", { name: /^(Send|Retry send)$/ });
    await publish.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(editor).not.toBeEditable();
    await expect(editor).toHaveValue(replyText);
    await expect(page).toHaveURL(new RegExp(`/app/entries/${fixture.entryId}/new-reply$`));
    expect(await prisma.reply.count({ where: { entry_id: fixture.entryId, status: "published" } })).toBe(1);
    await page.getByRole("button", { name: "Retry send", exact: true }).click();
    await expect(editor).toHaveValue("");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    const replies = await prisma.reply.findMany({ where: { entry_id: fixture.entryId, status: "published" } });
    expect(replies).toHaveLength(1);
    const document = await prisma.document.findUniqueOrThrow({
      where: { docable_type_docable_id: { docable_type: "Reply", docable_id: replies[0].id } },
    });
    expect(JSON.stringify(document.content)).toContain(replyText);
    await expect(page.locator('[id^="reply-"]').getByText(replyText, { exact: true })).toBeVisible();
  });

  for (const recovery of ["success", "lost-response", "rejected"] as const) {
    test(`publication protects its pending snapshot (${recovery})`, async ({ page }) => {
      test.slow();
      const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL,
        roomName: "Pending reply snapshot", skipEmailCleanup: true });
      const initialText = "First published reply.";
      const nextText = "A separate reply after acknowledgement.";
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let waiting = false;
      const attempts: unknown[] = [];
      await page.route(`**/api/v1/entries/${fixture.entryId}/replies/*/publish`, async route => {
        attempts.push(route.request().postDataJSON());
        if (attempts.length !== 1) return route.continue();
        const response = recovery === "rejected" ? undefined : await route.fetch();
        if (response) expect(response.ok()).toBe(true);
        waiting = true;
        await gate;
        if (recovery === "rejected") await route.fulfill({ status: 422, json: { message: "Please revise this reply" } });
        else if (recovery === "lost-response") await route.abort("connectionreset");
        else await route.fulfill({ response: response! });
      });
      try {
        await page.goto(`/app/entries/${fixture.entryId}/new-reply`);
        const editor = page.getByRole("textbox", { name: "Reply", exact: true });
        await editor.fill(initialText);
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect.poll(() => waiting).toBe(true);
        await expect(editor).not.toBeEditable();
        await expect(editor).toHaveValue(initialText);
        await expect(page.getByRole("button", { name: "Retry send", exact: true })).toBeDisabled();
        release();
        if (recovery === "lost-response") {
          await expect(page.getByRole("alert")).toBeVisible();
          await expect(editor).not.toBeEditable();
          await page.getByRole("button", { name: "Retry send", exact: true }).click();
          await expect(editor).toHaveValue("");
          expect(attempts[1]).toEqual(attempts[0]);
        } else if (recovery === "rejected") {
          await expect(page.getByRole("alert")).toContainText("Please revise this reply");
          await expect(editor).toBeEditable();
          await expect(editor).toHaveValue(initialText);
          await editor.fill(nextText);
          await page.getByRole("button", { name: "Retry send", exact: true }).click();
          await expect(editor).toHaveValue("");
        } else {
          await expect(editor).toHaveValue("");
          await editor.fill(nextText);
          await expect(editor).toHaveValue(nextText);
        }
        const replies = await prisma.reply.findMany({ where: { entry_id: fixture.entryId, status: "published" } });
        expect(replies).toHaveLength(1);
        const document = await prisma.document.findUniqueOrThrow({ where: {
          docable_type_docable_id: { docable_type: "Reply", docable_id: replies[0].id },
        } });
        const publishedText = recovery === "rejected" ? nextText : initialText;
        expect(JSON.stringify(document.content)).toContain(publishedText);
        await expect(page.locator('[id^="reply-"]').getByText(publishedText, { exact: true })).toBeVisible();
      } finally { release(); }
    });
  }

  test("creates a reply and shows it on the post page", async ({ page }) => {
    test.slow();

    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: "E2E Replies Community",
      boardName: "E2E Replies Board",
      squareName: "E2E Replies Square",
      skipEmailCleanup: true,
    });

    const replyText = faker.lorem.sentence();

    await page.goto(`/app/entries/${fixture.entryId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(fixture.postText, { exact: false })).toBeVisible({ timeout: 10000 });

    const editor = page.getByRole("textbox", { name: "Reply", exact: true });
    await editor.fill(replyText);
    const publication = page.waitForResponse(response =>
      response.url().includes(`/api/v1/entries/${fixture.entryId}/replies/`) &&
      response.url().endsWith("/publish") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect((await publication).ok()).toBe(true);
    await expect(page.locator('[id^="reply-"]').getByText(replyText, { exact: true })).toBeVisible();
    await expect(editor).toHaveValue("");
    await page.reload();
    await expect(page.locator('[id^="reply-"]').getByText(replyText, { exact: true })).toBeVisible();
  });

  test("creates a guided reply with a selected feedback type", async ({ page }) => {
    test.slow();

    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: "E2E Guided Replies Community",
      boardName: "E2E Guided Replies Board",
      squareName: "E2E Guided Replies Square",
      skipEmailCleanup: true,
    });
    await prisma.room.update({
      where: { id: fixture.roomId },
      data: {
        reply_mode: "guided",
        default_feedback_types: ["impression", "question", "idea"],
        default_idea_guidance: "open",
      },
    });
    await prisma.entry.update({
      where: { id: fixture.entryId },
      data: {
        reply_mode: "guided",
        requested_feedback_types: ["impression", "question", "idea"],
        idea_guidance: "open",
        feedback_request_customized: true,
      },
    });

    const replyText = faker.lorem.sentence();

    await page.goto(`/app/entries/${fixture.entryId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(fixture.postText, { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Idea", exact: true })).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Idea", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/app/entries/${fixture.entryId}$`));
    const editor = page.getByRole("textbox", { name: "Reply", exact: true });
    await editor.fill(replyText);

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
    const publishedReply = page.locator(`[id^="reply-"]`, { hasText: replyText });
    await expect(publishedReply.getByText(replyText, { exact: false })).toBeVisible({ timeout: 30000 });
    await expect(publishedReply.getByText("Idea", { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(editor).toHaveValue("");

    const persistedReply = await prisma.reply.findFirstOrThrow({
      where: { entry_id: fixture.entryId, status: "published" },
      orderBy: { created_at: "desc" },
    });
    expect(persistedReply.feedback_type).toBe("idea");
  });
});
