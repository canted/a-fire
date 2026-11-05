import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_MEMBER_EMAIL } from "../config";
import { prisma } from "../fixtures/database";
import { createUserCommunityFixture } from "../fixtures/factory";

test.describe("inline reply media", () => {
  test.use({ storageState: "tests/e2e/.auth/state.json" });
  test.afterAll(async () => { await prisma.$disconnect(); });

  test("keeps the Send reply hit target stable when focus leaves the text editor", async ({ page }) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Inline reply focus ${Date.now()}`, skipEmailCleanup: true });
    await page.goto(`/app/entries/${fixture.entryId}`);
    const attach = page.getByRole("button", { name: "Add attachment" });
    const idleBounds = await attach.boundingBox();
    await attach.focus();
    const attachedFocusBounds = await attach.boundingBox();
    expect(Math.abs(attachedFocusBounds!.y - idleBounds!.y)).toBeLessThanOrEqual(1);
    await attach.blur();
    const editor = page.getByRole("textbox", { name: "Reply", exact: true });
    await editor.fill("Send with stable focus");
    const send = page.getByRole("button", { name: "Send", exact: true });
    const focusedBounds = await send.boundingBox();
    await send.focus();
    const buttonBounds = await send.boundingBox();
    expect(Math.abs(buttonBounds!.y - focusedBounds!.y)).toBeLessThanOrEqual(1);
    expect(await editor.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(200);
    await editor.focus();
    const published = page.waitForResponse(response => response.url().includes(`/api/v1/entries/${fixture.entryId}/replies/`) && response.url().endsWith("/publish") && response.request().method() === "POST");
    await send.click();
    expect((await published).ok()).toBe(true);
    await expect(page.locator('[id^="reply-"]').getByText("Send with stable focus", { exact: true })).toBeVisible();
  });

  test("persists audio, image and video replies through repeated sends and reload", async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });
    const directory = mkdtempSync(join(tmpdir(), "inline-reply-media-"));
    try {
      const files = {
        audio: join(directory, "voice.wav"),
        image: join(directory, "picture.png"),
        video: join(directory, "clip.mp4"),
      };
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", files.audio]);
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=128x128", "-frames:v", "1", files.image]);
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=128x128:d=1", "-pix_fmt", "yuv420p", files.video]);
      const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Inline reply media ${Date.now()}`, skipEmailCleanup: true });
      await page.goto(`/app/entries/${fixture.entryId}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(fixture.postText)).toBeVisible();
      await expect(page.getByRole("button", { name: "Add to project" })).toHaveCount(0);
      const replyIds: number[] = [];
      for (const kind of ["audio", "image", "video"] as const) {
        const editor = page.getByRole("textbox", { name: "Reply", exact: true });
        // The prior reply can be rendered before its composer finishes resetting.
        await expect(editor).toBeEditable();
        // The first reply exercises attachment-only publication; later sends retain text with media.
        const caption = kind === "audio" ? null : `Repeated ${kind} reply`;
        if (caption) await editor.fill(caption);
        const attach = page.getByRole("button", { name: "Add attachment" });
        await attach.click();
        const drawer = page.getByRole("dialog", { name: "Add attachment" });
        await expect(drawer.getByRole("button", { name: "Camera" })).toBeVisible();
        await expect(drawer.getByRole("button", { name: "Record audio" })).toBeVisible();
        // Upload known media bytes; microphone capture has its own recording controller.
        const chooserPromise = page.waitForEvent("filechooser");
        await drawer.getByRole("button", { name: "Choose photo or file" }).click();
        await (await chooserPromise).setFiles(files[kind]);
        await expect(drawer).toBeHidden();
        await expect(page.getByText(kind === "audio" ? "voice.wav" : kind === "image" ? "picture.png" : "clip.mp4", { exact: true })).toBeVisible();
        const publishPromise = page.waitForResponse(response => response.url().includes(`/api/v1/entries/${fixture.entryId}/replies/`) && response.url().endsWith("/publish") && response.request().method() === "POST");
        await page.getByRole("button", { name: "Send" }).click();
        const publication = await publishPromise;
        expect(publication.ok()).toBe(true);
        const payload = await publication.json();
        const replyId = Number(payload.reply?.id ?? payload.id);
        expect(replyId).toBeGreaterThan(0);
        replyIds.push(replyId);
        const savedReply = await prisma.reply.findUniqueOrThrow({ where: { id: replyId } });
        expect(savedReply).toMatchObject({ entry_id: fixture.entryId, user_id: fixture.userId, status: "published" });
        const savedDoc = await prisma.document.findFirstOrThrow({ where: { docable_type: "Reply", docable_id: replyId } });
        const content = savedDoc.content as { content: Array<{ type: string; attrs?: Record<string, unknown> }> };
        const mediaNode = content.content.find(node => node.type === kind);
        expect(mediaNode).toBeTruthy();
        if (kind === "audio" || kind === "video") {
          const assetId = Number(mediaNode!.attrs?.[kind === "audio" ? "audioAssetId" : "videoAssetId"]);
          const asset = kind === "audio"
            ? await prisma.audioAsset.findUniqueOrThrow({ where: { id: assetId } })
            : await prisma.videoAsset.findUniqueOrThrow({ where: { id: assetId } });
          expect(asset).toMatchObject({ source_type: "Reply", source_id: replyId, owner_id: fixture.userId });
        } else expect(mediaNode!.attrs?.src).toMatch(/^\/api\//);
        const visibleReply = page.locator(`#reply-${replyId}`);
        await expect(visibleReply).toBeVisible();
        if (kind === "image") await expect(visibleReply.getByRole("img")).toBeVisible();
        else if (kind === "audio") await expect(visibleReply.getByRole("button", { name: "Play audio", exact: true })).toBeVisible({ timeout: 30_000 });
        else await expect(visibleReply.locator("video")).toBeVisible({ timeout: 30_000 });
        await expect(editor).toHaveValue("");
        if (caption) await expect(visibleReply.getByText(caption, { exact: true })).toBeVisible();
      }
      expect(new Set(replyIds).size).toBe(3);
      expect(await prisma.reply.count({ where: { entry_id: fixture.entryId, status: "draft" } })).toBe(0);
      await page.reload();
      for (const id of replyIds) await expect(page.locator(`#reply-${id}`)).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
