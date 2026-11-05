import { expect, test } from "@playwright/test";
import { prepareLayoutRoutes } from "./layoutFixtures";

test.setTimeout(60_000);

for (const width of [390, 1280]) test(`Room grid fits the shared page at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await prepareLayoutRoutes(page); await page.goto('/app/rooms/77');
  const header = page.getByRole('button', { name: 'Open Room details' }).locator('..');
  await expect(page.getByRole('button', { name: 'A quiet sketch.', exact: true })).toBeVisible();
  await expect(header).toBeVisible();
  const frame = (await header.boundingBox())!;
  expect(frame.width).toBe(Math.min(width, 760));
  expect(frame.x).toBe((width - frame.width) / 2);
  const first = page.getByRole('button', { name: 'A quiet sketch.', exact: true });
  const second = page.getByRole('button', { name: 'A second sketch.', exact: true });
  await expect(first).toBeVisible(); await expect(second).toBeVisible();
  const card = (element: Element) => {
    let node = element.parentElement!;
    while (node.parentElement && getComputedStyle(node).borderRadius !== "16px") node = node.parentElement;
    const box = node.getBoundingClientRect();
    return { x: box.x, width: box.width };
  };
  const a = await first.evaluate(card), b = await second.evaluate(card);
  // Current Wall has paired responsive member columns, replacing retired136px Squares.
  expect(a.width).toBeCloseTo(b.width, 1);
  expect(a.width).toBeCloseTo((frame.width - 24 - 12) / 2, 1);
  expect(a.x).toBeGreaterThanOrEqual(frame.x + 12);
  expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width - 12);
  expect(a.x + a.width).toBeLessThan(b.x);
  const add = (await page.getByRole('button', { name: 'Add entry', exact: true }).boundingBox())!;
  expect(add.width).toBeGreaterThanOrEqual(44);
  expect(add.x + add.width).toBeLessThanOrEqual(frame.x + frame.width - 12);
  expect(add.y + add.height).toBeLessThan(844 - 16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (width > 760) {
    await page.goto('/app/rooms/all');
    const allHeader = page.getByRole('heading', { name: 'All Rooms', exact: true }).locator('..');
    await expect(allHeader).toBeVisible();
    expect((await allHeader.boundingBox())!.width).toBe(760);
    expect((await allHeader.boundingBox())!.x).toBe(frame.x);
  }
});

test('Project, Home, Room, history and composer share one centered page boundary', async ({ page }, info) => {
  await prepareLayoutRoutes(page);
  const observations: unknown[] = [];
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/app/projects/42', '/app', '/app/rooms/77/chat', '/app/rooms/77/rounds', '/app/projects/42/entries/201/edit', '/app/rooms/77/round-history']) {
      await page.goto(path);
      const shell = page.locator('[data-visual-viewport-scrollable]:visible');
      await expect(shell).toBeVisible();
      await expect.poll(() => shell.evaluate(element => [...element.querySelectorAll<HTMLElement>('div')].filter(node => getComputedStyle(node).maxWidth === '760px' && node.getBoundingClientRect().height > 0).length)).toBeGreaterThan(0);
      const frames = await shell.evaluate(element => [...element.querySelectorAll<HTMLElement>('div')].filter(node => getComputedStyle(node).maxWidth === '760px' && node.getBoundingClientRect().height > 0).map(node => { const b = node.getBoundingClientRect(); return { x: b.x, width: b.width }; }));
      for (const frame of frames) { expect(frame.width).toBe(Math.min(width, 760)); expect(frame.x).toBe((width - frame.width) / 2); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      observations.push({ width, path, frames });
    }
    await page.goto('/app/rooms/77/chat?wall=19');
    await page.getByRole('button', { name: 'A quiet sketch.', exact: true }).click();
    await expect(page.getByLabel('Discussion and replies')).toBeVisible();
    await expect(page.locator('#viewport-toolbar:visible').getByRole('textbox')).toBeVisible();
    const reply = (await page.locator('#viewport-toolbar:visible').boundingBox())!;
    expect(reply.width).toBe(width);
    await expect(page.getByRole('button', { name: /Back to room/i, exact: true })).toBeVisible();
  }
  await info.attach('page geometry', { body: JSON.stringify(observations), contentType: 'application/json' });
});
