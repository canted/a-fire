import { expect, test, type Page } from "@playwright/test";
import { roomFixtures } from "./roomFixtures";

test.setTimeout(30_000);

async function peopleFixtures(page: Page, canCreate = true) {
  await roomFixtures(page);
  await page.route(url => url.pathname === "/api/v2/rooms/7/members", route => route.fulfill({ json: { members: [{ id: 1, user_id: 1, display_username: "Rowan" }, { id: 2, user_id: 2, display_username: "Mira" }, { id: 3, user_id: 3, display_username: "Dev" }, { id: 4, user_id: 4, display_username: "Cora" }].map(member => ({ ...member, presence: { is_here: true }, location: { room_id: 7, name: "Lanterns" } })) } }));
  if (!canCreate) await page.route(url => url.pathname === "/api/v2/rooms/7/adjacent-rooms", route => route.fulfill({ json: { can_create: false, adjacent_rooms: [] } }));
}

async function openDetails(page: Page) {
  await page.goto("/app/rooms/7/chat");
  await page.getByRole("button", { name: "Open Room details" }).click();
  const members = page.getByRole("heading", { name: "Members", exact: true });
  await expect(members).toBeVisible();
  await expect.poll(() => members.evaluate(element => { let node: Element | null = element; while (node) { const transform = getComputedStyle(node).transform; if (transform !== "none" && new DOMMatrixReadOnly(transform).m42 !== 0) return false; node = node.parentElement; } return true; })).toBe(true);
}

async function dragTo(page: Page, name: string, target: ReturnType<Page["locator"]>) {
  const source = page.getByRole("button", { name: new RegExp(`^${name},`) }).or(page.getByRole("checkbox", { name: new RegExp(`^(Select|Deselect) ${name}$`) }));
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 24, from.y + from.height / 2);
  await page.mouse.move(to.x + to.width / 2, Math.min(to.y + to.height - 8, Math.max(to.y + 8, from.y + from.height / 2)), { steps: 8 });
  await expect.poll(() => source.locator("..").evaluate(element => getComputedStyle(element).transform)).not.toBe("none");
  await page.mouse.up();
}

for (const width of [320, 390, 1280]) {
  test(`Side Chat participant selection and Chat identity geometry at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await peopleFixtures(page); await openDetails(page);
    await page.getByRole("button", { name: "Start a side chat", exact: true }).click();
    const pane = page.getByRole("heading", { name: "New Side Chat", exact: true }).locator("..");
    await expect(pane).toBeVisible();
    await expect(page.getByRole("button", { name: /^Enter / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start a side chat", exact: true })).toHaveCount(0);
    const start = pane.getByRole("button", { name: "Create side chat", exact: true });
    await expect(start).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "Select Rowan" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select Rowan" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ }).check();
    await page.getByRole("checkbox", { name: /^(Select|Deselect) Dev$/ }).check();
    await expect(start).toBeEnabled();
    const selected = pane.getByRole("button", { name: "Remove Mira" });
    const avatar = selected.getByRole("img", { name: "Mira", exact: true });
    const geometry = await avatar.evaluate(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, radius: getComputedStyle(element).borderRadius }; });
    expect(geometry.width).toBe(16);
    expect(geometry.height).toBe(16);
    expect(parseFloat(geometry.radius)).toBeGreaterThanOrEqual(8);
    await expect(start).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`new-side-chat-${width}.png`) });
    await pane.getByRole("button", { name: "Remove Mira" }).click();
    await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(pane.getByRole("button", { name: "Remove Mira" })).toBeVisible();
    await pane.getByRole("button", { name: "Cancel selection", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start a side chat", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "Enter Small Hours" })).toBeVisible();
    await page.getByRole("button", { name: "Start a side chat", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ })).not.toBeChecked();
    await expect(start).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach("selection identity and layout", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
  });
}

test("dragging into Start enters selection; checked-mode drags preserve selection without accidental toggles", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await peopleFixtures(page); await openDetails(page);
  await dragTo(page, "Mira", page.getByRole("button", { name: "Start a side chat", exact: true }));
  const pane = page.getByRole("heading", { name: "New Side Chat", exact: true }).locator("..");
  await expect(pane.getByRole("button", { name: "Remove Mira" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ })).toBeChecked();
  const target = pane.getByRole("button", { name: "Create side chat" }).locator("../..");
  await dragTo(page, "Mira", target);
  await expect(pane.getByRole("button", { name: "Remove Mira" })).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ })).toBeChecked();
  await dragTo(page, "Dev", target);
  await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Dev$/ })).toBeChecked();
  await pane.getByRole("button", { name: "Remove Mira" }).click();
  await dragTo(page, "Mira", target);
  await expect(pane.getByRole("button", { name: "Remove Mira" })).toHaveCount(1);
  const row = page.getByRole("checkbox", { name: /^(Select|Deselect) Dev$/ });
  await row.click(); await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Dev$/ })).not.toBeChecked();
  await row.focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Dev$/ })).toBeChecked();
});

test("Details close returns focus to the identity and preserves shelf eligibility", async ({ page }) => {
  await peopleFixtures(page); await openDetails(page);
  const close = page.getByRole("button", { name: "Close Room details", exact: true });
  const bounds = (await close.boundingBox())!;
  expect(bounds.height).toBe(44);
  await close.click();
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Open Room details" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Open Side Rooms shelf", exact: true })).toBeVisible();
  await page.route(url => url.pathname === "/api/v2/rooms/7/adjacent-rooms", route => route.fulfill({ json: { can_create: true, adjacent_rooms: [] } }));
  await page.reload(); await page.getByRole("button", { name: "Open Room details" }).click();
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Open Side Rooms shelf", exact: true })).toHaveCount(0);
});

test("actual Start creates the chosen chat and opens its Chat while access-denied creation stays unavailable", async ({ page }) => {
  await peopleFixtures(page);
  let payload: unknown;
  await page.route(url => url.pathname === "/api/v2/rooms/7/adjacent-rooms", async route => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    payload = route.request().postDataJSON();
    await route.fulfill({ json: { room: { id: 8, name: "Mira and Dev" } } });
  });
  await page.route(url => url.pathname === "/api/v2/rooms/8", route => route.fulfill({ json: { id: 8, name: "Mira and Dev", parent: { id: 7, name: "Lanterns" }, access: { kind: "member", can_manage: true }, memberBoard: { id: 28, name: "Mira and Dev" } } }));
  await openDetails(page);
  await page.getByRole("button", { name: "Start a side chat", exact: true }).click();
  await page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ }).check(); await page.getByRole("checkbox", { name: /^(Select|Deselect) Dev$/ }).check();
  await page.getByRole("button", { name: "Create side chat", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/8$/);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  expect((payload as { user_ids: number[] }).user_ids.sort()).toEqual([2, 3]);
  await expect(page.getByRole("textbox", { name: "Message Mira and Dev" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mira and Dev details" })).toHaveCount(0);
  await peopleFixtures(page, false); await openDetails(page);
  await expect(page.getByRole("button", { name: "Start a side chat", exact: true })).toHaveCount(0);
});

test.describe("mobile browser touch", () => {
  test.use({ hasTouch: true, isMobile: true });
test("mobile touch can add a person from checkbox mode without triggering its tap toggle", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    (window as unknown as { touchLog: unknown[] }).touchLog = [];
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchend", "click"]) document.addEventListener(type, event => {
      const e = event as PointerEvent;
      (window as unknown as { touchLog: unknown[] }).touchLog.push({ type, x: e.clientX, y: e.clientY, button: e.button, pointerType: e.pointerType, target: (event.target as Element).closest("button")?.getAttribute("aria-label") });
    }, true);
  });
  await peopleFixtures(page); await openDetails(page);
  await page.getByRole("button", { name: "Start a side chat", exact: true }).click();
  const pane = page.getByRole("heading", { name: "New Side Chat", exact: true }).locator("..");
  const source = page.getByRole("checkbox", { name: /^(Select|Deselect) Cora$/ });
  const from = (await source.boundingBox())!, to = (await pane.getByRole("button", { name: "Create side chat" }).locator("../..").boundingBox())!;
  const x = from.x + from.width / 2, y = from.y + from.height / 2;
  await source.evaluate(async (element, points) => {
    const dispatch = (type: string, x: number, y: number) => {
      const touch = { identifier: 1, target: element, clientX: x, clientY: y, pageX: x, pageY: y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch] },
        targetTouches: { value: type === "touchend" ? [] : [touch] },
        changedTouches: { value: [touch] },
      });
      element.dispatchEvent(event);
    };
    dispatch("touchstart", points.x, points.y);
    await new Promise(requestAnimationFrame);
    dispatch("touchmove", points.x + 28, points.y);
    await new Promise(requestAnimationFrame);
    dispatch("touchmove", points.targetX, points.targetY);
    await new Promise(requestAnimationFrame);
    dispatch("touchend", points.targetX, points.targetY);
  }, { x, y, targetX: to.x + to.width / 2, targetY: to.y + to.height / 2 });
  await testInfo.attach("browser touch events", { body: JSON.stringify(await page.evaluate(() => (window as unknown as { touchLog: unknown[] }).touchLog)), contentType: "application/json" });
  await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Cora$/ })).toBeChecked();
  await expect(pane.getByRole("button", { name: "Remove Cora" })).toHaveCount(1);
  await pane.getByRole("button", { name: "Remove Cora" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Cora$/ })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Cora$/ })).toBeFocused();
});

});

test("failed creation preserves people for retry and Cancel clears the draft", async ({ page }) => {
  await peopleFixtures(page);
  await page.route(url => url.pathname === "/api/v2/rooms/7/adjacent-rooms", async route => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    await route.fulfill({ status: 403, json: { error: "Could not start this side chat." } });
  });
  await openDetails(page); await page.getByRole("button", { name: "Start a side chat", exact: true }).click();
  const pane = page.getByRole("heading", { name: "New Side Chat", exact: true }).locator("..");
  await page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ }).check();
  await pane.getByRole("button", { name: "Create side chat", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not start this side chat.");
  await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ })).toBeChecked();
  await expect(pane.getByRole("button", { name: "Create side chat", exact: true })).toBeEnabled();
  await pane.getByRole("button", { name: "Cancel selection", exact: true }).click();
  await page.getByRole("button", { name: "Start a side chat", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^(Select|Deselect) Mira$/ })).not.toBeChecked();
});
