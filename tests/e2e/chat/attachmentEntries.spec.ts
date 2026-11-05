import { expect, test, type Page } from "@playwright/test";
import type { RoomMessage as ChatMessagePayload } from "../../../frontend/src/lib/api/room";
import type { TiptapDoc } from "../../../frontend/src/lib/tiptap";

const paragraph = (text: string): TiptapDoc => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function fixture(page: Page, audio = false) {
  const stamp = new Date().toISOString();
  const author = { id: 2, username: "Mira", avatar_url: null };
  const viewer = { id: 1, username: "Rowan", avatar_url: null };
  const content: TiptapDoc = { type: "doc", content: [
    ...paragraph("Leave a little room before the final phrase.").content!,
    audio ? { type: "audio", attrs: { audioAssetId: 7, title: "Window melody", status: "ready" } }
      : { type: "image", attrs: { src: "/icons/icon-512.png", alt: "Synthetic study", width: 512, height: 512 } },
  ] };
  const messages: ChatMessagePayload[] = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1, kind: "message", announcement_type: null, saved_at: null, body: `Study note ${index + 1}: listen to the quiet space between the phrases.`, content: null,
    entry: null, reply_count: 0, created_at: stamp, fire_at: stamp, expires_at: stamp, lifecycle: "active", mine: false, client_nonce: null,
    author: { id: 2, display_username: "Mira", avatar_url: null }, masked_author: null,
  }));
  messages[19] = { ...messages[19], content, body: "Leave a little room before the final phrase.", entry: { id: 74, creation_origin: "chat_attachment", available: true, content, format: "mixed_media", format_data: {}, reply_count: 0 }, reply_participants: [] };
  const replies: Array<{ id: number; status: string; content: TiptapDoc; user: typeof viewer; created_at: string; published_at: string }> = [];
  let draftContent = paragraph("");
  const circle = { id: 77, name: "Quiet Room", parent: null, porosity: "open", access: { kind: "member" }, memberBoard: { id: 91 } };
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" })));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method())) writes.push(`${req.method()} ${path}`);
    if (path === "/api/v1/audio-assets/7/download") {
      const size = 8000 * 30 * 2, wav = Buffer.alloc(44 + size);
      wav.write("RIFF"); wav.writeUInt32LE(36 + size, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(size, 40);
      await route.fulfill({ body: wav, contentType: "audio/wav" }); return;
    }
    let data: unknown = {};
    if (path.endsWith("/memberships")) data = { user: viewer, memberships: [] };
    else if (path === "/api/v2/rooms") data = { rooms: [circle] };
    else if (path === "/api/v1/rooms/77/home") data = { roomId: "77", members: [], viewer_access: { kind: "member", can_write: true, can_reply: true, entry_history: "all" } };
    else if (path === "/api/v2/rooms/77") data = circle;
    else if (path.endsWith("/menu")) data = { rooms: [circle], currentRoom: circle };
    else if (path.endsWith("/members")) data = { members: [] };
    else if (path.endsWith("/adjacent-rooms")) data = { adjacent_rooms: [] };
    else if (path.endsWith("/walls")) data = { walls: [] };
    else if (path.endsWith("/rounds/overview")) data = { recentRounds: [], currentRounds: [], activeRound: null, nextRound: null };
    else if (path.endsWith("/chat/messages")) data = { messages, next_cursor: null, present_user_ids: [], viewer_user_id: 1, viewer_access: { kind: "member", can_send: true, can_paginate: true, history_limit: null }, server_time: stamp };
    else if (path === "/api/v1/entries/74") data = { entry: { id: 74, status: "published", creation_origin: "chat_attachment", user: author, room_id: 77, room: { id: 77, name: "Quiet Room" }, content, format: "mixed_media", format_data: {}, created_at: stamp, feedback_request: { reply_mode: "simple", requested_feedback_types: [], idea_guidance: null }, viewer_access: { kind: "member", can_reply: true, can_write: false } }, replies: { data: replies, pagination: { page: 1, per_page: 20, next_page: null } } };
    else if (path.startsWith("/api/v1/entries/74/replies") && ["POST", "PATCH"].includes(req.method())) {
      const body = req.postDataJSON();
      if (body?.reply?.content) draftContent = body.reply.content;
      const reply = { id: 501, status: "published", content: draftContent, user: viewer, created_at: stamp, published_at: stamp };
      if (path.endsWith("/publish")) { replies.push(reply); messages[19].reply_count = replies.length; messages[19].reply_participants = [viewer]; }
      data = reply;
    } else if (path === "/api/v1/audio-assets/7") data = { id: 7, title: "Window melody", processing_status: "ready", duration_ms: 30000, waveform_peaks: [0.2, 0.8, 0.4], playback_url: "/api/v1/audio-assets/7/download", source_type: "Post", source_id: 74, parent_entry_id: 74, parent_chat_message_id: 20, room_id: 77 };
    else if (path.endsWith("/unseen/count")) data = { total: 0, entries: 0, replies: 0 };
    await route.fulfill({ json: data });
  });
  return { writes, replies };
}

for (const width of [320, 390, 1280]) test(`attachment Entry replies preserve the Chat group and reading position at ${width}px`, async ({ page }, info) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width, height: 844 });
  const state = await fixture(page);
  await page.goto("/app/rooms/77/chat");
  await expect(page).toHaveURL(/\/app\/rooms\/77\/chat$/);
  const row = page.locator("#chat-20"), group = page.getByLabel("Mira avatar", { exact: true }).locator("..");
  await expect(group).toHaveCount(1);
  await expect(group.locator('[id^="chat-"]')).toHaveCount(24);
  await expect(row.getByText("Leave a little room before the final phrase.", { exact: true })).toHaveCount(1);
  await expect(row.locator("article, header")).toHaveCount(0);
  await expect(group.getByLabel("Mira avatar", { exact: true })).toHaveCount(1);
  await expect(page.locator("#chat-21").getByRole("button", { name: /thread/ })).toHaveCount(0);
  const reply = row.getByRole("button", { name: "0 responses. Open thread" });
  await reply.scrollIntoViewIfNeeded();
  await expect(reply).toBeInViewport();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath(`grouped-attachment-${width}.png`) });
  const scroller = page.getByLabel("Quiet Room chat messages", { exact: true });
  await scroller.hover();
  await page.mouse.wheel(0, -40);
  await expect(page.getByRole("button", { name: "Scroll to bottom", exact: true })).toBeVisible();
  await reply.scrollIntoViewIfNeeded();
  await expect(reply).toBeInViewport();
  const offset = () => row.evaluate(element => element.getBoundingClientRect().top - element.closest('[aria-label="Quiet Room chat messages"]')!.getBoundingClientRect().top);
  await page.waitForTimeout(300);
  const position = await offset();
  await reply.click();
  await expect(page).toHaveURL(/\/app\/entries\/74$/);
  const card = page.getByLabel("Discussion and replies", { exact: true });
  await expect(card.getByText("Leave a little room before the final phrase.")).toBeVisible();
  await expect(page.getByText("Feedback", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Reply", exact: true }).fill("The pause feels right here.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("#reply-501")).toHaveText(/The pause feels right here\./);
  expect(state.replies).toHaveLength(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/rooms\/77\/chat$/);
  await expect(row.getByRole("button", { name: "1 response. Open thread" })).toBeVisible();
  await expect(row.getByRole("img", { name: "Rowan", exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs(await offset() - position)).toBeLessThan(3);
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/entries\/74$/);
  await page.getByRole("button", { name: "Back to room", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/rooms\/77$/);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(row.getByRole("button", { name: "1 response. Open thread" })).toBeVisible();
  expect(state.writes.filter(path => path.endsWith("/publish"))).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
});

test("attachment Entry audio retains its player and asset across reply navigation", async ({ page }) => {
  test.setTimeout(45_000);
  await fixture(page, true);
  await page.goto("/app/rooms/77/chat");
  await expect(page).toHaveURL(/\/app\/rooms\/77\/chat$/);
  const row = page.locator("#chat-20");
  await row.getByRole("button", { name: "Play audio", exact: true }).click();
  const widget = page.getByTestId("audio-player-widget");
  const position = async () => Number(await widget.getByRole("slider").getAttribute("aria-valuenow"));
  await expect(widget.getByRole("button", { name: "Pause audio", exact: true })).toBeVisible();
  await expect.poll(position).toBeGreaterThan(0);
  const startedAt = await position();
  await row.getByRole("button", { name: "0 responses. Open thread" }).click();
  await expect(page).toHaveURL(/\/app\/entries\/74$/);
  await expect(widget).toHaveCount(1);
  await expect(widget.getByRole("button", { name: "Pause audio", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/rooms\/77\/chat$/);
  await expect(widget).toHaveCount(1);
  await expect.poll(position).toBeGreaterThan(startedAt);
  await widget.getByRole("button", { name: "Pause audio", exact: true }).click();
  await expect(widget.getByRole("button", { name: "Play audio", exact: true })).toBeVisible();
});
