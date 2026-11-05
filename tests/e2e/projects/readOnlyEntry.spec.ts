import { expect, test, type Locator, type Page } from "@playwright/test";
import type { TiptapDoc } from "../../../frontend/src/lib/tiptap";

const heading = { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "A field note" }] };
const picture = { type: "image", attrs: { src: "/icons/icon-512.png", alt: "Synthetic reference", width: 512, height: 512 } };

// Only synthetic viewer-scoped API data. All writes are intercepted and recorded.
async function fixtures(page: Page, content: TiptapDoc, title?: string) {
  const formatData = title ? { title } : {};
  const stamp = new Date().toISOString(), user = { id: 1, username: "Rowan", avatar_url: null };
  const circle = { id: 77, name: "Small Hours", owner_id: 1, porosity: "open", memberBoard: { id: 91, name: "Small Hours" }, access: { kind: "member", can_manage: false } };
  const entry = { id: 201, kind: "material", author: user, created_at: stamp, updated_at: stamp, content, format: "mixed_media", format_data: formatData, intent: title, can_edit: false, can_share: false, draft: false, status: "published", submissions: [] };
  const project = { id: 42, name: "Field Studies", owner: user, participants: [], pending_participants: [], rooms: [],  entries: [entry], updated_at: stamp, can_edit: false, can_add_material: false, viewer_participation: "accepted" };
  const wall = { id: "19", roomId: "77", roundId: "91", title: "Small observations", description: "Contributions from a completed round.", publishedAt: stamp, templateKey: null, entries: [{ id: "74", entryId: "74", authorName: "Rowan", authorAvatarUrl: null, available: true, content, format: "mixed_media", formatData, responseCount: 0, responseParticipants: [] }] };
  const records: Record<string, unknown> = {
    "/api/v1/memberships": { user, memberships: [] }, "/api/v1/unseen/count": { total: 0, entries: 0, replies: 0 },
    "/api/v2/rooms": { rooms: [circle] },
    "/api/v1/rooms/77/home": { roomId: "77", members: [], viewer_access: { kind: "member", can_write: false, can_reply: false, entry_history: "all" } },
    "/api/v2/rooms/77": circle, "/api/v2/rooms/77/menu": { rooms: [circle], currentRoom: circle },
    "/api/v2/rooms/77/adjacent-rooms": { adjacent_rooms: [] }, "/api/v2/rooms/77/members": { members: [] },
    "/api/v2/rooms/77/chat/messages": { messages: [], next_cursor: null, present_user_ids: [], viewer_user_id: 1, viewer_access: { kind: "member", can_send: true, can_paginate: true, history_limit: null }, server_time: stamp },
    "/api/v2/rooms/77/chat/rounds": { rounds: [] },
    "/api/v1/rooms/77/walls": { walls: [{ ...wall, presented: true, entryCount: 1 }] }, "/api/v1/walls/19": wall,
    "/api/v1/rooms/77/rounds/overview": { currentRounds: [], activeRound: null, recentRounds: [] },
    "/api/v1/entries/74": { entry: { id: 74, status: "published", user, room_id: 77, room: { id: 77, name: "Small Hours" }, content, format: "mixed_media", format_data: formatData, viewer_access: { kind: "member", can_reply: false } }, replies: { data: [], pagination: { next_page: null } } },
    "/api/v1/projects/42": project,
    "/api/v1/projects/42/entries": { entries: [entry], nextCursor: null },
    "/api/v1/projects/42/entries/201": entry,
    "/api/v1/projects/42/entries/201/copies": { submissions: [], nextCursor: null },
    "/api/v1/projects/home": { today: stamp.slice(0, 10), rounds: [], recentRooms: [], totalRoomUnseenCount: 0, recentProjects: [{ project, entry }], recentEntries: [{ project, entry }], contributions: [] },
  };
  const writes: string[] = [];
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) writes.push(`${request.method()} ${path}`);
    await route.fulfill({ json: records[path] ?? {} });
  });
  await page.addInitScript(() => { localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" })); });
  return writes;
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

async function snapshot(renderer: Locator) {
  return renderer.evaluate(element => ({ text: element.textContent, html: element.innerHTML, height: element.getBoundingClientRect().height }));
}

async function exerciseReadonly(page: Page, renderer: Locator) {
  await expect(renderer).toBeVisible();
  await expect(renderer.locator('[contenteditable="true"], textarea, input')).toHaveCount(0);
  const before = await snapshot(renderer);
  await renderer.evaluate(element => { (element as HTMLElement).tabIndex = -1; (element as HTMLElement).focus(); });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  // WebKit treats Backspace outside an editor as browser history navigation.
  await page.keyboard.insertText("Attempted edit");
  await page.keyboard.press("Tab");
  expect(await snapshot(renderer)).toEqual(before);
}

for (const width of [320, 390, 1280]) for (const media of [false, true]) {
  test(`Wall heading stays read-only at ${width}px, media=${media}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const writes = await fixtures(page, { type: "doc", content: [...(media ? [picture] : []), heading] });
    await page.goto("/app/rooms/77/chat?wall=19");
    const opener = media ? page.getByRole("button", { name: "Open image 1", exact: true }) : page.getByRole("button", { name: "A field note", exact: true });
    await expect(opener).toBeVisible();
    await settle(page);
    const before = await snapshot(opener);
    const bounds = (await opener.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    expect(await snapshot(opener)).toEqual(before);
    await page.mouse.up();
    const detail = page.getByLabel("Discussion and replies", { exact: true });
    await expect(detail.getByRole("heading", { name: "A field note", exact: true })).toBeVisible();
    const writesBefore = [...writes];
    await exerciseReadonly(page, detail);
    expect(writes).toEqual(writesBefore);
    await page.screenshot({ path: info.outputPath(`readonly-${width}-${media}.png`) });
    await page.getByRole("button", { name: "Back to Room", exact: true }).click();
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
  });
}

test("intentional blank paragraphs survive clicks and focus in Project detail", async ({ page }) => {
  const content: TiptapDoc = { type: "doc", content: [picture, heading, { type: "paragraph" }, { type: "paragraph" }] };
  const original = structuredClone(content);
  const writes = await fixtures(page, content);
  await page.goto("/app/projects/42/entries/201");
  const renderer = page.locator("#entry-201");
  await expect(renderer.getByRole("heading", { name: "A field note", exact: true })).toBeVisible();
  await settle(page);
  const writesBefore = [...writes];
  await exerciseReadonly(page, renderer);
  expect(content).toEqual(original);
  expect(writes).toEqual(writesBefore);
});

test("Home media preview stays unchanged and its entry link still opens", async ({ page }) => {
  const writes = await fixtures(page, { type: "doc", content: [picture, heading] });
  await page.goto("/app");
  const opener = page.getByRole("button", { name: "Open Field Studies", exact: true });
  await expect(opener).toBeVisible();
  const before = await snapshot(opener);
  await opener.focus();
  await page.keyboard.press("ArrowRight");
  expect(await snapshot(opener)).toEqual(before);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/42\/entries\/201$/);
  expect(writes.filter(write => /^(PATCH|PUT|DELETE) /.test(write))).toEqual([]);
});

for (const width of [320, 390, 1280]) for (const embeddedHeading of [false, true]) {
  test(`Project and reply entry content match at ${width}px, embeddedHeading=${embeddedHeading}`, async ({ page }, info) => {
    // Three full document loads plus same-tab external links in both browser engines.
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 1000 });
    const title = embeddedHeading ? "A long title about leaving room for another voice before the final phrase" : "A quieter ending";
    const content: TiptapDoc = { type: "doc", content: [
      picture, { ...picture, attrs: { ...picture.attrs, alt: "Second synthetic reference" } },
      ...(embeddedHeading ? [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] }] : []),
      { type: "paragraph", content: [{ type: "text", text: "Keep the pause. ", marks: [{ type: "bold" }] }, { type: "text", text: "Let the second voice enter slowly.", marks: [{ type: "italic" }] }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A section inside the work" }] },
      { type: "paragraph", content: [{ type: "text", text: "Read the reference", marks: [{ type: "link", attrs: { href: "https://example.com/reference" } }] }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Leave a little quiet." }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep the final note." }] }] }] },
    ] };
    const writes = await fixtures(page, content, title);
    await page.route("https://example.com/reference", route => route.fulfill({ contentType: "text/html", body: "<p>Reference destination</p>" }));
    const evidence = [];
    for (const route of ["/app/projects/42/entries/201", "/app/rooms/77/chat?wall=19", "/app/entries/74"]) {
      await page.goto(route);
      if (route.includes("wall=")) await page.getByRole("button", { name: "Open image 1", exact: true }).click();
      const card = route.includes("projects") ? page.locator("#entry-201") : page.getByLabel("Discussion and replies", { exact: true });
      await expect(card.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
      await expect(card.getByRole("img", { name: "Synthetic reference", exact: true })).toBeVisible();
      await expect(card.getByRole("img", { name: "Second synthetic reference", exact: true })).toBeVisible();
      for (const text of ["Keep the pause.", "Let the second voice enter slowly.", "A section inside the work", "Leave a little quiet.", "Keep the final note."]) await expect(card).toContainText(text);
      await expect(card.getByRole("link", { name: "Read the reference" })).toBeVisible();
      await settle(page);
      const typography = await card.getByRole("heading", { name: title, exact: true }).evaluate(element => {
        const style = getComputedStyle(element);
        return { font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight };
      });
      if (evidence.length) expect(typography).toEqual(evidence[0]);
      evidence.push(typography);
      await exerciseReadonly(page, card);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
      await expect(card.getByRole("heading", { name: "Feedback", exact: true })).toHaveCount(0);
      const tabs = page.context().pages().length;
      await card.getByRole("link", { name: "Read the reference" }).click();
      await expect(page).toHaveURL("https://example.com/reference");
      expect(page.context().pages()).toHaveLength(tabs);
    }
    expect(writes.filter(write => /^(PATCH|PUT|DELETE) /.test(write))).toEqual([]);
    await info.attach("shared content typography", { body: JSON.stringify(evidence), contentType: "application/json" });
  });
}

test("Round history opens through a keyboard-accessible control and closes to the room", async ({ page }) => {
  await fixtures(page, { type: "doc", content: [heading] });
  await page.goto("/app/rooms/77");
  const launcher = page.getByRole("button", { name: "Round history", exact: true });
  await expect(launcher).toBeVisible();
  await launcher.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Small observations", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to room", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/rooms\/77$/);
});
