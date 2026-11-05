import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createUserCommunityFixture } from "../fixtures/factory";
import { E2E_MEMBER_EMAIL } from "../config";

test("Projects back control and glyph fit completely inside the mobile viewport", async ({ page }) => {
  test.setTimeout(30_000);
  const measurements = [];
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/app/projects");
    await expect(page.getByRole("heading", { name: "Your projects", exact: true })).toBeVisible();
    const home = page.getByRole("button", { name: "Back to home", exact: true });
    const glyph = home.locator("img, svg").first();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect.poll(() => glyph.evaluate(element => !(element instanceof HTMLImageElement) || (element.complete && element.naturalWidth > 0))).toBe(true);
    await expect(home).toBeInViewport({ ratio: 1 });
    await expect(glyph).toBeInViewport({ ratio: 1 });
    const measurement = await home.evaluate(element => {
      const rect = (node: Element) => {
        const { x, y, width, height, top, right, bottom, left } = node.getBoundingClientRect();
        return { x, y, width, height, top, right, bottom, left };
      };
      const dock = element.parentElement;
      const glyphElement = element.querySelector("img, svg");
      if (!dock || !glyphElement) throw new Error("Back must use the canonical app bar and glyph");
      const linkRect = rect(element);
      return {
        viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height },
        home: linkRect,
        glyph: rect(glyphElement),
        dock: rect(dock),
        dockPosition: getComputedStyle(dock).position,
        homeReceivesPointer: element.contains(document.elementFromPoint(linkRect.x + linkRect.width / 2, linkRect.y + linkRect.height / 2)),
      };
    });
    expect(measurement.home.bottom).toBeLessThanOrEqual(measurement.viewport.height);
    expect(measurement.glyph.bottom).toBeLessThanOrEqual(measurement.viewport.height);
    expect(measurement.dock.top).toBeGreaterThanOrEqual(0);
    expect(measurement.home.top).toBeGreaterThanOrEqual(measurement.dock.top);
    expect(measurement.home.bottom).toBeLessThanOrEqual(measurement.dock.bottom);
    expect(measurement.homeReceivesPointer).toBe(true);
    measurements.push(measurement);
    await home.click();
    await expect(page).toHaveURL("/app");
    const captureDirectory = process.env.AFIRE_REVIEW_SCREENSHOTS;
    if (captureDirectory) {
      await mkdir(captureDirectory, { recursive: true });
      await page.screenshot({ path: join(captureDirectory, `projects-${viewport.width}-placement.jpg`), type: "jpeg", quality: 90, animations: "disabled", fullPage: false });
    }
  }
  console.log("Projects Home placement", JSON.stringify(measurements));
  if (process.env.AFIRE_REVIEW_SCREENSHOTS) {
    await writeFile(join(process.env.AFIRE_REVIEW_SCREENSHOTS, "projects-home-placement.json"), JSON.stringify(measurements, null, 2));
  }
});

test("Room Rounds return to the room and then home through reachable app-bar controls", async ({ page }) => {
  test.setTimeout(30_000);
  const fixture = await createUserCommunityFixture({ email: E2E_MEMBER_EMAIL, roomName: `Home navigation ${Date.now()}`, skipEmailCleanup: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/app/rooms/${fixture.roomId}/rounds`);
  for (const [label, destination] of [
    ["Back to Room", `/app/rooms/${fixture.roomId}`],
    ["Back to home", "/app"],
  ]) {
    const back = page.getByRole("button", { name: label, exact: true });
    await expect(back).toBeInViewport({ ratio: 1 });
    await expect(back.locator("img, svg").first()).toBeInViewport({ ratio: 1 });
    await back.click();
    await expect(page).toHaveURL(destination);
  }
  await expect(page.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible();
});
