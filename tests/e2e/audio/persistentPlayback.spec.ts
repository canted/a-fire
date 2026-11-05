import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { E2E_MEMBER_EMAIL } from "../config";
import { prisma } from "../fixtures/database";
import { createUserCommunityFixture } from "../fixtures/factory";

type PlaybackProbe = {
  instances: HTMLAudioElement[];
  selected?: HTMLAudioElement;
};
type PlaybackWindow = typeof window & { __playbackProbe: PlaybackProbe };

test.afterAll(async () => { await prisma.$disconnect(); });

test("one session player continues across shared content, Chat, Home and history", async ({ page }) => {
  test.setTimeout(90000);
  if (process.env.UPLOADS_STORAGE_BACKEND && process.env.UPLOADS_STORAGE_BACKEND !== "local") throw new Error("Playback fixtures require the isolated local storage backend");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    const probe: PlaybackProbe = { instances: [] };
    (window as PlaybackWindow).__playbackProbe = probe;
    window.Audio = new Proxy(window.Audio, {
      construct(target, args, newTarget) {
        const audio = Reflect.construct(target, args, newTarget) as HTMLAudioElement;
        probe.instances.push(audio);
        return audio;
      },
    });
  });
  const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Playback ${Date.now()}`, skipEmailCleanup: true });
  const key = `e2e-audio/${randomUUID()}.wav`;
  const file = resolve(process.env.UPLOADS_STORAGE_ROOT ?? "storage", key);
  mkdirSync(dirname(file), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=60", file]);
  const now = new Date();
  const blob = await prisma.activeStorageBlob.create({ data: { key, filename: "Window melody.wav", content_type: "audio/wav", service_name: "local", byte_size: statSync(file).size, created_at: now } });
  const asset = await prisma.audioAsset.create({ data: { blob_id: blob.id, owner_id: fixture.userId, source_type: "Post", source_id: fixture.entryId, title: "Window melody", original_filename: "Window melody.wav", original_mime_type: "audio/wav", processing_status: "ready", duration_ms: 60000, waveform_peaks: [0.2, 0.5, 0.8, 0.4, 0.6], created_at: now, updated_at: now } });
  try {
    const document = await prisma.document.findFirstOrThrow({ where: { docable_type: "Post", docable_id: fixture.entryId } });
    await prisma.document.update({ where: { id: document.id }, data: { content: { type: "doc", content: [
      { type: "audio", attrs: { audioAssetId: asset.id, title: "Window melody", status: "ready" } },
      { type: "paragraph", content: [{ type: "text", text: "Leave a little space before the last phrase." }] },
    ] } } });
    await page.goto(`/app/entries/${fixture.entryId}`);
    const card = page.getByLabel("Discussion and replies", { exact: true });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Play audio", exact: true }).click();
    const widget = page.getByTestId("audio-player-widget");
    const seek = () => widget.getByRole("slider");
    const position = async () => Number(await seek().getAttribute("aria-valuenow"));
    await expect(widget.getByRole("button", { name: "Pause audio", exact: true })).toBeVisible();
    await expect.poll(position).toBeGreaterThan(0);
    expect(await page.evaluate(() => {
      const probe = (window as PlaybackWindow).__playbackProbe;
      const playing = probe.instances.filter(audio => !audio.paused);
      if (playing.length === 1) probe.selected = playing[0];
      return playing.length;
    })).toBe(1);
    const transport = () => page.evaluate(() => {
      const audio = (window as PlaybackWindow).__playbackProbe.selected;
      if (!audio) throw new Error("The session audio transport was not captured");
      return { paused: audio.paused, position: audio.currentTime };
    });
    await assertDockedPlayer(page);
    const startedAt = await position();
    await page.getByRole("button", { name: "Back to room", exact: true }).click();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /Message Playback/ })).toBeVisible();
    await assertDockedPlayer(page);
    await page.getByRole("button", { name: "Back to home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await assertDockedPlayer(page);
    await page.goBack();
    await expect(page).toHaveURL(`/app/rooms/${fixture.roomId}`);
    await assertDockedPlayer(page);
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /Message Playback/ })).toBeVisible();
    await assertDockedPlayer(page);
    expect(await position()).toBeGreaterThan(startedAt);
    expect((await transport()).paused).toBe(false);
    await widget.getByRole("button", { name: "Pause audio", exact: true }).click();
    await expect(widget.getByRole("button", { name: "Play audio", exact: true })).toBeVisible();
    await expect.poll(async () => (await transport()).paused).toBe(true);
    const pausedAt = (await transport()).position;
    // The icon updates optimistically; the media pause event supplies its final position.
    await expect.poll(position).toBe(pausedAt);
    await page.waitForTimeout(500);
    expect(await transport()).toEqual({ paused: true, position: pausedAt });
    expect(await position()).toBe(pausedAt);
    await widget.getByRole("button", { name: "Play audio", exact: true }).click();
    // Each playback attempt reauthorizes its source and may replace the media element.
    await expect.poll(() => page.evaluate(() => {
      const probe = (window as PlaybackWindow).__playbackProbe;
      const playing = probe.instances.filter(audio => !audio.paused);
      if (playing.length === 1) probe.selected = playing[0];
      return playing.length;
    })).toBe(1);
    expect((await transport()).paused).toBe(false);
    await expect.poll(async () => (await transport()).position).toBeGreaterThan(pausedAt);
    await expect.poll(position).toBeGreaterThan(pausedAt);
    await widget.getByRole("button", { name: "Close audio", exact: true }).click();
    await expect(widget).toHaveCount(0);
  } finally {
    await prisma.audioAsset.delete({ where: { id: asset.id } });
    await prisma.activeStorageBlob.delete({ where: { id: blob.id } });
    rmSync(file, { force: true });
  }
});

async function assertDockedPlayer(page: Page) {
  const widget = page.getByTestId("audio-player-widget");
  await expect(widget).toHaveCount(1);
  await expect(widget.getByRole("button", { name: "Pause audio", exact: true })).toBeVisible();
  await expect(widget).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => {
    const bounds = await widget.boundingBox();
    const dock = page.locator("#viewport-toolbar:visible").last();
    const toolbar = await dock.count() ? await dock.boundingBox() : null;
    return Boolean(bounds && bounds.width >= 280 && (toolbar ? bounds.y + bounds.height <= toolbar.y - 7 : bounds.y + bounds.height <= page.viewportSize()!.height - 7));
  }).toBe(true);
}
