import { openRoomComposer } from "../fixtures/composition";
import { recentRoomMemberEntryIds } from "../../../server/api/v1/entries/room-entry-history";
import { expect, test } from "@playwright/test";
import { faker } from "@faker-js/faker";
import { createUserCommunityFixture } from "../fixtures/factory";
import { factories, prisma } from "../factories";
import { E2E_API_ORIGIN, E2E_MEMBER_EMAIL } from "../config";

const storageStatePath = "tests/e2e/.auth/state.json";

test.describe("posts (Playwright)", () => {
  test.use({ storageState: storageStatePath });

  async function createMentionableUser({
    roomId: contextRoomId,
  }: {
    roomId: number;
  }) {
    const now = new Date();
    const username = `mention${faker.string.alphanumeric(8).toLowerCase()}`;
    const user = await factories.user
      .props({
        email: () => `${username}@example.com`,
        username: () => username,
        created_at: () => now,
        updated_at: () => now,
      })
      .create();

    await factories.communityMembership
      .props({
        room_id: () => contextRoomId,
        user_id: () => user.id,
        username_override: () => null,
        notify: () => true,
        created_at: () => now,
        updated_at: () => now,
        disabled: () => false,
      })
      .create();

    return { id: user.id, username };
  }

  test("creates an entry inline and returns to the wall", async ({ page }) => {
    test.slow();
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 390, height: 844 });

    const fixtureSuffix = faker.string.alphanumeric(8);
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Posts Community ${fixtureSuffix}`,
      boardName: `E2E Posts Board ${fixtureSuffix}`,
      squareName: `E2E Posts Square ${fixtureSuffix}`,
      skipEmailCleanup: true,
    });

    const postText = faker.lorem.sentence();

    await openRoomComposer(page, fixture);
    const body = page.getByRole("textbox", { name: "Body", exact: true });
    await expect(page).toHaveURL(new RegExp(`/app/rooms/${fixture.roomId}/new-entry`));
    await expect(page.getByRole("button", { name: /^Share in / })).toBeDisabled();
    await body.fill(postText);
    await page.getByRole("button", { name: /^Share in / }).click();
    await expect(body).not.toBeVisible();
    await expect(page).toHaveURL(`/app/rooms/${fixture.roomId}`);
    await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();

    const post = await prisma.entry.findUniqueOrThrow({ where: { id: (await recentRoomMemberEntryIds(prisma, [{ roomId: fixture.roomId, userId: fixture.userId }], 1))[0] } });
    expect(post).toMatchObject({ status: "published", format: "mixed_media", user_id: fixture.userId });
    const document = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: post.id } });
    expect(document.content).toMatchObject({ content: [{ type: "paragraph", content: [{ type: "text", text: postText }] }] });
    await page.reload();
    await expect(page.getByText(postText, { exact: true })).toBeVisible();
  });

  test("preserves user and page mentions when publishing a legacy rich post", async ({ page }) => {
    test.slow();

    const fixtureSuffix = faker.string.alphanumeric(8);
    const pageTitle = `MentionPage${faker.string.alphanumeric(8)}`;
    const fixture = await createUserCommunityFixture({
      email: E2E_MEMBER_EMAIL,
      roomName: `E2E Mention Posts Community ${fixtureSuffix}`,
      boardName: `E2E Mention Posts Board ${fixtureSuffix}`,
      squareName: `E2E Mention Posts Square ${fixtureSuffix}`,
      withPage: true,
      pageTitle,
      pageIcon: "M",
      skipEmailCleanup: true,
    });
    const mentionUser = await createMentionableUser({
      roomId: fixture.roomId,
    });

    // Existing rich drafts must publish without losing mention identities.
    const postId = fixture.entryId;
    await prisma.entry.update({ where: { id: postId }, data: { status: "draft", published_at: null, format: "mixed_media" } });
    const content = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "Mentions " },
      { type: "mention", attrs: { id: `user:${mentionUser.id}`, targetType: "user", targetId: String(mentionUser.id), label: mentionUser.username, href: `/app/rooms/${fixture.roomId}/members/${mentionUser.id}` } },
      { type: "text", text: " and " },
      { type: "mention", attrs: { id: `page:${fixture.pageId}`, targetType: "note", targetId: String(fixture.pageId), label: pageTitle, href: `/app/note/${fixture.pageId}` } },
    ] }] };
    await prisma.document.updateMany({ where: { docable_type: "Post", docable_id: postId }, data: { content } });
    await page.goto(`/app/rooms/${fixture.roomId}`);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("afire.preview.session") || "null")?.accessToken);
    const response = await page.request.post(`${E2E_API_ORIGIN}/api/v1/entries/${postId}/publish`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const published = await prisma.entry.findUniqueOrThrow({ where: { id: postId } });
    expect(published.status).toBe("published");
    const document = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: postId } });
    expect(document.content).toEqual({ ...content, content: content.content.map(paragraph => ({ ...paragraph, content: paragraph.content.map(node => node.type === "mention" ? { ...node, attrs: { ...node.attrs, id: `${node.attrs!.targetType}:${node.attrs!.targetId}`, avatarUrl: null } } : node) })) });

    await page.goto(`/app/entries/${postId}`, { waitUntil: "domcontentloaded" });
    const userMention = page.getByRole("link", { name: `@${mentionUser.username}`, exact: true });
    const pageMention = page.getByRole("link", { name: `@${pageTitle}`, exact: true });
    await expect(userMention).toBeVisible({ timeout: 10000 });
    await expect(pageMention).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(userMention).toBeVisible({ timeout: 10000 });
    await expect(pageMention).toBeVisible({ timeout: 10000 });
  });
});
