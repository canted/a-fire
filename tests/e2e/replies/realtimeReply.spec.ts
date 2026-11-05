import { expect, test } from "@playwright/test";
import { prisma } from "../fixtures/database";
import { faker } from "@faker-js/faker";
import { createUserCommunityFixture } from "../fixtures/factory";
import { E2E_API_ORIGIN, E2E_MEMBER_EMAIL } from "../config";

const storageStatePath = "tests/e2e/.auth/state.json";

test.describe("realtime replies (Playwright)", () => {
  test.use({ storageState: storageStatePath });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("renders a newly published reply while already waiting on the post page", async ({ page }) => {
    test.slow();

    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: "E2E Realtime Replies Community",
      boardName: "E2E Realtime Replies Board",
      squareName: "E2E Realtime Replies Square",
      skipEmailCleanup: true,
    });
    const postId = String(fixture.entryId);
    const replyText = `Realtime reply ${faker.string.uuid()}`;

    const postSubscriptionPromise = new Promise<void>((resolve) => {
      page.on("websocket", (webSocket) => {
        webSocket.on("framesent", ({ payload }) => {
          const frame = String(payload);
          if (frame.includes("subscribe") && frame.includes("EntryChannel") && frame.includes(postId)) {
            resolve();
          }
        });
      });
    });

    await page.goto(`/app/entries/${postId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(fixture.postText, { exact: false })).toBeVisible({ timeout: 10_000 });
    await postSubscriptionPromise;

    const createdReply = await page.evaluate(
      async ({ entryId: targetPostId, text, apiOrigin }) => {
        const accessToken = JSON.parse(window.localStorage.getItem("afire.preview.session") || "null")?.accessToken;
        if (!accessToken) throw new Error("Missing access token for realtime reply test");

        const response = await fetch(`${apiOrigin}/api/v1/entries/${targetPostId}/replies`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reply: {
              status: "published",
              content: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              },
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Reply create failed with status ${response.status}: ${await response.text()}`);
        }

        return (await response.json()) as { id: number };
      },
      { entryId: postId, text: replyText, apiOrigin: E2E_API_ORIGIN },
    );

    await expect(page.getByText(replyText, { exact: false })).toBeVisible({ timeout: 5_000 });

    const persistedReply = await prisma.reply.findUnique({
      where: { id: createdReply.id },
      select: { id: true },
    });
    expect(persistedReply).not.toBeNull();

    const persistedDocument = await prisma.document.findFirst({
      where: { docable_type: "Reply", docable_id: createdReply.id },
      select: { content: true },
    });
    expect(JSON.stringify(persistedDocument?.content)).toContain(replyText);
  });
});
