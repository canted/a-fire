import { expect, type Page } from "@playwright/test";
import type { UserCommunityFixture } from "./factory";

/** Enter the canonical project-backed composer through the Room sharing picker. */
export async function openRoomComposer(page: Page, fixture: UserCommunityFixture) {
  await page.goto(`/app/rooms/${fixture.roomId}`);
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByRole("button", { name: "Create something new", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === `/app/rooms/${fixture.roomId}/new-entry`);
  await page.getByRole("button", { name: `Private studies ${fixture.roomId}`, exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
}

export async function attachComposerFile(page: Page, path: string) {
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach file", exact: true }).click();
  await (await choosing).setFiles(path);
  await expect(page.getByRole("button", { name: /^Remove (image|audio|video|file) 1$/ })).toBeVisible();
}

export async function findSaveProject(page: Page, name: string) {
    const dialog = page.getByRole("dialog", { name: "Save to project", exact: true });
    const target = dialog.getByRole("button", { name: name, exact: true });
    const more = dialog.getByRole("button", { name: "Load more projects", exact: true });
    await expect(dialog).toBeVisible();
    while (true) {
      // A freshly opened picker can render its shell before the first page.
      await expect.poll(async () => await target.count() > 0 || (await more.count() > 0 && await more.isEnabled())).toBe(true);
      if (await target.count()) break;
      const count = await dialog.getByRole("button").count();
      await more.click();
      await expect.poll(() => dialog.getByRole("button").count()).toBeGreaterThan(count);
    }
    return target;
}

export async function chooseSaveProject(page: Page, name: string) {
  await (await findSaveProject(page, name)).click();
}
