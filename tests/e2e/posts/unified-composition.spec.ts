import { openRoomComposer, attachComposerFile, chooseSaveProject } from "../fixtures/composition";
import { recentRoomMemberEntryIds } from "../../../server/api/v1/entries/room-entry-history";
import { expect, test } from "@playwright/test";
import { createUserCommunityFixture, ensureUser } from "../fixtures/factory";
import { E2E_API_ORIGIN, E2E_MEMBER_EMAIL } from "../config";
import { prisma } from "../factories";

test.use({ actionTimeout: 15_000 });

test("creates a title and body entry from the Room sharing picker and preserves guided feedback", async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `E2E Composer ${Date.now()}`, skipEmailCleanup: true });
  await prisma.room.update({ where: { id: fixture.roomId }, data: { reply_mode: "guided" } });
  await openRoomComposer(page, fixture);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("A published composition");
  await page.getByRole("textbox", { name: "Body", exact: true }).fill("Leave room before the second voice.");
  await page.getByRole("button", { name: /^Share in / }).click();
  await expect(page.getByRole("textbox", { name: "Body", exact: true })).not.toBeVisible();

  const post = await prisma.entry.findUniqueOrThrow({ where: { id: (await recentRoomMemberEntryIds(prisma, [{ roomId: fixture.roomId, userId: fixture.userId }], 1))[0] } });
  expect(post).toMatchObject({ status: "published", format: "mixed_media", reply_mode: "guided" });
  expect(post.format_data).toMatchObject({ title: "A published composition" });
  const document = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: post.id } });
  expect(JSON.stringify(document.content)).toContain("Leave room before the second voice.");
  await page.reload();
  await expect(page.getByText("Leave room before the second voice.", { exact: true })).toBeVisible();
  await page.goto(`/app/entries/${post.id}`);
  await expect(page.getByRole("heading", { name: "A published composition", exact: true })).toBeVisible();
});

for (const anotherAuthor of [false, true]) {
  test(`keeps ${anotherAuthor ? "another member’s" : "own"} chat message in a private project`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `E2E Convert ${Date.now()}`, skipEmailCleanup: true });
    const now = new Date();
    let authorId = fixture.userId;
    if (anotherAuthor) {
      authorId = await ensureUser(`author-${Date.now()}@example.com`, "Original Author");
      await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: authorId, created_at: now, updated_at: now } });

    }
    const body = `Preserve this original ${Date.now()}`;
    const message = await prisma.chatMessage.create({ data: {
      room_id: fixture.roomId, author_id: authorId, body,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] },
      masked_alias: "", client_nonce: crypto.randomUUID(), fire_at: new Date(Date.now() + 86400000), expires_at: new Date(Date.now() + 172800000), created_at: now, updated_at: now,
    } });
    const project = await prisma.project.create({ data: { owner_id: fixture.userId, name: `Saved thoughts ${Date.now()}`, created_at: now, updated_at: now } });
    await page.goto(`/app/rooms/${fixture.roomId}/chat`);
    const row = page.locator(`#chat-${message.id}`);
    await expect(row).toBeVisible();
    await row.getByLabel("Message. Swipe right or press Right Arrow to reveal Save to project", { exact: true }).press("ArrowRight");
    await row.getByRole("button", { name: /^Save revealed message \d+ to project$/ }).click();
    await chooseSaveProject(page, project.name);
    await expect(page.getByRole("dialog", { name: "Save to project" })).not.toBeVisible();
    const saved = await prisma.entry.findFirstOrThrow({ where: { project_id: project.id, source_chat_message_id: message.id, status: "published" } });
    expect(saved.source_author_name).toBe(anotherAuthor ? "Original Author" : (await prisma.user.findUniqueOrThrow({ where: { id: fixture.userId } })).username);
    const document = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: saved.id } });
    expect(document.content).toEqual(message.content);
    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: message.id } })).entry_id).toBeNull();

  });
}

for (const kind of ["image", "audio", "video"] as const) {
  test(`publishes a ${kind} through the Room composer`, async ({ page }) => {
    test.setTimeout(60000);
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = mkdtempSync(join(tmpdir(), "composition-media-"));
    const path = join(directory, kind === "image" ? "picture.png" : kind === "audio" ? "recording.wav" : "movie.mp4");
    try {
      if (kind === "audio") execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", path]);
      else execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=128x128:d=1", ...(kind === "image" ? ["-frames:v", "1"] : ["-pix_fmt", "yuv420p"]), path]);
      const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `E2E Media ${kind} ${Date.now()}`, skipEmailCleanup: true });
      await openRoomComposer(page, fixture);
      await attachComposerFile(page, path);
      await page.getByRole("button", { name: /^Share in / }).click();
      await expect(page.getByRole("textbox", { name: "Body", exact: true })).not.toBeVisible();

      const post = await prisma.entry.findUniqueOrThrow({ where: { id: (await recentRoomMemberEntryIds(prisma, [{ roomId: fixture.roomId, userId: fixture.userId }], 1))[0] } });
      expect(post).toMatchObject({ format: "mixed_media", status: "published" });
      const document = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: post.id } });
      const nodes = (document.content as { content: Array<{ type: string; attrs?: Record<string, unknown> }> }).content;
      const node = nodes.find(node => node.type === kind);
      expect(node).toBeDefined();
      expect(node!.attrs?.[kind === "image" ? "src" : kind === "audio" ? "audioAssetId" : "videoAssetId"]).toBeTruthy();
      if (kind === "video") {
        const assetId = Number(node!.attrs?.videoAssetId);
        const token = await page.evaluate(() => JSON.parse(localStorage.getItem("afire.preview.session") || "null")?.accessToken);
        await expect.poll(async () => {
          const response = await page.request.get(`${E2E_API_ORIGIN}/api/v1/video-assets/${assetId}`, { headers: { Authorization: `Bearer ${token}` } });
          expect(response.ok()).toBe(true);
          const asset = await response.json();
          return asset.poster_url;
        }).toBe(`/api/v1/video-assets/${assetId}/poster`);
      }

    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
