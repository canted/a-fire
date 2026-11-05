import { expect, test, type Page } from "@playwright/test";
import { roomFixtures } from "./roomFixtures";

test.setTimeout(30_000);

async function fixtures(page: Page, wall = true) {
  await roomFixtures(page);
  const item = { id: "11", roundId: "10", roomId: "7", title: "A shared evening", description: "Our latest round", publishedAt: "2026-10-10T10:00:00Z", presented: true, entryCount: 0, templateKey: null, entries: [] };
  const presented: string[] = [];
  await page.route(url => url.pathname.startsWith("/api/") && /\/walls(?:\/|$)/.test(url.pathname), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/presentation")) presented.push(path);
    await route.fulfill({ json: path.endsWith("/presentation") ? { wallId: "11", presented: true } : path.endsWith("/walls") ? { walls: wall ? [item] : [] } : item });
  });
  return presented;
}

// Explicit history navigation is a page now, not the retired floating Wall morph.
for (const width of [390, 1280]) test(`Round history uses its own app bar and browser history at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const presented = await fixtures(page);
  await page.goto("/app/rooms/7");
  const launcher = page.getByRole("button", { name: "Round history", exact: true });
  await expect(launcher).toBeVisible();
  const before = await launcher.boundingBox();
  await launcher.click();
  await expect(page).toHaveURL(/\/rooms\/7\/round-history$/);
  await expect(page.getByRole("heading", { name: "A shared evening" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to room", exact: true })).toBeInViewport();
  expect(presented).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`round-history-${width}.png`) });
  await page.goBack();
  await expect(page).toHaveURL(/\/rooms\/7$/);
  await expect(launcher).toBeVisible();
  expect(await launcher.boundingBox()).toEqual(before);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "A shared evening" })).toBeVisible();
  await page.getByRole("button", { name: "Back to room", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/7$/);
  expect(presented).toEqual(["/api/v1/walls/11/presentation"]);
});

for (const reduced of [false, true]) test(`Round history works without View Transitions, reduced=${reduced}`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.addInitScript(() => { Object.defineProperty(document, "startViewTransition", { value: undefined }); });
  await fixtures(page);
  await page.goto("/app/rooms/7");
  const launcher = page.getByRole("button", { name: "Round history", exact: true });
  await launcher.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "A shared evening" })).toBeVisible();
  await page.getByRole("button", { name: "Back to room", exact: true }).click();
  await expect(launcher).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await fixtures(page, false); await page.reload(); await launcher.click();
  await expect(page.getByRole("heading", { name: "Round history", exact: true })).toBeVisible();
  await expect(page.getByText("A shared evening", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to room", exact: true })).toBeVisible();
});

test("history navigation is a cut and leaves one Room launcher on return", async ({ page }) => {
  await fixtures(page);
  await page.goto("/app/rooms/7");
  await page.evaluate(() => {
    const original = document.startViewTransition?.bind(document);
    (window as unknown as { historyTransitions: number }).historyTransitions = 0;
    if (original) document.startViewTransition = update => {
      (window as unknown as { historyTransitions: number }).historyTransitions++;
      return original(update);
    };
  });
  await page.getByRole("button", { name: "Round history", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A shared evening" })).toBeVisible();
  await page.getByRole("button", { name: "Back to room", exact: true }).click();
  await expect(page.getByRole("button", { name: "Round history", exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { historyTransitions: number }).historyTransitions)).toBe(0);
});
