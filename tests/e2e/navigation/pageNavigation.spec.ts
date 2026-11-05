import { expect, test, type Page } from "@playwright/test";
import { navigationMemberships, navigationProjects, navigationRooms } from "../fixtures/navigation";

async function fixture(page: Page) {
  const writes: Array<{ path: string; body: string }> = [];
  await page.addInitScript(() => {
    localStorage.setItem("afire.preview.session", JSON.stringify({ accessToken: `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 1, exp: 4102444800 }))}.fixture`, refreshToken: "fixture-refresh" }));
    localStorage.setItem("pwa.hide_install", "true");
    localStorage.setItem("pwa.hide_notifications", "true");
  });
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (["POST", "PATCH"].includes(request.method())) writes.push({ path, body: request.postData() ?? "" });
    let body: unknown = {};
    if (path.endsWith("/memberships")) body = navigationMemberships;
    else if (path.endsWith("/menu") || (path === "/api/v2/rooms" && request.method() === "GET")) body = navigationRooms;
    else if (path === "/api/v1/projects") body = { projects: navigationProjects };
    else if (path === "/api/v1/projects/home") body = { today: new Date().toISOString().slice(0, 10), rounds: [], recentRooms: navigationRooms.rooms.map(room => ({ id: room.id, name: room.name, unseenCount: 0 })), totalRoomUnseenCount: 0, recentProjects: navigationProjects.map(project => ({ project, entry: null })), contributions: [] };
    else if (path.endsWith("/unseen/count")) body = { total: 0, entries: 0, replies: 0 };
    else if (path.endsWith("/notices")) body = { items: [], nextCursor: null };
    else if (path === "/api/v2/rooms") body = { id: 9, name: "New sound room", porosity: "open" };
    else if (path === "/api/v2/profile/avatar") body = { ...navigationMemberships.user, username: "Mira II" };
    else if (path.startsWith("/api/v1/invites")) body = { invites: [], suggestions: [], permissions: { new_room_invite_allowed: true } };
    await route.fulfill({ json: body });
  });
  return writes;
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const width of [320, 390, 1280]) {
  test(`standard page navigation and content boundaries at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    const left = Math.max(0, (width - 760) / 2) + 12;
    const measurements = [];
    for (const [path, heading, content] of [
      ["/app/projects", "Your projects", "Room Score"],
      ["/app/rooms/all", "All Rooms", "Enter Evening Room"],
      ["/app/rooms/new", "Name your room", "Name your room"],
      ["/app/profile", "Profiles", "Set your default and room-specific identity."],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await settle(page);
      const back = page.getByRole("button", { name: /Back to home/i });
      await expect(back).toBeInViewport({ ratio: 1 });
      const header = await back.locator("..").boundingBox();
      expect(header!.width).toBe(Math.min(width, 760));
      expect((await back.boundingBox())!.x).toBeCloseTo(left, 1);
      const item = path === "/app/projects" ? page.getByRole("button", { name: content, exact: true }).locator("..")
        : path.endsWith("/all") ? page.getByRole("button", { name: content, exact: true })
        : page.getByText(content, { exact: true });
      await expect(item).toBeVisible();
      const box = (await item.boundingBox())!;
      expect(box.x).toBeCloseTo(left, 1);
      expect(box.x + box.width).toBeLessThanOrEqual(width - left + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      measurements.push({ path, header, content: box });
      await page.screenshot({ path: testInfo.outputPath(`${heading.replaceAll(" ", "-")}-${width}.png`), animations: "disabled" });
      await back.click();
      await expect(page).toHaveURL("/app");
    }
    await testInfo.attach("page-boundaries", { body: JSON.stringify(measurements), contentType: "application/json" });
    for (const [path, label, destination] of [
      ["/app", "New room", "/app/rooms/new"],
      ["/app/rooms/all", "New Room", "/app/rooms/new"],
      ["/app/projects", "New project", "/app/projects/new"],
    ]) {
      await page.goto(path);
      const action = page.getByRole("button", { name: label, exact: true });
      await expect(action).toBeInViewport({ ratio: 1 });
      await expect(action.locator("svg")).toBeVisible();
      await action.click();
      await expect(page).toHaveURL(destination);
    }
  });
}

test("New Room validates before creation and retains the invite permission boundary", async ({ page }) => {
  const writes = await fixture(page);
  await page.goto("/app/rooms/all");
  await page.getByRole("button", { name: "New Room", exact: true }).click();
  await expect(page).toHaveURL("/app/rooms/new");
  expect(writes.filter(write => write.path === "/api/v2/rooms")).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Save and continue" })).toBeDisabled();
  expect(writes.filter(write => write.path === "/api/v2/rooms")).toHaveLength(0);
  await page.getByRole("textbox", { name: "Room name" }).fill("  New sound room  ");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Saved! Invite people below.")).toBeVisible();
  const create = writes.find(write => write.path === "/api/v2/rooms");
  expect(create?.body).toContain("New sound room");
  expect(create?.body).not.toContain("  New sound room  ");
  await expect(page.getByRole("heading", { name: "Invite members", exact: true })).toBeVisible();
  await expect(page.getByText("Invite to make a NEW room")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Home" }).click();
  await expect(page).toHaveURL("/app");
});

test("Profiles keeps saving and Notices gains a top escape without bottom navigation", async ({ page }) => {
  const writes = await fixture(page);
  await page.goto("/app/profile");
  await page.getByRole("textbox", { name: "Default display name", exact: true }).first().fill("Mira II");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => writes.some(write => write.path === "/api/v2/profile/avatar" && write.body.includes("Mira II"))).toBe(true);
  await expect(page.getByRole("button", { name: "Change stripe image" }).first()).toBeVisible();
  await page.goto("/app/notices");
  await expect(page.getByRole("heading", { name: "Notices", level: 1 })).toBeVisible();
  await expect(page.locator('[data-bottom-toolbar]')).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Home" }).click();
  await expect(page).toHaveURL("/app");
});
