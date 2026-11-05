import { expect, test, type Page } from "@playwright/test";
import type { RoomMessage as ChatMessagePayload } from "../../../frontend/src/lib/api/room";

test.setTimeout(30_000);


async function chatFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" })));
  const now = new Date();
  const messages: ChatMessagePayload[] = Array.from({ length: 28 }, (_, i) => ({
    id: i + 1, kind: "message", body: `Room sketch ${i + 1}. Listen to the quiet space between these words.`,
    content: null, author: { id: 2, display_username: "Mira", avatar_url: null }, masked_author: null, announcement_type: null, saved_at: null, mine: false, entry: null, reply_count: 0,
    created_at: new Date(now.getTime() + i * 1000).toISOString(), fire_at: new Date(now.getTime() + 86400000).toISOString(),
    expires_at: new Date(now.getTime() + 172800000).toISOString(), lifecycle: "active", client_nonce: null,
  }));
  messages[26].content = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "A reference for the quiet space." }] },
    { type: "image", attrs: { src: "/icons/icon-512.png", alt: "Room reference", width: 640, height: 320 } },
  ] };
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/v2/rooms") body = { rooms: [{ id: 77, name: "Quiet Room" }] };
    else if (path === "/api/v1/rooms/77/home") body = { roomId: "77", members: [], viewer_access: { kind: "member", can_write: true, can_reply: true, entry_history: "all" } };
    else if (path === "/api/v2/rooms/77") body = { id: 77, name: "Quiet Room", porosity: "masked", parent: null, access: { kind: "member" }, memberBoard: { id: 91 } };
    else if (path === "/api/v1/entries/74") body = {
      entry: { id: 74, status: "published", user: { id: 1, username: "Rowan" }, room_id: 77,
        room: { id: 77, name: "Quiet Room" }, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A shared sketch." }] }] },
        format: "mixed_media", format_data: {}, can_keep_replies: true, created_at: now.toISOString(),
        feedback_request: { reply_mode: "simple", requested_feedback_types: [], idea_guidance: null }, viewer_access: { kind: "member", can_write: true, can_reply: true } },
      replies: { data: Array.from({ length: 20 }, (_, i) => ({ id: 501 + i, status: "published", user: { id: 2, username: "Mira" },
        created_at: now.toISOString(), published_at: now.toISOString(), content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Reply sketch ${i + 1}. Keep the quiet space.` }] }] } })),
        pagination: { page: 1, per_page: 20, next_page: null } },
    };
    else if (/\/chat\/messages\/\d+$/.test(path)) body = messages.find(message => path.endsWith(`/${message.id}`));
    else if (path.endsWith("/chat/messages")) body = { messages, next_cursor: null, present_user_ids: [1, 2], viewer_user_id: 1, viewer_access: { kind: "member", can_send: true, can_paginate: true, history_limit: null }, server_time: now.toISOString() };
    else if (path.endsWith("/adjacent-rooms")) body = { can_create: false, adjacent_rooms: [] };
    else if (path.endsWith("/rounds/overview")) body = { recentRounds: [], currentRounds: [], activeRound: null, nextRound: null };
    else if (path.endsWith("/walls")) body = { walls: [] };
    else if (path.endsWith("/members")) body = { members: [] };
    else if (path.endsWith("/memberships")) body = { user: { id: 1, username: "Rowan" }, memberships: [] };
    else if (path.endsWith("/unseen/count")) body = { total: 0, entries: 0, replies: 0 };
    else if (path.endsWith("/notices")) body = { items: [], nextCursor: null };
    else if (path === "/api/v1/projects") body = { projects: [{ id: 42, name: "Quiet studies", owner: { id: 1, username: "Rowan" }, viewer_participation: "owner", can_add_material: true }] };
    await route.fulfill({ json: body });
  });
  await page.goto("/app/rooms/77/chat");
  await expect(page.locator("#chat-28")).toBeVisible();
  await expect(page.getByRole("img", { name: "Room reference" })).toBeVisible();
  await page.getByRole("img", { name: "Room reference" }).evaluate(image => (image as HTMLImageElement).decode());
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  // Attachment layout can move the last row after the initial Chat scroll.
  // Pointer coordinates must target a fully visible row, not merely mounted content.
  await page.locator("#chat-28").scrollIntoViewIfNeeded();
  // Fractional layout can clip less than one pixel at the scroller boundary.
  await expect(page.locator("#chat-28")).toBeInViewport({ ratio: 0.99 });
}

const surfaceFor = (page: Page, id = "chat-28") => page.locator(`#${id}`).getByLabel("Message. Swipe right or press Right Arrow to reveal Save to project", { exact: true });
const movingFor = (surface: ReturnType<Page["locator"]>) => surface.locator(":scope > div > div").last();
const offset = (surface: ReturnType<Page["locator"]>) => movingFor(surface).evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
const saveFor = (surface: ReturnType<Page["locator"]>) => surface.getByRole("button", { name: /^Save revealed message \d+ to project$/ });
async function drag(page: Page, surface: ReturnType<Page["locator"]>, distance: number) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const box = (await surface.boundingBox())!;
  const viewport = (await page.getByLabel("Quiet Room chat messages", { exact: true }).boundingBox())!;
  const y = Math.max(box.y + 10, viewport.y + 60);
  await page.mouse.move(box.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 4 + distance, y, { steps: 20 });
}

for (const width of [320, 390, 1280]) {
  test(`message reveals a separate Save action without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await chatFixture(page);
    const surface = surfaceFor(page);
    await drag(page, surface, 60);
    await page.mouse.up();
    await expect.poll(() => offset(surface)).toBeCloseTo(72, 0);
    await expect(saveFor(surface)).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
    await surface.press("Escape");
    await expect.poll(() => offset(surface)).toBe(0);
    await expect(saveFor(surface)).toHaveCount(0);
  });
}

test("mouse swipe resists from the start, bounds travel, and preserves ordinary text selection", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await chatFixture(page);
  const surface = surfaceFor(page);
  const text = surface.getByText("Room sketch 28. Listen to the quiet space between these words.");
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 220, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 10, { steps: 10 }); await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
  expect(await offset(surface)).toBe(0);
  await text.dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
  // Begin a distinct gesture after the browser double-click selection sequence.
  await page.waitForTimeout(500);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const bounds = (await surface.boundingBox())!;
  await page.mouse.move(bounds.x + 4, bounds.y + 10); await page.mouse.down();
  const positions = [];
  for (const distance of [20, 30, 50, 110, 160, 400]) {
    await page.mouse.move(bounds.x + 4 + distance, bounds.y + 10, { steps: 3 });
    const current = await offset(surface);
    expect(current).toBeGreaterThan(0); expect(current).toBeLessThan(distance); expect(current).toBeLessThan(126);
    positions.push({ distance, offset: current });
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  }
  expect(await offset(surface)).toBeGreaterThan(90);
  await info.attach("resisted-travel", { body: JSON.stringify(positions), contentType: "application/json" });
  await page.mouse.move(bounds.x + 114, bounds.y + 10, { steps: 5 });
  expect(await offset(surface)).toBeLessThan(90);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Save to project" })).toHaveCount(0);
  await saveFor(surface).click();
  await expect(page.getByRole("dialog", { name: "Save to project" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(surface).toBeFocused();
});

for (const width of [320, 390, 1280]) {
  test(`latest control uses a regular arrow on white with a fainter circle at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await chatFixture(page);
    const scroller = page.getByLabel("Quiet Room chat messages", { exact: true });
    await scroller.hover(); await page.mouse.wheel(0, -300);
    const button = page.getByRole("button", { name: "Scroll to bottom", exact: true });
    await expect(button).toBeVisible();
    const circle = button.locator("svg").locator("..");
    await expect(circle).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(circle).toHaveCSS("border-radius", "16px");
    await expect(circle).toHaveCSS("border-width", "1px");
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const colors = await circle.evaluate(el => ({ border: getComputedStyle(el).borderColor, ink: getComputedStyle(el.querySelector("svg")!).color }));
    const lightness = (color: string) => color.match(/\d+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
    expect(lightness(colors.border)).toBeGreaterThan(lightness(colors.ink));
    await button.focus(); await page.keyboard.press("Enter");
    await expect(button).toHaveCount(0);
    const surface = surfaceFor(page);
    await surface.press("ArrowRight");
    await expect.poll(() => offset(surface)).toBe(72);
    await expect(saveFor(surface)).toBeEnabled();
    await surface.press("Escape");
    await expect.poll(() => offset(surface)).toBe(0);
  });
}

test("a grouped attachment moves as one surface without moving its author or neighboring message", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await chatFixture(page);
  const row = page.locator("#chat-27"); await row.scrollIntoViewIfNeeded();
  const surface = surfaceFor(page, "chat-27");
  const image = row.getByRole("img", { name: "Room reference" });
  const neighbor = movingFor(surfaceFor(page));
  const stripe = page.getByLabel("Mira avatar", { exact: true }).last();
  const before = { image: (await image.boundingBox())!.x, neighbor: (await neighbor.boundingBox())!.x, stripe: (await stripe.boundingBox())!.x };
  await drag(page, surface, 60); await page.mouse.up();
  await expect.poll(async () => (await image.boundingBox())!.x - before.image).toBeCloseTo(72, 0);
  expect((await neighbor.boundingBox())!.x).toBe(before.neighbor);
  expect((await stripe.boundingBox())!.x).toBe(before.stripe);
  await saveFor(surface).click();
  await expect(page.getByRole("dialog", { name: "Save to project" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(surface).toBeFocused();
});

for (const width of [320, 390]) {
  test(`beyond-edge swipes remain contained and preserve keyboard interaction at ${width}px`, async ({ page }) => {
    test.setTimeout(30_000);

    await page.setViewportSize({ width, height: 844 }); await chatFixture(page);
    for (const id of ["chat-28", "chat-27"]) {
      const surface = surfaceFor(page, id); await surface.scrollIntoViewIfNeeded();
      await drag(page, surface, width + 180);
      expect(await offset(surface)).toBeGreaterThan(90);
      const scrolls = await surface.evaluate(el => {
        const positions = []; for (let p = el.parentElement; p; p = p.parentElement) positions.push(p.scrollLeft);
        return positions;
      });
      expect(scrolls.every(value => Math.abs(value) < 0.5)).toBe(true);
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      await page.mouse.up();
      const dialog = page.getByRole("dialog", { name: "Save to project" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await surface.press("ArrowRight");
      await saveFor(surface).press("Enter");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await surface.press("ArrowRight");
      await surface.press("Escape");
      await expect.poll(() => offset(surface)).toBe(0);
    }
  });
}

test.describe("touch gesture arbitration", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("vertical intent yields, cancellation resets, and an armed release opens Save", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await chatFixture(page);
    const surface = surfaceFor(page);
    const box = (await surface.boundingBox())!;
    const touch = async (type: string, dx = 0, dy = 0) => {
      await surface.evaluate((target, { type, x, y }) => {
        const point = { identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y };
        const active = type === "touchend" || type === "touchcancel" ? [] : [point];
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: active }, targetTouches: { value: active }, changedTouches: { value: [point] } });
        target.dispatchEvent(event);
      }, { type, x: box.x + 4 + dx, y: box.y + 10 + dy });
    };
    await touch("touchstart"); await touch("touchmove", 2, 80); await touch("touchend", 2, 80);
    expect(await offset(surface)).toBe(0);
    await touch("touchstart"); await touch("touchmove", 20); await touch("touchmove", 40); await touch("touchmove", 80); await touch("touchend", 80);
    await expect.poll(() => offset(surface)).toBeCloseTo(72, 0);
    await surface.press("Escape"); await expect.poll(() => offset(surface)).toBe(0);
    await touch("touchstart"); await touch("touchmove", 20); await touch("touchmove", 220);
    expect(await offset(surface)).toBeGreaterThan(90);
    await touch("touchcancel", 220);
    await expect.poll(() => offset(surface)).toBe(0);
    await expect(page.getByRole("dialog", { name: "Save to project" })).toHaveCount(0);
    await touch("touchstart"); await touch("touchmove", 20); await touch("touchmove", 220); await touch("touchend", 220);
    await expect(page.getByRole("dialog", { name: "Save to project" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(surface).toBeFocused();
  });
});
