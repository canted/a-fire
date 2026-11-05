import { expect, test } from "@playwright/test";
import { faker } from "@faker-js/faker";
import { prisma } from "../fixtures/database";
import { createUserCommunityFixture } from "../fixtures/factory";
import { E2E_MEMBER_EMAIL } from "../config";
import { waitForPageContent } from "../utils";

const storageStatePath = "tests/e2e/.auth/state.json";

test.describe("reflections (Playwright)", () => {
  test.use({ storageState: storageStatePath });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("reflects a post into a page and shows the copied content", async ({ page }) => {
    test.slow();
    test.setTimeout(45_000);

    const fixtureSuffix = faker.string.alphanumeric(8);
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Reflections Community ${fixtureSuffix}`,
      boardName: `E2E Reflections Board ${fixtureSuffix}`,
      squareName: `E2E Reflections Square ${fixtureSuffix}`,
      withPage: true,
      pageIcon: "🧪",
      pageTitle: `Reflection Lab ${fixtureSuffix}`,
      skipEmailCleanup: true,
    });

    if (!fixture.pageId || !fixture.pageIcon) {
      throw new Error("Reflection page fixture was not created");
    }

    await page.goto(`/app/entries/${fixture.entryId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(fixture.postText, { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "More options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Save to Note", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Save to Note", exact: true })).toBeVisible();

    const reflectionIcon = page.getByRole("button", { name: `Save to ${fixture.pageTitle}` });
    await expect(reflectionIcon).toBeVisible();
    await reflectionIcon.click();

    await waitForPageContent(prisma, fixture.pageId, fixture.postText);

    await page.goto(`/app/rooms/${fixture.roomId}/notes`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: fixture.pageTitle, exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/app/note/${fixture.pageId}`), { timeout: 10_000 });
    await expect(page.locator("[contenteditable=true]")).toContainText(fixture.postText, { timeout: 15000 });
  });
});
