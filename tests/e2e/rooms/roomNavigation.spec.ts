import { expect, test, type Page } from "@playwright/test";

// Production routes and hooks with viewer-scoped API fixtures; no shared database mutations.
import { roomFixtures } from "./roomFixtures";

test.setTimeout(30_000);

for (const width of [1280, 390, 320]) {
  test(`Room controls and shared shelf geometry at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await roomFixtures(page);
    await page.goto("/app/rooms/7/chat");
    const identity = page.getByRole("button", { name: "Open Room details", exact: true });
    await expect(identity).toBeVisible();
    const header = identity.locator("..");
    // The loading preview uses the same header contract; wait for the live
    // control, then re-resolve geometry if that preview was replaced.
    await expect(identity).toBeEnabled();
    await expect.poll(() => header.boundingBox()).toMatchObject({ height: 64, width: Math.min(width, 760) });
    await expect.poll(async () => (await identity.boundingBox())?.height).toBe(44);
    for (const button of await header.getByRole("button").all()) await expect(button).toBeInViewport({ ratio: 1 });
    const editor = page.getByRole("textbox", { name: "Message Lanterns" });
    await editor.fill("Keep this Room sketch");
    await identity.click();
    await expect(page.getByRole("button", { name: "Great Hall", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Gathering", exact: true })).toBeVisible();
    const side = page.getByRole("button", { name: "Enter Small Hours", exact: true });
    const measure = (element: Element) => {
      const style = getComputedStyle(element);
      const name = element.querySelector('[dir="auto"]')!;
      const nameStyle = getComputedStyle(name);
      return { height: Math.round(element.getBoundingClientRect().height * 100) / 100, font: nameStyle.fontFamily, size: nameStyle.fontSize, weight: nameStyle.fontWeight, padding: style.padding, gap: style.gap, radius: style.borderRadius };
    };
    await expect(side).toBeVisible();
    const details = await side.evaluate(measure);
    await page.getByRole("button", { name: "Close Room details", exact: true }).click();
    const trigger = page.getByRole("button", { name: "Open Side Rooms shelf", exact: true });
    await trigger.click();
    const shelf = page.getByLabel("Lanterns side rooms", { exact: true });
    await expect(shelf).toBeVisible();
    expect(await shelf.getByRole("button", { name: "Enter Small Hours", exact: true }).evaluate(measure)).toEqual(details);
    await expect(shelf.getByRole("heading", { name: "Members" })).toHaveCount(0);
    const unavailable = shelf.getByRole("button", { name: /Requested Private study/ });
    await expect(unavailable).toBeDisabled();
    await unavailable.dispatchEvent("click");
    await expect(page).toHaveURL(/\/7\/chat$/);
    await page.screenshot({ path: testInfo.outputPath(`shelf-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(shelf).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(editor).toHaveValue("Keep this Room sketch");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("parent, child, Home and interrupted navigation preserve browser history", async ({ page }, testInfo) => {
  test.setTimeout(30_000);
  await roomFixtures(page);
  await page.goto("/app/rooms/7/chat");
  await page.getByRole("button", { name: "Open Side Rooms shelf", exact: true }).click();
  await page.getByRole("button", { name: "Enter Small Hours", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/8$/);
  await expect(page.getByRole("heading", { name: "Small Hours", exact: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/\/7\/chat$/);
  await page.goForward(); await expect(page).toHaveURL(/\/rooms\/8$/);
  const up = page.getByRole("button", { name: "Step out to parent Room", exact: true });
  await up.evaluate(element => { (element as HTMLElement).click(); (element as HTMLElement).click(); });
  await expect(page).toHaveURL(/\/rooms\/2$/);
  await expect(page.getByRole("heading", { name: "Great Hall", exact: true })).toBeVisible();
  await up.click();
  await expect(page).toHaveURL(/\/rooms\/1$/);
  await page.getByRole("button", { name: "Back to home", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  // Ancestor navigation dismisses the child stack; browser Back retains the origin.
  await page.goBack(); await expect(page).toHaveURL(/\/7\/chat$/);
  await page.goForward(); await expect(page).toHaveURL(/\/app$/);
  await page.screenshot({ path: testInfo.outputPath("history-return.png") });
});

test("reduced motion and unsupported View Transitions navigate safely", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => { Object.defineProperty(document, "startViewTransition", { value: undefined }); });
  await roomFixtures(page); await page.goto("/app/rooms/7/chat");
  await page.getByRole("button", { name: "Step out to parent Room", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/2$/);
  await expect(page.getByRole("heading", { name: "Great Hall", exact: true })).toBeVisible();
});

test("Room changes keep composer drafts scoped to their originating Room", async ({ page }) => {
  await roomFixtures(page); await page.goto("/app/rooms/7/chat");
  await page.getByRole("textbox", { name: "Message Lanterns" }).fill("A draft for Lanterns");
  await page.getByRole("button", { name: "Open Side Rooms shelf", exact: true }).click();
  await page.getByRole("button", { name: "Enter Small Hours", exact: true }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message Small Hours" })).toHaveValue("");
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Message Lanterns" })).toHaveValue("A draft for Lanterns");
});

test("persistent audio and chat reading position survive parent, Home and history", async ({ page }) => {
  await roomFixtures(page, true); await page.goto("/app/rooms/7/chat");
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  const widget = page.getByTestId("audio-player-widget");
  const position = () => widget.getByRole("slider").getAttribute("aria-valuenow").then(Number);
  await expect.poll(position).toBeGreaterThan(0);
  const initialTime = await position();
  const history = page.getByLabel("Lanterns chat messages");
  await history.hover(); await page.mouse.wheel(0, -160);
  await page.waitForTimeout(350); // Reading-anchor persistence is deliberately debounced.
  const originalPosition = await history.evaluate(element => element.scrollTop);
  await page.getByRole("button", { name: "Open Side Rooms shelf" }).click();
  await page.getByRole("button", { name: "Enter Small Hours" }).click();
  await expect(page).toHaveURL(/\/rooms\/8$/);
  await page.getByRole("button", { name: "Step out to parent Room" }).click();
  await page.getByRole("button", { name: "Step out to parent Room" }).click();
  await page.getByRole("button", { name: "Back to home" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(widget).toHaveCount(1);
  await expect.poll(position).toBeGreaterThan(initialTime);
  await page.goBack();
  await expect(page).toHaveURL(/\/7\/chat$/);
  await expect.poll(() => history.evaluate((element, position) => Math.abs(element.scrollTop - position), originalPosition)).toBeLessThan(3);
  await expect(widget.getByRole("button", { name: "Pause audio" })).toBeVisible();
});

test("Room transition snapshots move diagonally and Home returns diagonally", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = document.startViewTransition.bind(document);
    const samples: Array<{ direction?: string; old: string; incoming: string }> = [];
    (window as unknown as { roomMotion: typeof samples }).roomMotion = samples;
    document.startViewTransition = update => {
      const direction = document.documentElement.dataset.roomDetailsTransition;
      const transition = original(update);
      void transition.ready.then(() => {
        let count = 0;
        const record = () => {
          samples.push({ direction, old: getComputedStyle(document.documentElement, "::view-transition-old(root)").transform, incoming: getComputedStyle(document.documentElement, "::view-transition-new(root)").transform });
          if (++count < 15) requestAnimationFrame(record);
        };
        requestAnimationFrame(record);
      });
      return transition;
    };
  });
  await roomFixtures(page); await page.goto("/app/rooms/7/chat");
  await page.getByRole("button", { name: "Open Side Rooms shelf", exact: true }).click();
  await page.getByRole("button", { name: "Enter Small Hours", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/8$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.roomDetailsTransition)).toBeUndefined();
  await page.getByRole("button", { name: "Step out to parent Room" }).click();
  await expect(page).toHaveURL(/\/rooms\/2$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.roomDetailsTransition)).toBeUndefined();
  await page.getByRole("button", { name: "Step out to parent Room" }).click();
  await expect(page).toHaveURL(/\/rooms\/1$/);
  await page.getByRole("button", { name: "Back to home" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.roomDetailsTransition)).toBeUndefined();
  const samples = await page.evaluate(() => (window as unknown as { roomMotion: Array<{ direction?: string; old: string; incoming: string }> }).roomMotion);
  const matrix = (value: string) => value.startsWith("matrix(") ? value.slice(7, -1).split(",").map(Number) : [];
  expect(samples.some(sample => sample.direction === "deeper" && matrix(sample.old)[4] < 0 && matrix(sample.old)[5] < 0 && matrix(sample.incoming)[4] > 0 && matrix(sample.incoming)[5] > 0)).toBe(true);
  expect(samples.some(sample => sample.direction === "shallower" && matrix(sample.old)[4] > 0 && matrix(sample.old)[5] > 0 && matrix(sample.incoming)[4] < 0 && matrix(sample.incoming)[5] < 0)).toBe(true);
  expect(samples.some(sample => sample.direction === "home" && matrix(sample.incoming)[4] < 0 && matrix(sample.incoming)[5] < 0)).toBe(true);
  await testInfo.attach("Room motion transforms", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
});


test("breadcrumb links wrap long identities without overflow and navigate ancestors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await roomFixtures(page);
  const name = "GatheringWithAnExceptionallyLongUnbrokenIdentity";
  await page.route("**/api/v2/rooms/1", route => route.fulfill({ json: { id: 1, name, parent: null, access: { kind: "member" } } }));
  await page.route("**/api/v2/rooms/2", route => route.fulfill({ json: { id: 2, name: "The Great Hall where everyone gathers around the fire", parent: { id: 1, name }, access: { kind: "member" } } }));
  await page.goto("/app/rooms/7/chat");
  await page.getByRole("button", { name: "Open Room details" }).click();
  const root = page.getByRole("button", { name, exact: true });
  await expect(root).toBeVisible();
  expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await root.click();
  await expect(page).toHaveURL(/\/rooms\/1$/);
});

test("a long side-room list stays compact and scrollable without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await roomFixtures(page);
  await page.route("**/api/v2/rooms/7/adjacent-rooms", route => route.fulfill({ json: { can_create: true, adjacent_rooms: Array.from({ length: 20 }, (_, index) => ({ id: 100 + index, name: `A long side room identity for quiet reading ${index + 1}`, porosity: "masked", porosity_label: "Visit only", member_count: 2, viewer_state: "member", actions: { enter: true } })) } }));
  await page.goto("/app/rooms/7/chat");
  await page.getByRole("button", { name: "Open Side Rooms shelf", exact: true }).click();
  const shelf = page.getByLabel("Lanterns side rooms", { exact: true });
  await expect(shelf).toBeVisible();
  await expect.poll(async () => (await shelf.boundingBox())!.y).toBeGreaterThanOrEqual(64);
  const bounds = (await shelf.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(480);
  const last = shelf.getByRole("button", { name: /reading 20$/ });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


async function panelSamples(page: Page, action: string, shelf = false) {
  await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
  return page.evaluate(async ({ action, shelf }) => {
    const trigger = document.querySelector<HTMLElement>(`[aria-label="${action}"]`)!;
    const values: Array<{ y: number; x: number; scale: number; height: number; width: number; content: string }> = [];
    trigger.click();
    const started = performance.now();
    while (performance.now() - started < 650) {
      let element: Element | null = shelf
        ? document.querySelector('[aria-label="Lanterns side rooms"]')
        : [...document.querySelectorAll('[role="heading"]')].find(node => node.textContent === "Members") ?? null;
      while (element) {
        const style = getComputedStyle(element);
        if ((element as HTMLElement).style.transform.includes("translateY")) {
          const matrix = new DOMMatrixReadOnly(style.transform), box = element.getBoundingClientRect();
          values.push({ y: matrix.m42, x: matrix.m41, scale: matrix.m11, height: box.height, width: box.width, content: element.textContent ?? "" });
          break;
        }
        element = element.parentElement;
      }
      await new Promise(requestAnimationFrame);
    }
    return values;
  }, { action, shelf });
}

test("details animate down after navigation and retain content while closing", async ({ page }, testInfo) => {
  await roomFixtures(page);
  await page.goto("/app/rooms/7/chat");
  await page.getByRole("button", { name: "Open Side Rooms shelf" }).click();
  await page.getByRole("button", { name: "Enter Small Hours" }).click();
  await expect(page).toHaveURL(/\/rooms\/8$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.roomDetailsTransition)).toBeUndefined();
  const opening = await panelSamples(page, "Open Room details");
  expect(opening.some(value => value.y < -1 && value.y > -value.height)).toBe(true);
  expect(opening.at(-1)!.y).toBe(0);
  const closing = await panelSamples(page, "Close Room details");
  expect(closing.some(value => value.y < -1 && value.y > -value.height && value.content.includes("Members"))).toBe(true);
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Room details" })).toBeFocused();
  await page.getByRole("button", { name: "Open Room details" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toHaveCount(0);
  await testInfo.attach("retained panel motion", { body: JSON.stringify({ opening, closing }), contentType: "application/json" });
});

for (const reduced of [false, true]) {
  test(`Home and top-level Room motion, reduced=${reduced}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.addInitScript(() => {
      const start = document.startViewTransition.bind(document);
      (window as unknown as { routeMotion: unknown[] }).routeMotion = [];
      document.startViewTransition = update => {
        const direction = document.documentElement.dataset.roomDetailsTransition;
        const transition = start(update);
        void transition.ready.then(() => {
          let count = 0;
          const record = () => {
            (window as unknown as { routeMotion: unknown[] }).routeMotion.push({ direction, old: getComputedStyle(document.documentElement, "::view-transition-old(root)").transform, incoming: getComputedStyle(document.documentElement, "::view-transition-new(root)").transform });
            if (++count < 15) requestAnimationFrame(record);
          };
          requestAnimationFrame(record);
        });
        return transition;
      };
    });
    await roomFixtures(page);
    await page.route(url => url.pathname === "/api/v1/projects/home", route => route.fulfill({ json: { today: "2026-10-12", rounds: [], recentRooms: [{ id: 1, name: "Gathering", avatarUrl: null, unseenCount: 0 }], totalRoomUnseenCount: 0, recentProjects: [], recentEntries: [], contributions: [] } }));
    await page.goto("/app");
    await page.getByRole("button", { name: "Gathering", exact: true }).click();
    await expect(page).toHaveURL(/\/rooms\/1$/);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.roomDetailsTransition)).toBeUndefined();
    const opening = await panelSamples(page, "Open Room details");
    if (reduced) expect(opening.every(value => value.y === 0)).toBe(true);
    else expect(opening.some(value => value.y < 0)).toBe(true);
    await panelSamples(page, "Close Room details");
    await page.getByRole("button", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.roomDetailsTransition)).toBeUndefined();
    const samples = await page.evaluate(() => (window as unknown as { routeMotion: Array<{ direction: string; old: string; incoming: string }> }).routeMotion);
    const matrix = (value: string) => value.startsWith("matrix(") ? value.slice(7, -1).split(",").map(Number) : [];
    if (reduced) expect(samples).toEqual([]);
    else {
      expect(samples.some(s => s.direction === "from-home" && matrix(s.old)[4] < 0 && matrix(s.old)[5] < 0 && matrix(s.incoming)[4] > 0 && matrix(s.incoming)[5] > 0)).toBe(true);
      expect(samples.some(s => s.direction === "home" && matrix(s.old)[4] > 0 && matrix(s.old)[5] > 0 && matrix(s.incoming)[4] < 0 && matrix(s.incoming)[5] < 0)).toBe(true);
    }
    await testInfo.attach("Home-Room actual motion samples", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  });
}

test("shelf launcher waits for its Room side list without using stale eligibility", async ({ page }) => {
  await roomFixtures(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === "/api/v2/rooms/7/adjacent-rooms", async route => {
    await held;
    await route.fulfill({ json: { can_create: true, adjacent_rooms: [{ id: 8, name: "Small Hours", actions: { enter: true } }] } });
  });
  await page.goto("/app/rooms/7/chat");
  await expect(page.getByRole("button", { name: "Open Room details" })).toBeVisible();
  const trigger = page.getByRole("button", { name: "Open Side Rooms shelf" });
  await expect(trigger).toHaveCount(0);
  release(); await expect(trigger).toBeVisible();
  let releaseNext!: () => void;
  const nextHeld = new Promise<void>(resolve => { releaseNext = resolve; });
  await page.route(url => url.pathname === "/api/v2/rooms/8/adjacent-rooms", async route => {
    await nextHeld; await route.fulfill({ json: { can_create: true, adjacent_rooms: [] } });
  });
  await trigger.click();
  await page.getByRole("button", { name: "Enter Small Hours" }).click();
  await expect(page).toHaveURL(/\/rooms\/8$/);
  await expect(trigger).toHaveCount(0);
  releaseNext(); await expect(trigger).toHaveCount(0);
  await page.goBack(); await expect(page).toHaveURL(/\/7\/chat$/);
  await expect(trigger).toBeVisible();
});

for (const reduced of [false, true]) {
  test(`compact shelf retains vertical motion and focus, reduced=${reduced}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await roomFixtures(page); await page.goto("/app/rooms/7/chat");
    await expect(page.getByRole("button", { name: "Open Side Rooms shelf" })).toBeVisible();
    const opening = await panelSamples(page, "Open Side Rooms shelf", true);
    expect(opening.length).toBeGreaterThan(0);
    if (reduced) expect(opening.every(value => value.y === 0)).toBe(true);
    else expect(opening.some(value => value.y < -1 && value.y > -value.height)).toBe(true);
    expect(opening.at(-1)!.y).toBe(0);
    const closing = await panelSamples(page, "Close Side Rooms shelf", true);
    if (!reduced) expect(closing.some(value => value.y < -1 && value.content.includes("Small Hours"))).toBe(true);
    for (const value of [...opening, ...closing]) { expect(value.x).toBe(0); expect(value.scale).toBe(1); }
    await expect(page.getByLabel("Lanterns side rooms", { exact: true })).toHaveCount(0);
    const trigger = page.getByRole("button", { name: "Open Side Rooms shelf" });
    await expect(trigger).toBeFocused();
    await trigger.click(); await page.keyboard.press("Escape");
    await expect(page.getByLabel("Lanterns side rooms", { exact: true })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await testInfo.attach("shelf frame samples", { body: JSON.stringify({ opening, closing }), contentType: "application/json" });
  });
}

test("details closing decelerates and supports interruption without stale unmount", async ({ page }, testInfo) => {
  await roomFixtures(page); await page.goto("/app/rooms/7/chat");
  await panelSamples(page, "Open Room details");
  const samples = await panelSamples(page, "Close Room details");
  const moving = samples.filter(value => value.y < 0);
  expect(moving.length).toBeGreaterThan(2);
  const earlyStep = moving[0].y - moving[1].y;
  const lateStep = moving.at(-2)!.y - moving.at(-1)!.y;
  expect(earlyStep).toBeGreaterThan(lateStep);
  await page.getByRole("button", { name: "Open Room details" }).click();
  await page.getByRole("button", { name: "Close Room details" }).evaluate(element => (element as HTMLElement).click());
  await page.getByRole("button", { name: "Open Room details" }).evaluate(element => (element as HTMLElement).click());
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toHaveCount(0);
  await testInfo.attach("details exit frame samples", { body: JSON.stringify(samples), contentType: "application/json" });
});
