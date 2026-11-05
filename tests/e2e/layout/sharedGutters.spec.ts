import { expect, test, type Page } from "@playwright/test";
import { prepareLayoutRoutes } from "./layoutFixtures";

test.setTimeout(90_000);

async function contentBoundaries(page: Page) {
  return page.locator('[data-visual-viewport-scrollable]:visible').evaluate(shell =>
    [...shell.querySelectorAll<HTMLElement>('div')].filter(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      return style.maxWidth === '760px' && style.paddingLeft === '12px' && box.height > 0;
    }).map(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight), width: box.width };
    }));
}

for (const width of [320, 390, 1280]) test(`shared content gutters across Expo routes at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await prepareLayoutRoutes(page);
  const observations: unknown[] = [];
  for (const path of ['/app', '/app/projects', '/app/projects/42', '/app/profile', '/app/rooms/new', '/app/rooms/all', '/app/notices', '/app/rooms/77/settings', '/app/rooms/77', '/app/rooms/77/notes', '/app/rooms/77/rounds/new', '/app/rooms/77/rounds/new/art_before_chorus', '/app/rooms/77/rounds/new/feedback', '/app/rooms/77/chat', '/app/rooms/77/round-history']) {
    await page.goto(path);
    const shell = page.locator('[data-visual-viewport-scrollable]:visible');
    await expect(shell).toBeVisible();
    await expect.poll(() => contentBoundaries(page).then(values => values.length), { message: path }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Dismiss error', exact: true })).toHaveCount(0);
    const values = await contentBoundaries(page);
    const left = Math.max(0, (width - 760) / 2) + 12;
    for (const value of values) {
      expect(value.left, `${path} left`).toBeCloseTo(left, 1);
      expect(value.right, `${path} right`).toBeCloseTo(width - left, 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBeLessThanOrEqual(1);
    observations.push({ path, values });
  }
  await info.attach('content geometry', { body: JSON.stringify(observations), contentType: 'application/json' });
});

async function simulateSafeAreas(page: Page) {
  await page.evaluate(() => {
    const insets: Record<string, number> = { left: 30, right: 44, bottom: 34 };
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          for (const property of [...rule.style]) {
            const value = rule.style.getPropertyValue(property);
            const resolved = value.replace(/env\(safe-area-inset-(left|right|bottom)(?:,[^)]*)?\)/g, (_, side: string) => `${insets[side]}px`);
            if (resolved !== value) rule.style.setProperty(property, resolved, rule.style.getPropertyPriority(property));
          }
        } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of [...document.styleSheets]) visit(sheet.cssRules);
  });
}

test('asymmetric safe areas apply once to shared header, content and composer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareLayoutRoutes(page); await page.goto('/app/rooms/77/chat');
  await expect(page.getByRole('textbox', { name: 'Message Small Hours' })).toBeVisible();
  await simulateSafeAreas(page);
  const values = await contentBoundaries(page);
  expect(values.length).toBeGreaterThanOrEqual(2);
  for (const value of values) { expect(value.left).toBe(30); expect(value.right).toBe(346); }
  const send = (await page.getByRole('button', { name: 'Send', exact: true }).boundingBox())!;
  expect(844 - send.y - send.height).toBeGreaterThanOrEqual(54);
});

async function composerGeometry(page: Page) {
  const toolbar = page.locator('#viewport-toolbar:visible');
  return toolbar.evaluate(element => {
    const box = element.getBoundingClientRect();
    const input = element.querySelector('textarea, input')!.getBoundingClientRect();
    const send = element.querySelector('[aria-label="Send"]')!.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, height: box.height, inputBottom: input.bottom, sendBottom: send.bottom, sendWidth: send.width, sendHeight: send.height };
  });
}

for (const width of [320, 390]) test(`Chat and reply toolbars keep safe-area and keyboard clearance at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await prepareLayoutRoutes(page);
  const observations: unknown[] = [];
  for (const safeArea of [false, true]) {
    for (const path of ['/app/rooms/77/chat', '/app/entries/74', '/app/rooms/77/chat?wall=19']) {
      await page.goto(path);
      if (path.includes('wall=')) {
        await page.getByRole('button', { name: 'A quiet sketch.', exact: true }).click();
      }
      const input = page.locator('#viewport-toolbar:visible').getByRole('textbox');
      await expect(input).toBeVisible(); await input.fill('A shared thought');
      if (safeArea) await simulateSafeAreas(page);
      for (const keyboard of [false, true]) {
        await input.focus();
        await page.evaluate(height => {
          Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: height });
          window.visualViewport!.dispatchEvent(new Event('resize'));
        }, keyboard ? 544 : 844);
        const shell = page.locator('[data-visual-viewport-scrollable]:visible');
        if (keyboard) await expect(shell).toHaveAttribute('data-keyboard-open', 'true');
        else await expect(shell).not.toHaveAttribute('data-keyboard-open');
        const geometry = await composerGeometry(page);
        expect(geometry.sendWidth).toBeGreaterThanOrEqual(44);
        expect(geometry.sendHeight).toBeGreaterThanOrEqual(44);
        expect(geometry.bottom).toBeCloseTo(keyboard ? 536 : safeArea ? 790 : 808, 0);
        expect(geometry.inputBottom).toBeLessThanOrEqual(geometry.bottom);
        // Reply attachments reduce text width, so wrapping can change its centered baseline.
        // Both composers keep the input inside the same keyboard/safe-area dock.
        expect(geometry.bottom - geometry.inputBottom).toBeLessThanOrEqual(8);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        observations.push({ path, safeArea, keyboard, geometry });
      }
    }
  }
  await info.attach('composer geometry', { body: JSON.stringify(observations), contentType: 'application/json' });
});

test('shared and embedded replies reuse the same compact author identity', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 }); await prepareLayoutRoutes(page);
  const values: unknown[] = [];
  for (const embedded of [false, true]) {
    await page.goto(embedded ? '/app/rooms/77/chat?wall=19' : '/app/entries/74');
    if (embedded) await page.getByRole('button', { name: 'A quiet sketch.', exact: true }).click();
    const content = page.getByLabel('Discussion and replies');
    await expect(content).toBeVisible();
    const identity = content.getByRole('button', { name: /Rowan/ }).first();
    values.push(await identity.evaluate(element => {
      const avatar = element.querySelector('[role="img"]')!, text = [...element.querySelectorAll('[dir="auto"]')].find(node => node.textContent === 'Rowan')!;
      const a = avatar.getBoundingClientRect(), t = text.getBoundingClientRect(), style = getComputedStyle(text);
      return { width: a.width, height: a.height, gap: t.left - a.right, centerOffset: a.y + a.height / 2 - t.y - t.height / 2, font: style.fontFamily, size: style.fontSize };
    }));
  }
  expect(values[0]).toEqual(values[1]);
  expect((values[0] as {centerOffset: number}).centerOffset).toBeCloseTo(0, 1);
});
