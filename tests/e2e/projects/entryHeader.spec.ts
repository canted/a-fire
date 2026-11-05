import { expect, test, type Page } from "@playwright/test";
import type { ProjectDetail, ProjectEntry } from "../../../frontend/src/lib/api/projectEntries";

// Exercise production routes and persistence hooks without changing a shared database.
async function entryFixtures(page: Page, permissions = { can_edit: true, can_share: true }) {
  await page.addInitScript(() => {
    localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" }));
  });
  let entry: ProjectEntry = {
    id: 201, kind: "material", author: { id: 1, username: "Rowan" },
    created_at: "2026-10-12T09:30:00Z", updated_at: "2026-10-12T09:30:00Z",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Leave room for another voice." }] }] },
    format: "mixed_media", format_data: {}, intent: "A quieter ending", question: "Where should the second voice enter?",
    ...permissions, draft: false, status: "published", submissions: [],
  };
  const project: ProjectDetail = {
    id: 42, name: "Room Score", description: "Studies for a changing performance score.",
    owner: entry.author, participants: [], pending_participants: [], rooms: [],  entries: [entry],
    updated_at: entry.updated_at, can_edit: true, can_add_material: true, viewer_participation: "owner",
  };
  const writes: unknown[] = [];
  let release: (() => void) | undefined;
  let held: Promise<void> | undefined;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    let body: unknown = {};
    if (path === "/v1/projects/42/entries/201") {
      if (route.request().method() === "PATCH") {
        const patch = route.request().postDataJSON() as Partial<ProjectEntry> & { save?: boolean };
        writes.push(patch);
        await held;
        entry = { ...entry, ...patch, ...(patch.save ? { draft: false, status: "published" } : {}) };
        project.entries = [entry];
      }
      body = entry;
    } else if (path === "/v1/projects/42/entries") body = route.request().method() === "GET" ? { entries: [entry], nextCursor: null } : entry;
    else if (path === "/v1/projects/42/room-entries") body = { entries: [], nextCursor: null };
    else if (path === "/v1/projects/42") body = project;
    else if (path === "/v1/projects") body = { projects: [project] };
    else if (path === "/v1/memberships") body = { user: entry.author, memberships: [] };
    else if (path === "/v1/unseen/count") body = { total: 0, entries: 0, replies: 0 };
    else if (path === "/v1/notices") body = { items: [], nextCursor: null };
    await route.fulfill({ json: body });
  });
  return { writes, hold: () => { held = new Promise<void>(resolve => { release = resolve; }); }, release: () => { release?.(); held = undefined; } };
}

for (const width of [320, 390, 1280]) {
  test(`entry detail and completion control share the compact AppBar at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await entryFixtures(page);
    await page.goto("/app/projects/42/entries/201");
    const banner = page.getByRole("button", { name: "Back to project", exact: true }).locator("..");
    const edit = banner.getByRole("button", { name: "Edit", exact: true });
    const menu = banner.getByRole("button", { name: "Entry options" });
    await expect(edit).toBeVisible();
    await expect(banner.getByRole("button", { name: "Project options" })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Entry", exact: true }).locator("footer")).toHaveCount(0);
    const detail = await edit.evaluate(element => {
      const toolbar = element.parentElement!.parentElement!.getBoundingClientRect();
      return { height: toolbar.height, width: toolbar.width, controlRightInset: toolbar.right - element.getBoundingClientRect().right };
    });
    expect(detail).toEqual({ height: 44, width: Math.min(width, 760), controlRightInset: 12 });
    expect((await menu.boundingBox())!.x + 30).toBeLessThan((await edit.boundingBox())!.x);
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Edit entry" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Share with a room" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Project settings" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`entry-detail-${width}.png`) });
    await edit.click();
    await expect(page).toHaveURL(/\/entries\/201\/edit$/);
    const done = page.getByRole("button", { name: "Done editing" });
    await expect(done).toBeEnabled();
    const completion = await done.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const toolbar = element.parentElement!.getBoundingClientRect();
      const extension = 7;
      const hit = (x: number) => element.contains(document.elementFromPoint(x, rect.top + rect.height / 2));
      const menu = element.parentElement!.querySelector('[aria-label="Entry options"]')!.getBoundingClientRect();
      return { visibleWidth: rect.width, visibleHeight: rect.height, targetWidth: rect.width + 2 * extension, targetHeight: rect.height + 2 * extension,
        paintedRightInset: toolbar.right - rect.right, topSpace: rect.top - toolbar.top, bottomSpace: toolbar.bottom - rect.bottom,
        leftHit: hit(rect.left - extension + 1), rightHit: hit(rect.right + extension - 1), gapToMenu: rect.left - extension - menu.right,
        targetInsideViewport: rect.left - extension >= 0 && rect.right + extension <= innerWidth };
    });
    expect(completion).toMatchObject({ visibleWidth: 30, visibleHeight: 30, targetWidth: 44, targetHeight: 44, paintedRightInset: 12, topSpace: 7, bottomSpace: 7, leftHit: true, rightHit: true, targetInsideViewport: true });
    expect(completion.gapToMenu).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Entry options" }).focus();
    await page.keyboard.press("Tab");
    await expect(done).toBeFocused();
    const focus = await done.evaluate(element => { const s = getComputedStyle(element); return { width: s.outlineWidth, offset: s.outlineOffset, color: s.outlineColor, visible: element.matches(":focus-visible"), token: s.getPropertyValue("--focus-outline") }; });
    expect(focus).toMatchObject({ visible: true });
    expect(parseFloat(focus.width), JSON.stringify(focus)).toBeGreaterThan(0);
    expect(parseFloat(focus.offset)).toBeGreaterThan(0);
    expect(focus.color).not.toBe("rgb(0, 0, 0)");
    await page.screenshot({ path: testInfo.outputPath(`entry-completion-focus-${width}.png`) });
    await testInfo.attach("entry header geometry", { body: JSON.stringify({ width, detail, completion, focus }, null, 2), contentType: "application/json" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("both transparent completion edges save, and pending saves disable repeat activation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const fixture = await entryFixtures(page);
  for (const side of ["left", "right"] as const) {
    await page.goto(side === "left" ? "/app/projects/42/entries/new" : "/app/projects/42/entries/201/edit");
    const done = page.getByRole("button", { name: "Done editing" });
    await expect(done).toBeEnabled();
    const rect = (await done.boundingBox())!;
    fixture.hold();
    await page.mouse.click(side === "left" ? rect.x - 6 : rect.x + rect.width + 6, rect.y + rect.height / 2);
    await expect(done).toBeDisabled();
    fixture.release();
    await expect(page).toHaveURL(/\/app\/projects\/42$/);
    await expect(page.getByRole("button", { name: "Project options" })).toBeVisible();
    await expect(page.getByText("Leave room for another voice.")).toBeVisible();
  }
  expect(fixture.writes.length).toBeGreaterThanOrEqual(2);
});

test("share-only entry keeps its own menu and omits edit controls", async ({ page }) => {
  await entryFixtures(page, { can_edit: false, can_share: true });
  await page.goto("/app/projects/42/entries/201");
  await page.getByRole("button", { name: "Entry options" }).click();
  await expect(page.getByRole("menuitem", { name: "Share with a room" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit entry" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Project options" })).toHaveCount(0);
});
