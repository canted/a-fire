#!/usr/bin/env node
// Run only AFTER measured batches: this deliberately edits the synthetic draft.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const fixture = JSON.parse(await readFile('tmp/lighthouse/fixture.json', 'utf8'));
const session = JSON.parse(await readFile('tmp/lighthouse/session.json', 'utf8'));
const base = new URL(fixture.baseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Only the local fixture is allowed.');
const route = id => new URL(fixture.routes.find(item => item.id === id).path, base).href;
const out = path.resolve('tests/e2e/reports/lighthouse/verification');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 823 } });
const page = await context.newPage();
const evidence = { startedAt: new Date().toISOString(), checks: [], errors: [], failedResponses: [] };
page.on('pageerror', error => evidence.errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) evidence.failedResponses.push({ url: response.url(), status: response.status() }); });
const check = (name, detail = {}) => { evidence.checks.push({ name, passed: true, ...detail }); console.log(`PASS ${name}`); };
try {
  await page.goto(new URL('/auth', base).href);
  await page.evaluate(tokens => { localStorage.setItem('accessToken', tokens.accessToken); localStorage.setItem('refreshToken', tokens.refreshToken); }, session);
  await page.goto(route('project-detail'), { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle('Project · A Fire');
  const tile = page.locator('[data-entry-media-tile]').filter({ has: page.locator('[data-audio-node]') }).first();
  await tile.scrollIntoViewIfNeeded();
  const waveform = tile.getByTestId('audio-waveform');
  await expect(waveform).toHaveAttribute('data-waveform-state', 'ready', { timeout: 30000 });
  const waveformData = await waveform.evaluate(svg => ({ colors: svg.querySelectorAll('stop').length, contour: svg.querySelector('polygon')?.getAttribute('points') }));
  assert(waveformData.colors > 2 && waveformData.contour.length > 200);
  check('Real waveform contour and spectral colors render', { colorStops: waveformData.colors });
  const projectUrl = page.url();
  await tile.getByRole('button', { name: /play/i }).click();
  await expect.poll(() => page.getByTestId('global-audio-element').evaluate(audio => audio.currentTime), { timeout: 15000 }).toBeGreaterThan(0.2);
  assert.equal(page.url(), projectUrl);
  await page.getByTestId('global-audio-element').evaluate(audio => { audio.dataset.verificationMarker = 'persistent-player'; });
  const before = await page.getByTestId('global-audio-element').evaluate(audio => audio.currentTime);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(new URL('/app/projects', base).href);
  await expect(page).toHaveTitle('Projects · A Fire');
  await expect(page.getByTestId('global-audio-element')).toHaveAttribute('data-verification-marker', 'persistent-player');
  await expect.poll(() => page.getByTestId('global-audio-element').evaluate(audio => audio.currentTime)).toBeGreaterThan(before);
  check('Nested play starts real audio without opening the tile; lazy navigation preserves playback');
  await page.goBack();
  await expect(page).toHaveURL(projectUrl);
  await tile.focus();
  await expect(tile).toBeFocused();
  await tile.press('Enter');
  await expect(page).toHaveURL(/\/media\/\d+$/);
  await expect(page).toHaveTitle('Entry media · A Fire');
  await expect(page.getByRole('slider', { name: 'Audio position' })).toBeVisible();
  check('Keyboard activation opens the real media viewer');

  await page.goto(route('entry-composer'), { waitUntil: 'networkidle' });
  const title = `Lighthouse verified ${Date.now()}`;
  const body = 'A synthetic local entry: autosave, upload, remove, replace, and reopen.';
  const savedText = page.waitForResponse(response => response.request().method() === 'PATCH' && /\/projects\/\d+\/entries\/\d+$/.test(new URL(response.url()).pathname) && response.request().postData()?.includes(body));
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Body', exact: true }).fill(body);
  assert((await savedText).ok());
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
  await expect(page.getByRole('textbox', { name: 'Body', exact: true })).toHaveValue(body);
  check('Autosave persists title and body through a reload');
  const upload = page.getByLabel('Choose photos or videos', { exact: true });
  await upload.setInputFiles('frontend/.storybook/assets/wall-spunky.jpg');
  await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Remove image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toHaveCount(0);
  await upload.setInputFiles('frontend/.storybook/assets/wall-cool.jpg');
  await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Done editing', exact: true }).click();
  await expect(page).toHaveURL(new URL('/app/projects/1', base).href);
  await page.goto(route('entry-composer'), { waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
  await expect(page.getByRole('button', { name: 'Remove image', exact: true })).toHaveCount(1);
  const uploadedImage = page.locator('[aria-label="Entry media"] img');
  await expect.poll(() => uploadedImage.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  check('Real image upload, removal, replacement, completion, and reopening preserve one image');
  await page.screenshot({ path: path.join(out, 'entry-composer-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to project', exact: true }).click();
  await expect(page).toHaveURL(new URL('/app/projects/1', base).href);
  for (const id of ['chat', 'entry-replies']) {
    await page.goto(route(id), { waitUntil: 'networkidle' });
    await expect(page.getByText(fixture.routes.find(item => item.id === id).expectText, { exact: false }).first()).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    check(`${id} renders real content without horizontal overflow`);
  }
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(font => font.status === 'loaded').map(font => ({ family: font.family, weight: font.weight })); });
  assert(fonts.length > 0);
  check('Production web fonts load', { fonts });
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(evidence.failedResponses, []);
  check('No page errors or failed HTTP responses during interaction checks');
} catch (error) {
  evidence.failure = error.stack;
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(out, 'checks.json'), JSON.stringify(evidence, null, 2));
  const tokens = await page.evaluate(() => ({ accessToken: localStorage.getItem('accessToken'), refreshToken: localStorage.getItem('refreshToken') }));
  if (tokens.accessToken && tokens.refreshToken) await writeFile('tmp/lighthouse/session.json', JSON.stringify(tokens), { mode: 0o600 });
  await browser.close();
}
